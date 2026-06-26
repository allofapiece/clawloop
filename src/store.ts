import fs from "node:fs";
import path from "node:path";

/** Layout of the agent-owned files under `.clawloop/`. AS is fixed; US path comes from settings. */
export interface Paths {
  root: string;
  clawloop: string;
  settings: string;
  state: string;
  signals: string;
  userSpec: string;
  agentSpec: string;
}

interface Settings {
  userSpec: string;
}

/** Recorded US content hashes, keyed by US block id. Written by the Elaborator; read by the scan. */
export interface State {
  usHashes: Record<string, string>;
}

export interface Signal {
  id: string;
  type: "uncovered" | "changed";
  /** The US block id this signal is about. */
  target: string;
  createdAt: string;
}

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/** Resolve the `.clawloop/` paths for a project root, reading the US dir from settings.json. */
export function resolvePaths(root: string): Paths {
  const clawloop = path.join(root, ".clawloop");
  const settings = path.join(clawloop, "settings.json");
  const userSpecRel = readJson<Settings>(settings, { userSpec: ".clawloop/user-spec" }).userSpec;
  return {
    root,
    clawloop,
    settings,
    state: path.join(clawloop, "state.json"),
    signals: path.join(clawloop, "signals.json"),
    userSpec: path.resolve(root, userSpecRel),
    agentSpec: path.join(clawloop, "agent-spec"),
  };
}

export function readState(paths: Paths): State {
  return readJson<State>(paths.state, { usHashes: {} });
}

export function readSignals(paths: Paths): Signal[] {
  return readJson<Signal[]>(paths.signals, []);
}

export function writeSignals(paths: Paths, signals: Signal[]): void {
  fs.writeFileSync(paths.signals, JSON.stringify(signals, null, 2) + "\n");
}
