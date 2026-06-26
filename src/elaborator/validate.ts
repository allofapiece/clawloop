import { loadBlocks } from "../spec/load.js";
import type { Paths } from "../store.js";

/**
 * The set of US ids currently covered by some AS block's `:expands:`. This is clawloop's trust
 * boundary: a target is "solved" iff it appears here — we verify the work, not the agent's word.
 */
export function loadCoverage(paths: Paths): Set<string> {
  const covered = new Set<string>();
  for (const block of loadBlocks(paths.agentSpec)) {
    for (const ref of block.expands) if (ref.kind === "us") covered.add(ref.id);
  }
  return covered;
}
