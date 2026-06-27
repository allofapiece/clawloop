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
      "Elaborate ONLY these targets — do not create AS for any other block:",
      "",
      batch.signals.map(intentLine).join("\n"),
      "",
      "Write the Agent Spec under `.clawloop/agent-spec/`. The file/block layout is YOURS to decide —",
      "it need not mirror the User Spec. Split a complex target across as many well-named files as the",
      "design needs; a trivial one may be a single block. Existing Agent Spec lives in",
      "`.clawloop/agent-spec/` — to revise or remove a target, find the blocks that `:expands:` it there",
      "and edit them in place.",
      "",
      "Each AS block must include `:expands:` with the US id(s) it details. Give the desired end-state",
      "(by its criteria, not a hard-coded result), the method to reach it, and verification steps. Use",
      "project-relative paths; never hard-code time/environment-dependent values.",
      "",
      "If a related block in another file must change too, claim it with `clawloop signals get us:<id>`.",
      "When you finish targets, report them with `clawloop signals solved <signal-id>,<signal-id>`.",
    ].join("\n"),
  );

  return sections.join("\n\n");
}
