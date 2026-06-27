import { resolvePaths } from "../store.js";
import { loadBlocks } from "../spec/load.js";
import { JsonSignalsManager } from "../signals/json-manager.js";
import { loadCoverage } from "../elaborator/validate.js";
import { recordHashes } from "../elaborator/elaborator.js";
import type { Signal, SignalsManager } from "../signals/types.js";

export interface SignalsContext {
  cwd: string;
  /** The iteration that owns the lease — from $CLAWLOOP_OWNER when the agent calls these. */
  owner: string;
  manager?: SignalsManager;
}

export interface AddContext {
  cwd: string;
  manager?: SignalsManager;
}

export interface AddResult {
  created: Signal[];
  reason?: string;
}

export interface GetResult {
  claimed?: Signal[];
  reason?: string;
}

export interface SolvedResult {
  solved: string[];
  rejected: { id: string; reason: string }[];
}

/**
 * `clawloop signals add revisit:<ref>` — enqueue `revisit` signals to force re-elaboration of
 * already-covered blocks. `ref` is `all` (every US block), a US block id, or a pending signal id
 * (resolved to its target). Owner-free: this only enqueues, it does not claim.
 */
export function signalsAdd(ctx: AddContext, ref: string): AddResult {
  const paths = resolvePaths(ctx.cwd);
  const manager = ctx.manager ?? new JsonSignalsManager(paths);
  const us = loadBlocks(paths.userSpec);

  let targets: { target: string; file: string }[];
  if (ref === "all") {
    targets = us.map((b) => ({ target: b.id, file: b.file }));
  } else {
    const block = us.find((b) => b.id === ref);
    if (block) {
      targets = [{ target: block.id, file: block.file }];
    } else {
      const sig = manager.list().find((s) => s.id === ref);
      if (sig) targets = [{ target: sig.target, file: sig.file }];
      else return { created: [], reason: `no US block or pending signal "${ref}"` };
    }
  }

  const created: Signal[] = [];
  for (const t of targets) {
    const s = manager.add({ type: "revisit", target: t.target, file: t.file });
    if (s) created.push(s);
  }
  return { created };
}

/** `clawloop signals get us:<id>` — claim the file batch containing `<id>` under the current owner. */
export function signalsGet(ctx: SignalsContext, ref: string): GetResult {
  const target = parseRef(ref);
  const paths = resolvePaths(ctx.cwd);
  const manager = ctx.manager ?? new JsonSignalsManager(paths);

  const match = manager.list().find((s) => s.target === target);
  if (!match) return { reason: `no pending signal for us:${target} (already covered or unknown)` };

  const batch = manager.claimByFile(ctx.owner, match.file);
  if (!batch) return { reason: `file ${match.file} is leased by another worker` };
  return { claimed: batch.signals };
}

/** `clawloop signals solved <ids>` — validate, record hashes, and archive the owner's signals. */
export function signalsSolved(ctx: SignalsContext, ids: string[]): SolvedResult {
  const paths = resolvePaths(ctx.cwd);
  const manager = ctx.manager ?? new JsonSignalsManager(paths);

  const owned = new Map(manager.claimedBy(ctx.owner).map((s) => [s.id, s]));
  const covered = loadCoverage(paths);

  const solved: string[] = [];
  const rejected: { id: string; reason: string }[] = [];
  const targets: string[] = [];

  for (const id of ids) {
    const sig = owned.get(id);
    if (!sig) {
      rejected.push({ id, reason: "not leased by you (unknown or already archived)" });
    } else if (!covered.has(sig.target)) {
      rejected.push({ id, reason: `no AS block expands us:${sig.target}` });
    } else {
      solved.push(id);
      targets.push(sig.target);
    }
  }

  recordHashes(paths, targets);
  manager.solve(solved);
  return { solved, rejected };
}

/** Accept `us:cart-remove`, `#us:cart-remove`, or a bare `cart-remove`. Only US refs are gettable. */
function parseRef(ref: string): string {
  const cleaned = ref.replace(/^#/, "");
  const m = cleaned.match(/^us:(.+)$/);
  if (m) return m[1];
  if (cleaned.includes(":")) throw new Error(`only us: refs can be claimed, got "${ref}"`);
  return cleaned;
}
