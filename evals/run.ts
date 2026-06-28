import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCase, type CaseResult } from "../src/eval/harness.js";
import { RUBRIC } from "../src/eval/rubric.js";

/**
 * Elaboration-quality evals. Runs the REAL clawloop loop on each case in evals/cases/, then judges
 * the Agent Spec with an independent `claude -p` (a different model). Costs tokens — run on demand:
 *   npm run eval                     # all cases
 *   npm run eval leap-year           # one case
 *   CLAWLOOP_JUDGE_MODEL=opus CLAWLOOP_JUDGE_RUNS=3 npm run eval
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(here, "cases");

const only = process.argv[2];
const judgeModel = process.env.CLAWLOOP_JUDGE_MODEL ?? "opus";
const judgeRuns = Number(process.env.CLAWLOOP_JUDGE_RUNS ?? "1");
const maxIterations = Number(process.env.CLAWLOOP_EVAL_MAX_ITERS ?? "10");

function listCases(): string[] {
  return fs
    .readdirSync(casesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && (!only || e.name === only))
    .map((e) => path.join(casesDir, e.name));
}

function report(r: CaseResult): void {
  console.log(`\n━━ ${r.name} ${r.pass ? "✓ PASS" : "✗ FAIL"}  (${r.iterations} iter${r.converged ? "" : ", NOT converged"})`);
  console.log(`   gate: validate=${r.gate.validateClean} converged=${r.gate.converged} no-abs-paths=${r.gate.noAbsolutePaths}`);
  for (const c of RUBRIC) {
    const v = r.criteria.find((x) => x.id === c.id);
    const mark = v?.pass ? "✓" : "✗";
    console.log(`   ${mark} ${c.id} ${c.title}${v && !v.pass ? ` — ${v.evidence}` : ""}`);
  }
  console.log(`   workdir: ${r.workdir}`);
}

const cases = listCases();
if (cases.length === 0) {
  console.error(only ? `no eval case "${only}"` : "no eval cases found");
  process.exit(1);
}

console.log(`Running ${cases.length} case(s) — judge model: ${judgeModel}, runs: ${judgeRuns}`);
const results: CaseResult[] = [];
for (const dir of cases) {
  results.push(await runCase(dir, { judgeModel, judgeRuns, maxIterations }));
  report(results.at(-1)!);
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} case(s) passed`);
process.exit(passed === results.length ? 0 : 1);
