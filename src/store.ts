import fs from "node:fs";
import path from "node:path";

/** Resolved `.clawloop/` file layout for a project root. */
export interface Paths {
  root: string;
  clawloop: string;
  settings: string;
  state: string;
  /** Durable, committed queue of pending signals. */
  signals: string;
  /** Committed archive of solved signals. */
  signalsDone: string;
  /** Ephemeral, gitignored lease state (who is working on what, until when). */
  leases: string;
  /** Gitignored lock dir guarding queue mutations. */
  queueLock: string;
  userSpec: string;
  agentSpec: string;
  elaboratorDir: string;
  instructions: string;
  diary: string;
}

export interface BackendConfig {
  type: string;
  model: string;
}

export interface Settings {
  userSpec: string;
  agents: {
    elaborator: { backend: BackendConfig };
  };
}

/** Recorded hashes the elaborator writes and the scan reads to detect drift. */
export interface State {
  /** US block content hash, keyed by US block id. */
  usHashes: Record<string, string>;
  /** Per AS block, the hash of each `:depends-on:` target it was last reconciled against. */
  depHashes: Record<string, Record<string, string>>;
}

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

const DEFAULT_SETTINGS: Settings = {
  userSpec: ".clawloop/user-spec",
  agents: { elaborator: { backend: { type: "claude_code_cli", model: "default" } } },
};

export function readSettings(settingsPath: string): Settings {
  return readJson<Settings>(settingsPath, DEFAULT_SETTINGS);
}

/** Resolve the `.clawloop/` paths for a project root, reading the US dir from settings.json. */
export function resolvePaths(root: string): Paths {
  const clawloop = path.join(root, ".clawloop");
  const settings = path.join(clawloop, "settings.json");
  const userSpecRel = readSettings(settings).userSpec;
  const elaboratorDir = path.join(clawloop, "agents", "elaborator");
  return {
    root,
    clawloop,
    settings,
    state: path.join(clawloop, "state.json"),
    signals: path.join(clawloop, "signals.json"),
    signalsDone: path.join(clawloop, "signals-done.json"),
    leases: path.join(clawloop, "leases.json"),
    queueLock: path.join(clawloop, ".queue.lock"),
    userSpec: path.resolve(root, userSpecRel),
    agentSpec: path.join(clawloop, "agent-spec"),
    elaboratorDir,
    instructions: path.join(elaboratorDir, "instructions.md"),
    diary: path.join(elaboratorDir, "diary.md"),
  };
}

export function readState(paths: Paths): State {
  const s = readJson<Partial<State>>(paths.state, {});
  return { usHashes: s.usHashes ?? {}, depHashes: s.depHashes ?? {} };
}

export function writeState(paths: Paths, state: State): void {
  fs.writeFileSync(paths.state, JSON.stringify(state, null, 2) + "\n");
}
