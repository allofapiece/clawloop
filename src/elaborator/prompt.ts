import type { Batch, Signal } from "../signals/types.js";

export interface PromptParts {
  /** Contents of agents/elaborator/instructions.md. */
  instructions: string;
  /** The whole User Spec, concatenated with file markers (read-only context). */
  usContext: string;
  /** Recent diary lines (cross-iteration memory), or "" if none. */
  diaryTail: string;
  /** The batch to elaborate this iteration. */
  batch: Batch;
}

function intentLine(s: Signal): string {
  switch (s.type) {
    case "uncovered":
      return `- CREATE Agent Spec for \`us:${s.target}\` (signal ${s.id}) — no AS covers it yet.`;
    case "changed":
      return `- REVISE Agent Spec for \`us:${s.target}\` (signal ${s.id}) — its User Spec text changed.`;
    case "revisit":
      return `- REVISIT \`us:${s.target}\` (signal ${s.id}) — reconsider and improve its existing Agent Spec.`;
    case "orphaned":
      return `- REMOVE the Agent Spec expanding \`us:${s.target}\` (signal ${s.id}) — that User Spec block was deleted.`;
  }
}

/** Build the elaborator prompt. Pure — no I/O, fully unit-testable. */
export function buildElaboratorPrompt(parts: PromptParts): string {
  const { instructions, usContext, diaryTail, batch } = parts;
  const asFile = `.clawloop/agent-spec/${batch.file}`;

  const sections = [
    instructions.trim(),
    "## User Spec (source of truth — READ ONLY, never edit)\n\n" + usContext.trim(),
  ];

  if (diaryTail.trim()) {
    sections.push("## Your recent diary\n\n" + diaryTail.trim());
  }

  sections.push(
    [
      "## This iteration",
      "",
      `Write the Agent Spec to \`${asFile}\` (mirror the User Spec file path).`,
      "Elaborate ONLY these targets — do not create AS for any other block:",
      "",
      batch.signals.map(intentLine).join("\n"),
      "",
      "For each target, write an AS block whose `:expands:` includes `us:<target-id>`.",
      "Specify the complete desired end-state AND fully design how to reach it — leave no decision to the implementer.",
      "",
      "If a related block in another file must change too, claim it with",
      "`clawloop signals get us:<id>`. When you finish targets, report them with",
      "`clawloop signals solved <signal-id>,<signal-id>`.",
    ].join("\n"),
  );

  return sections.join("\n\n");
}
