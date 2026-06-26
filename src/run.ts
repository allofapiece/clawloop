import fs from "node:fs";
import path from "node:path";
import { scan } from "./scan.js";
import { resolvePaths, readSettings } from "./store.js";
import { JsonSignalsManager } from "./signals/json-manager.js";
import { createBackend } from "./backend/claude-code.js";
import { runElaboration, recordHashes, appendDiary } from "./elaborator/elaborator.js";
import { loadCoverage } from "./elaborator/validate.js";
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
  deps.manager.reap();
  scan({ cwd: deps.cwd, manager: deps.manager });

  const batch = deps.manager.claimBatch(owner);
  if (!batch) return { idle: true };

  try {
    // The agent writes AS and may explicitly `signals solved` / `signals get` more work.
    await runElaboration(batch, deps.backend, paths);

    // Safety net: validate everything still leased by this owner and auto-solve the covered ones.
    // (The agent may already have archived some explicitly via `clawloop signals solved`.)
    const claimed = deps.manager.claimedBy(owner);
    const covered = loadCoverage(paths);
    const solved = claimed.filter((s) => covered.has(s.target));
    recordHashes(paths, solved.map((s) => s.target));
    deps.manager.solve(solved.map((s) => s.id));

    appendDiary(paths, `${batch.file}: ${solved.length} solved, ${claimed.length - solved.length} unsolved`);
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
    process.stdout.write("no .clawloop found — run `clawloop init` first.\n");
    process.exitCode = 1;
    return;
  }

  const manager = new JsonSignalsManager(paths);
  const backend = createBackend(readSettings(paths.settings).agents.elaborator.backend);
  const pollMs = options.pollMs ?? 2000;

  let stop = false;
  const onSigint = () => {
    stop = true;
    process.stdout.write("\nstopping after current iteration…\n");
  };
  process.on("SIGINT", onSigint);

  let n = 0;
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
        process.stdout.write(`idle — ${manager.pendingCount()} pending\n`);
        await sleep(pollMs, () => stop);
      } else {
        process.stdout.write(`elaborated ${summary.file}: solved ${summary.solved}/${summary.claimed}\n`);
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
