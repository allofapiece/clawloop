import { loadBlocks } from "../spec/load.js";
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

/**
 * clawloop's trust boundary — verify the agent's work, don't take its word. A signal is resolved when:
 *   - orphaned: the target is NO LONGER covered (the dangling AS was removed).
 *   - otherwise: the target IS covered (an AS block expands it).
 */
export function isResolved(signal: Pick<Signal, "type" | "target">, covered: Set<string>): boolean {
  return signal.type === "orphaned" ? !covered.has(signal.target) : covered.has(signal.target);
}
