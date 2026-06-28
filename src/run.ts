import fs from "node:fs";
import path from "node:path";
import { scan } from "./scan.js";
import { resolvePaths, readSettings } from "./store.js";
import { JsonSignalsManager } from "./signals/json-manager.js";
import { createBackend } from "./backend/claude-code.js";
import { runElaboration, recordHashes, forgetHashes, recordDepHashes, appendDiary } from "./elaborator/elaborator.js";
import { resolutionContext, isResolved } from "./elaborator/validate.js";
import { log } from "./log.js";
import type { Backend } from "./backend/backend.js";
import type { SignalsManager } from "./signals/types.js";

export interface RunDeps {
  cwd: string;
  manager: SignalsManager;
  backend: Backend;
}

export interface IterationSummary {
  idle: boolean;
  file?: string;
  claimed?: number;
  solved?: number;
}

/**
 * One loop turn: reap dead leases, scan for new signals, claim the oldest file's batch, elaborate it,
 * archive what validated, and release the lease (unsolved signals revert to pending). Testable with an
 * injected manager + backend — no real `claude` needed.
 */
export async function runIteration(deps: RunDeps, owner: string): Promise<IterationSummary> {
  const paths = resolvePaths(path.resolve(deps.cwd));

  const reverted = deps.manager.reap();
  if (reverted.length) log.debug(`reaped ${reverted.length} expired lease(s)`);

  log.debug("scanning user-spec and agent-spec");
  const { created, dropped, pending } = scan({ cwd: deps.cwd, manager: deps.manager });
  if (dropped.length) log.info(`scan: dropped ${dropped.length} obsolete signal(s) for deleted block(s)`);
  if (created.length) log.info(`scan: ${created.length} new signal(s), ${pending.length} pending`);
  else log.debug(`scan: 0 new, ${pending.length} pending`);

  const batch = deps.manager.claimBatch(owner);
  if (!batch) return { idle: true };

  log.info(`iteration ${owner}: spec ${batch.file} — taking ${batch.signals.length} signal(s)`);
  for (const s of batch.signals) log.info(`  · taking signal ${s.id} (${s.type} → us:${s.target})`);
  try {
    // The agent writes AS and may explicitly `signals solved` / `signals get` more work.
    log.info(`elaborating ${batch.file} — handing ${batch.signals.length} target(s) to the backend`);
    log.debug(`running backend for ${batch.file}`);
    await runElaboration(batch, deps.backend, paths);

    // Safety net: re-derive resolution state and auto-solve whatever this owner resolved.
    // (The agent may already have archived some explicitly via `clawloop signals solved`.)
    const claimed = deps.manager.claimedBy(owner);
    const ctx = resolutionContext(paths);
    const solved = claimed.filter((s) => isResolved(s, ctx));
    const usSide = (s: { type: string }) =>
      s.type === "uncovered" || s.type === "changed" || s.type === "revisit" || s.type === "dep-changed";
    const usTargets = solved.filter(usSide).map((s) => s.target);
    recordHashes(paths, usTargets);
    recordDepHashes(paths, usTargets); // advance reconciled dependency versions
    forgetHashes(paths, solved.filter((s) => s.type === "orphaned").map((s) => s.target));
    deps.manager.solve(solved.map((s) => s.id));

    appendDiary(paths, `${batch.file}: ${solved.length} solved, ${claimed.length - solved.length} unsolved`);
    const unsolved = claimed.length - solved.length;
    if (unsolved) log.warn(`${batch.file}: ${unsolved} target(s) unsolved — reverting to pending`);
    log.info(`iteration done: ${batch.file} solved ${solved.length}/${claimed.length}`);
    return { idle: false, file: batch.file, claimed: claimed.length, solved: solved.length };
  } finally {
    deps.manager.releaseOwner(owner); // revert any unsolved signals to pending (attempt counted)
  }
}

export interface RunOptions {
  cwd?: string;
  pollMs?: number;
  /** Run a single iteration and return, instead of looping (handy for debugging). */
  once?: boolean;
}

/** `clawloop run`: drive elaboration continuously until Ctrl-C. Idle = poll + watch for new signals. */
export async function run(options: RunOptions = {}): Promise<void> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const paths = resolvePaths(cwd);
  if (!fs.existsSync(paths.clawloop)) {
    log.error("no .clawloop found — run `clawloop init` first.");
    process.exitCode = 1;
    return;
  }

  const manager = new JsonSignalsManager(paths);
  const backend = createBackend(readSettings(paths.settings).agents.elaborator.backend);
  const pollMs = options.pollMs ?? 2000;

  let stop = false;
  const onSigint = () => {
    stop = true;
    log.info("stopping after current iteration…");
  };
  process.on("SIGINT", onSigint);

  log.info(options.once ? "clawloop run (single iteration)" : "clawloop run — watching for signals (Ctrl-C to stop)");

  let n = 0;
  let wasIdle = false;
  try {
    do {
      const owner = `run-${process.pid}-${++n}`;
      const hb = setInterval(() => manager.heartbeat(owner), 30_000);
      let summary: IterationSummary;
      try {
        summary = await runIteration({ cwd, manager, backend }, owner);
      } finally {
        clearInterval(hb);
      }

      if (summary.idle) {
        if (options.once) break;
        // Announce idle once at info; subsequent poll ticks are debug-only (avoid 2s spam).
        if (!wasIdle) log.info(`idle — ${manager.pendingCount()} pending; watching for changes`);
        else log.debug(`idle tick — ${manager.pendingCount()} pending`);
        wasIdle = true;
        await sleep(pollMs, () => stop);
      } else {
        wasIdle = false; // result already logged by runIteration
      }
    } while (!stop && !options.once);
  } finally {
    process.off("SIGINT", onSigint);
  }
}

/** Sleep up to `ms`, waking early if `stopped()` becomes true. */
function sleep(ms: number, stopped: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (stopped()) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve();
      }
    }, 100);
    const timer = setTimeout(() => {
      clearInterval(poll);
      resolve();
    }, ms);
  });
}
