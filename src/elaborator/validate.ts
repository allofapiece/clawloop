import { loadBlocks } from "../spec/load.js";
import { validateSpec } from "../spec/audit.js";
import type { Paths } from "../store.js";
import type { Signal } from "../signals/types.js";

/** The set of US ids currently covered by some AS block's `:expands:`. */
export function loadCoverage(paths: Paths): Set<string> {
  const covered = new Set<string>();
  for (const block of loadBlocks(paths.agentSpec)) {
    for (const id of block.expands) covered.add(id);
  }
  return covered;
}

/** Everything needed to decide whether a signal is resolved: coverage + which files fail validation. */
export interface ResolutionContext {
  covered: Set<string>;
  errorFiles: Set<string>;
}

export function resolutionContext(paths: Paths): ResolutionContext {
  return {
    covered: loadCoverage(paths),
    errorFiles: new Set(validateSpec(paths).map((p) => p.file)),
  };
}

/**
 * clawloop's trust boundary — verify the agent's work, don't take its word. A signal is resolved when:
 *   - orphaned: the target US id is NO LONGER covered (the dangling AS was removed).
 *   - validation_failed: the target file no longer fails validation.
 *   - otherwise (uncovered/changed/revisit): the target US id IS covered (an AS block expands it).
 */
export function isResolved(signal: Pick<Signal, "type" | "target">, ctx: ResolutionContext): boolean {
  switch (signal.type) {
    case "orphaned":
      return !ctx.covered.has(signal.target);
    case "validation_failed":
      return !ctx.errorFiles.has(signal.target);
    default:
      return ctx.covered.has(signal.target);
  }
}
