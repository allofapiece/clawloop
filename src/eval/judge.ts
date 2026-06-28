import { ClaudeCodeBackend } from "../backend/claude-code.js";
import { RUBRIC, type Criterion } from "./rubric.js";

export interface CriterionVerdict {
  id: string;
  pass: boolean;
  evidence: string;
}

export interface JudgeOptions {
  usText: string;
  asText: string;
  /** cwd for the judge process (used only for spawning; the judge gets everything in the prompt). */
  cwd: string;
  /** A DIFFERENT model than the runner, to limit self-enhancement bias. */
  model: string;
  /** How many independent judge runs to majority-vote over. */
  runs: number;
}

/** Build the judge prompt: clean context — only the US, the AS, and the rubric. No runner reasoning. */
export function buildJudgePrompt(usText: string, asText: string, rubric: Criterion[] = RUBRIC): string {
  return [
    "You are an INDEPENDENT evaluator. You did not write either spec below — judge strictly and skeptically.",
    "Score the Agent Spec (AS) against the User Spec (US) on each criterion. A criterion is `pass` only",
    "if the AS clearly satisfies it; if in doubt, fail it. Give a short evidence quote from the AS or US.",
    "",
    "Output ONLY a JSON object, no prose:",
    '{"criteria":[{"id":"J1","pass":true,"evidence":"…"}, …]}',
    "",
    "## User Spec",
    usText.trim(),
    "",
    "## Agent Spec",
    asText.trim(),
    "",
    "## Criteria",
    ...rubric.map((c) => `${c.id} (${c.title}): ${c.ask}`),
  ].join("\n");
}

/** Extract the verdict JSON from the model's stdout (tolerant of surrounding prose / code fences). */
export function parseVerdict(stdout: string): CriterionVerdict[] {
  const fenced = stdout.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : stdout;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in judge output");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { criteria?: CriterionVerdict[] };
  if (!Array.isArray(parsed.criteria)) throw new Error("judge output missing `criteria` array");
  return parsed.criteria.map((c) => ({ id: c.id, pass: Boolean(c.pass), evidence: String(c.evidence ?? "") }));
}

/** Run the judge `runs` times and majority-vote each criterion (ties → fail, the skeptical default). */
export async function runJudge(opts: JudgeOptions): Promise<CriterionVerdict[]> {
  const backend = new ClaudeCodeBackend(opts.model);
  const prompt = buildJudgePrompt(opts.usText, opts.asText);

  const ballots: CriterionVerdict[][] = [];
  for (let i = 0; i < opts.runs; i++) {
    const { stdout } = await backend.run(prompt, { cwd: opts.cwd });
    ballots.push(parseVerdict(stdout));
  }

  return RUBRIC.map((c) => {
    const votes = ballots.map((b) => b.find((v) => v.id === c.id)).filter(Boolean) as CriterionVerdict[];
    const passes = votes.filter((v) => v.pass).length;
    const pass = passes * 2 > opts.runs; // strict majority; ties fail
    const evidence = (votes.find((v) => v.pass === pass) ?? votes[0])?.evidence ?? "";
    return { id: c.id, pass, evidence };
  });
}
