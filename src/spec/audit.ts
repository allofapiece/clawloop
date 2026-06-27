import { loadBlocks } from "./load.js";
import type { Paths } from "../store.js";

export type ProblemKind = "dangling-expands" | "dangling-depends" | "loose" | "no-id";

export interface SpecProblem {
  level: "error";
  kind: ProblemKind;
  block: string;
  file: string;
  message: string;
}

/**
 * Audit the Agent Spec against the User Spec and itself. Every finding is an error the Elaborator must
 * fix: dangling references (a link to a block that doesn't exist), loose blocks (not linked into the
 * graph), and ids derived from a heading slug instead of an explicit `(id)=` label (unstable).
 */
export function validateSpec(paths: Paths): SpecProblem[] {
  const usIds = new Set(loadBlocks(paths.userSpec).map((b) => b.id));
  const as = loadBlocks(paths.agentSpec);
  const asIds = new Set(as.map((b) => b.id));

  const problems: SpecProblem[] = [];
  for (const b of as) {
    for (const id of b.expands) {
      if (!usIds.has(id)) {
        problems.push({ level: "error", kind: "dangling-expands", block: b.id, file: b.file, message: `:expands: us:${id} — no such User Spec block` });
      }
    }
    for (const id of b.dependsOn) {
      if (!asIds.has(id)) {
        problems.push({ level: "error", kind: "dangling-depends", block: b.id, file: b.file, message: `:depends-on: as:${id} — no such Agent Spec block` });
      }
    }
    if (b.expands.length === 0 && b.dependsOn.length === 0) {
      problems.push({ level: "error", kind: "loose", block: b.id, file: b.file, message: "loose block — no :expands: or :depends-on:; link it to the graph or remove it" });
    }
    if (!b.fromLabel) {
      problems.push({ level: "error", kind: "no-id", block: b.id, file: b.file, message: "id came from a heading slug — add an explicit (id)= label" });
    }
  }
  return problems;
}
