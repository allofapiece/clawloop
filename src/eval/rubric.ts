export interface Criterion {
  id: string;
  title: string;
  /** The yes/no question the judge answers (pass = the AS satisfies it). */
  ask: string;
}

/**
 * Elaboration-quality criteria — each binary, judged analytically with required evidence. Derived
 * directly from clawloop's elaboration principles. A case passes only if every criterion is `pass`.
 */
export const RUBRIC: Criterion[] = [
  {
    id: "J1",
    title: "desired-state framing",
    ask: "Does each AS block describe the desired END-STATE (what must be true), not merely dump a program/implementation?",
  },
  {
    id: "J2",
    title: "method implementable",
    ask: "Is the 'how' detailed enough that an implementer who makes NO decisions could execute it (no vague steps)?",
  },
  {
    id: "J3",
    title: "verification is black-box & runnable",
    ask: "Does each block's verification check observable behavior through the public surface with runnable commands (judgment used only where a command truly can't)?",
  },
  {
    id: "J4",
    title: "faithful to the US",
    ask: "Is the AS free of contradictions with the US AND free of user-facing scope (features, inputs, CLI, behaviors) the US never asked for?",
  },
  {
    id: "J5",
    title: "fully decided",
    ask: "Is every decision made — no 'TBD', 'as appropriate', 'choose a suitable…', or 'left to the implementer'?",
  },
  {
    id: "J6",
    title: "no frozen time/env results",
    ask: "Does the AS derive values that depend on time/date/environment rather than hard-coding a literal result that would go stale?",
  },
  {
    id: "J7",
    title: "complete intent coverage",
    ask: "Taken together, does the AS capture everything the US actually wants (semantically, not just structurally covered)?",
  },
];
