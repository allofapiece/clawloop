import fs from "node:fs";
import path from "node:path";
import { parseBlocks, type Block } from "./spec/parse.js";
import {
  resolvePaths,
  readState,
  readSignals,
  writeSignals,
  type Paths,
  type Signal,
} from "./store.js";

export interface ScanResult {
  /** Signals newly created by this scan. */
  created: Signal[];
  /** The full signals list after the scan (existing + created). */
  signals: Signal[];
}

export interface ScanOptions {
  cwd?: string;
  /** Clock injection for deterministic tests. */
  now?: () => string;
}

/** Read every `.md` file under `dir` (recursively) and parse it into blocks. */
function loadBlocks(dir: string): Block[] {
  if (!fs.existsSync(dir)) return [];
  const blocks: Block[] = [];
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const file = path.join(entry.parentPath, entry.name);
    const stem = path.basename(entry.name, ".md");
    blocks.push(...parseBlocks(fs.readFileSync(file, "utf8"), stem));
  }
  return blocks;
}

function nextSignalId(existing: Signal[]): number {
  let max = 0;
  for (const s of existing) {
    const n = Number(s.id.replace(/^sig-/, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/**
 * Scan the User Spec and Agent Spec and emit elaboration signals:
 *   - `uncovered` — a US block that no AS block expands.
 *   - `changed`   — a covered US block whose content hash differs from the recorded hash in state.json.
 *
 * Idempotent: a `(type, target)` already present in signals.json is not duplicated.
 */
export function scan(options: ScanOptions = {}): ScanResult {
  const root = path.resolve(options.cwd ?? process.cwd());
  const now = options.now ?? (() => new Date().toISOString());
  const paths: Paths = resolvePaths(root);

  const usBlocks = loadBlocks(paths.userSpec);
  const asBlocks = loadBlocks(paths.agentSpec);
  const recorded = readState(paths).usHashes;

  // US ids directly expanded by some AS block.
  const covered = new Set<string>();
  for (const as of asBlocks) {
    for (const ref of as.expands) {
      if (ref.kind === "us") covered.add(ref.id);
    }
  }

  const signals = readSignals(paths);
  const present = new Set(signals.map((s) => `${s.type}:${s.target}`));
  const created: Signal[] = [];
  let id = nextSignalId(signals);

  const emit = (type: Signal["type"], target: string) => {
    const key = `${type}:${target}`;
    if (present.has(key)) return;
    present.add(key);
    const signal: Signal = { id: `sig-${id++}`, type, target, createdAt: now() };
    created.push(signal);
    signals.push(signal);
  };

  for (const us of usBlocks) {
    if (!covered.has(us.id)) emit("uncovered", us.id);
    else if (recorded[us.id] !== us.hash) emit("changed", us.id);
  }

  if (created.length > 0) writeSignals(paths, signals);

  return { created, signals };
}
