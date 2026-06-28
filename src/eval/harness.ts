import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../commands/init.js";
import { resolvePaths, readSettings } from "../store.js";
import { JsonSignalsManager } from "../signals/json-manager.js";
import { createBackend } from "../backend/claude-code.js";
import { runIteration } from "../run.js";
import { validateSpec } from "../spec/audit.js";
import { runJudge, type CriterionVerdict } from "./judge.js";

export interface CaseResult {
  name: string;
  workdir: string;
  iterations: number;
  converged: boolean;
  /** Deterministic gate — cheap, runs before the judge. */
  gate: { validateClean: boolean; converged: boolean; noAbsolutePaths: boolean };
  criteria: CriterionVerdict[];
  /** Pass = gate all-green AND every judge criterion passed. */
  pass: boolean;
}

export interface RunCaseOptions {
  judgeModel: string;
  judgeRuns: number;
  /** Safety cap on elaboration iterations (no maxAttempts in the loop yet). */
  maxIterations: number;
}

/** Run one elaboration-quality eval case end-to-end against the REAL loop, then judge the result. */
export async function runCase(caseDir: string, opts: RunCaseOptions): Promise<CaseResult> {
  const name = path.basename(caseDir);
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), `clawloop-eval-${name}-`));
  runInit({ cwd: workdir });

  // Scaffold the case's User Spec into the project (the ONLY thing clawloop sees).
  const paths = resolvePaths(workdir);
  copyDir(path.join(caseDir, "user-spec"), paths.userSpec);

  // Drive the real elaboration loop to convergence.
  const manager = new JsonSignalsManager(paths);
  const backend = createBackend(readSettings(paths.settings).agents.elaborator.backend);
  let iterations = 0;
  let converged = false;
  for (; iterations < opts.maxIterations; iterations++) {
    const summary = await runIteration({ cwd: workdir, manager, backend }, `eval-${iterations}`);
    if (summary.idle) {
      converged = true;
      break;
    }
  }

  // Deterministic gate.
  const asText = readDir(paths.agentSpec);
  const gate = {
    validateClean: validateSpec(paths).length === 0,
    converged: converged && manager.pendingCount() === 0,
    noAbsolutePaths: !/\/Users\/|\/home\/|\/private\/var\//.test(asText),
  };

  // Independent judge (clean context: only US + AS).
  const usText = readDir(paths.userSpec);
  const criteria = await runJudge({ usText, asText, cwd: workdir, model: opts.judgeModel, runs: opts.judgeRuns });

  const pass = Object.values(gate).every(Boolean) && criteria.every((c) => c.pass);
  return { name, workdir, iterations, converged, gate, criteria, pass };
}

function copyDir(from: string, to: string): void {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/** Concatenate every `.md` under `dir` with file markers (the judge sees the whole artifact). */
function readDir(dir: string): string {
  if (!fs.existsSync(dir)) return "";
  const parts: string[] = [];
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const full = path.join(entry.parentPath, entry.name);
    const rel = path.relative(dir, full).split(path.sep).join("/");
    parts.push(`----- ${rel} -----\n${fs.readFileSync(full, "utf8")}`);
  }
  return parts.join("\n\n");
}
