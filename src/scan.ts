import path from "node:path";
import { loadBlocks, assertUniqueIds } from "./spec/load.js";
import { validateSpec } from "./spec/audit.js";
import { resolvePaths, readState } from "./store.js";
import { JsonSignalsManager } from "./signals/json-manager.js";
import type { Signal, SignalsManager } from "./signals/types.js";

export interface ScanResult {
  created: Signal[];
  /** Obsolete US-side signals removed because their block no longer exists. */
  dropped: Signal[];
  pending: Signal[];
}

export interface ScanOptions {
  cwd?: string;
  now?: () => string;
  /** Inject a manager (tests / shared loop instance); defaults to a JsonSignalsManager. */
  manager?: SignalsManager;
}

/**
 * Scan the User Spec and Agent Spec and enqueue elaboration signals:
 *   - `uncovered` — a US block that no AS block expands.
 *   - `changed`   — a covered US block whose content hash differs from the recorded hash.
 *
 * Errors if two US blocks share an id. Idempotent: an identical pending `(type, target)` is not
 * re-added (delegated to the manager).
 */
export function scan(options: ScanOptions = {}): ScanResult {
  const root = path.resolve(options.cwd ?? process.cwd());
  const paths = resolvePaths(root);
  const manager =
    options.manager ?? new JsonSignalsManager(paths, { now: options.now });

  const us = loadBlocks(paths.userSpec);
  assertUniqueIds(us);
  const as = loadBlocks(paths.agentSpec);
  const state = readState(paths);
  const recorded = state.usHashes;
  const depHashes = state.depHashes;

  const usIds = new Set(us.map((b) => b.id));
  const covered = new Set<string>();
  for (const block of as) {
    for (const id of block.expands) covered.add(id);
  }

  const created: Signal[] = [];
  const add = (signal: Signal | null) => {
    if (signal) created.push(signal);
  };

  // US side: blocks needing (re-)elaboration.
  for (const block of us) {
    if (!covered.has(block.id)) {
      add(manager.add({ type: "uncovered", target: block.id, file: block.file }));
    } else if (recorded[block.id] !== block.hash) {
      add(manager.add({ type: "changed", target: block.id, file: block.file }));
    }
  }

  // AS side: blocks expanding a US id that no longer exists → orphaned, to be removed.
  for (const block of as) {
    for (const id of block.expands) {
      if (!usIds.has(id)) {
        add(manager.add({ type: "orphaned", target: id, file: block.file }));
      }
    }
  }

  // Dependency cascade: an AS block X is stale w.r.t. a dependency Y when Y's current hash differs
  // from the version X was last reconciled against (depHashes). Re-elaborate the US block(s) X
  // expands. Direct dependents only — transitivity propagates across iterations as those blocks drift.
  const usFileById = new Map(us.map((b) => [b.id, b.file]));
  const asHashById = new Map(as.map((b) => [b.id, b.hash]));
  for (const x of as) {
    for (const y of x.dependsOn) {
      const yHash = asHashById.get(y);
      if (yHash === undefined) continue; // dangling :depends-on: → validation_failed owns it
      if (depHashes[x.id]?.[y] === yHash) continue; // already reconciled against this version
      for (const u of x.expands) {
        const file = usFileById.get(u);
        if (file) add(manager.add({ type: "dep-changed", target: u, file, detail: `depends-on as:${y} which changed` }));
      }
    }
  }

  // Validation: anything the audit flags (except dangling-expands, which `orphaned` already owns)
  // becomes a validation_failed signal per AS file, carrying the errors as detail.
  const errorsByFile = new Map<string, string[]>();
  for (const p of validateSpec(paths)) {
    if (p.kind === "dangling-expands") continue;
    const list = errorsByFile.get(p.file) ?? [];
    list.push(`[${p.block}] ${p.message}`);
    errorsByFile.set(p.file, list);
  }
  for (const [file, msgs] of errorsByFile) {
    add(manager.add({ type: "validation_failed", target: file, file, detail: msgs.join("; ") }));
  }

  // Prune obsolete signals: US-side signals whose block was deleted (the orphaned signal supersedes
  // them), and validation_failed signals for files that now pass.
  const usSide = new Set<string>(["uncovered", "changed", "revisit", "dep-changed"]);
  const errorFiles = new Set(errorsByFile.keys());
  const dropped = manager.list().filter(
    (s) =>
      (usSide.has(s.type) && !usIds.has(s.target)) ||
      (s.type === "validation_failed" && !errorFiles.has(s.target)),
  );
  manager.drop(dropped.map((s) => s.id));

  return { created, dropped, pending: manager.list() };
}
