import path from "node:path";
import { loadBlocks, assertUniqueIds } from "./spec/load.js";
import { resolvePaths, readState } from "./store.js";
import { JsonSignalsManager } from "./signals/json-manager.js";
import type { Signal, SignalsManager } from "./signals/types.js";

export interface ScanResult {
  created: Signal[];
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
  const recorded = readState(paths).usHashes;

  const usIds = new Set(us.map((b) => b.id));
  const covered = new Set<string>();
  for (const block of as) {
    for (const ref of block.expands) if (ref.kind === "us") covered.add(ref.id);
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
    for (const ref of block.expands) {
      if (ref.kind === "us" && !usIds.has(ref.id)) {
        add(manager.add({ type: "orphaned", target: ref.id, file: block.file }));
      }
    }
  }

  return { created, pending: manager.list() };
}
