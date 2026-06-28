import fs from "node:fs";
import path from "node:path";
import { loadBlocks } from "../spec/load.js";
import { readState, writeState, type Paths } from "../store.js";
import type { Backend } from "../backend/backend.js";
import type { Batch } from "../signals/types.js";
import { buildElaboratorPrompt } from "./prompt.js";

const DIARY_TAIL_LINES = 20;

/** Run one batch through the backend. The agent writes AS files (and may call the `signals` CLI). */
export async function runElaboration(batch: Batch, backend: Backend, paths: Paths): Promise<void> {
  const prompt = buildElaboratorPrompt({
    instructions: readText(paths.instructions),
    usContext: buildUsContext(paths),
    diaryTail: diaryTail(paths),
    batch,
  });
  await backend.run(prompt, {
    cwd: paths.root,
    env: { CLAWLOOP_OWNER: batch.owner },
  });
}

/** Record the current US hash for each solved target so the scan won't re-flag it. */
export function recordHashes(paths: Paths, targets: string[]): string[] {
  if (targets.length === 0) return [];
  const hashById = new Map(loadBlocks(paths.userSpec).map((b) => [b.id, b.hash]));
  const state = readState(paths);
  const recorded: string[] = [];
  for (const target of new Set(targets)) {
    const hash = hashById.get(target);
    if (hash) {
      state.usHashes[target] = hash;
      recorded.push(target);
    }
  }
  writeState(paths, state);
  return recorded;
}

/** Drop recorded US hashes for removed/orphaned targets so state.json stays clean. */
export function forgetHashes(paths: Paths, targets: string[]): void {
  if (targets.length === 0) return;
  const state = readState(paths);
  for (const target of targets) delete state.usHashes[target];
  writeState(paths, state);
}

/**
 * Reconcile dependency versions: for every AS block that expands one of the just-solved US targets,
 * record the current hash of each of its `:depends-on:` targets. This advances the block's
 * "seen version" so the scan won't re-signal it for a dependency change it has now accounted for.
 * Also prunes entries for AS blocks that no longer exist.
 */
export function recordDepHashes(paths: Paths, solvedUsTargets: string[]): void {
  if (solvedUsTargets.length === 0) return;
  const targets = new Set(solvedUsTargets);
  const as = loadBlocks(paths.agentSpec);
  const hashById = new Map(as.map((b) => [b.id, b.hash]));
  const asIds = new Set(as.map((b) => b.id));
  const state = readState(paths);

  for (const x of as) {
    if (!x.expands.some((u) => targets.has(u))) continue;
    const seen: Record<string, string> = {};
    for (const y of x.dependsOn) {
      const h = hashById.get(y);
      if (h !== undefined) seen[y] = h; // skip dangling deps (validation_failed handles those)
    }
    if (Object.keys(seen).length > 0) state.depHashes[x.id] = seen;
    else delete state.depHashes[x.id];
  }

  for (const id of Object.keys(state.depHashes)) {
    if (!asIds.has(id)) delete state.depHashes[id];
  }
  writeState(paths, state);
}

export function appendDiary(paths: Paths, line: string): void {
  fs.appendFileSync(paths.diary, `${new Date().toISOString()} ${line}\n`);
}

function buildUsContext(paths: Paths): string {
  if (!fs.existsSync(paths.userSpec)) return "";
  const parts: string[] = [];
  for (const entry of fs.readdirSync(paths.userSpec, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const full = path.join(entry.parentPath, entry.name);
    const rel = path.relative(paths.userSpec, full).split(path.sep).join("/");
    parts.push(`----- file: ${rel} -----\n${fs.readFileSync(full, "utf8")}`);
  }
  return parts.join("\n\n");
}

function diaryTail(paths: Paths): string {
  return readText(paths.diary)
    .split("\n")
    .filter((l) => l.trim())
    .slice(-DIARY_TAIL_LINES)
    .join("\n");
}

function readText(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}
