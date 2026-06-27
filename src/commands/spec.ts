import { resolvePaths } from "../store.js";
import { loadBlocks } from "../spec/load.js";

export interface SpecProblem {
  level: "error" | "warning";
  block: string;
  file: string;
  message: string;
}

/**
 * Validate the Agent Spec against the User Spec and itself. Errors are dangling references (a link to
 * a block that doesn't exist); warnings are tracking hazards (an unlinked block, or an id derived from
 * a heading slug rather than an explicit `(id)=` label). The Elaborator runs this and fixes what it
 * reports before reporting targets solved.
 */
export function validateSpec(cwd: string): SpecProblem[] {
  const paths = resolvePaths(cwd);
  const usIds = new Set(loadBlocks(paths.userSpec).map((b) => b.id));
  const as = loadBlocks(paths.agentSpec);
  const asIds = new Set(as.map((b) => b.id));

  const problems: SpecProblem[] = [];
  for (const b of as) {
    for (const id of b.expands) {
      if (!usIds.has(id)) {
        problems.push({ level: "error", block: b.id, file: b.file, message: `:expands: us:${id} — no such User Spec block` });
      }
    }
    for (const id of b.dependsOn) {
      if (!asIds.has(id)) {
        problems.push({ level: "error", block: b.id, file: b.file, message: `:depends-on: as:${id} — no such Agent Spec block` });
      }
    }
    if (b.expands.length === 0 && b.dependsOn.length === 0) {
      problems.push({ level: "warning", block: b.id, file: b.file, message: "loose block — no :expands: or :depends-on:; link it to the graph or remove it" });
    }
    if (!b.fromLabel) {
      problems.push({ level: "warning", block: b.id, file: b.file, message: `id came from a heading slug — add an (id)= label for a stable id` });
    }
  }
  return problems;
}
