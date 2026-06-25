import fs from "node:fs";
import path from "node:path";

/** Default location for the User Spec, relative to the project root. */
export const DEFAULT_USER_SPEC = ".clawloop/user-spec";

export interface InitOptions {
  /** Project root to scaffold into. Defaults to the current working directory. */
  cwd?: string;
  /** Where the User Spec lives, relative to the project root. Defaults to DEFAULT_USER_SPEC. */
  userSpec?: string;
}

export interface InitResult {
  /** Resolved absolute project root that now holds `.clawloop/`. */
  root: string;
  /** The User Spec path written to settings.json (relative to root, POSIX-style). */
  userSpec: string;
  /** Paths (relative to root) this run created. */
  created: string[];
  /** Paths (relative to root) that already existed and were left untouched. */
  skipped: string[];
}

/** The settings.json clawloop writes on init. */
function settings(userSpec: string) {
  return {
    userSpec,
    agents: {
      elaborator: {
        backend: { type: "claude_code_cli", model: "default" },
      },
    },
  };
}

/** Normalize a user-supplied spec path to a relative, POSIX-style path from the project root. */
function toRelative(root: string, input: string): string {
  const abs = path.resolve(root, input);
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join("/");
}

/**
 * Scaffold `.clawloop/` in the project root: the `user-spec` and `agent-spec` folders and
 * `settings.json`. Idempotent — existing files/folders are left untouched and reported as skipped.
 */
export function runInit(options: InitOptions = {}): InitResult {
  const root = path.resolve(options.cwd ?? process.cwd());
  const userSpec = toRelative(root, options.userSpec ?? DEFAULT_USER_SPEC);
  const created: string[] = [];
  const skipped: string[] = [];

  const ensureDir = (rel: string) => {
    const abs = path.resolve(root, rel);
    if (fs.existsSync(abs)) {
      skipped.push(rel);
      return;
    }
    fs.mkdirSync(abs, { recursive: true });
    created.push(rel);
  };

  ensureDir(".clawloop");
  ensureDir(userSpec);
  ensureDir(".clawloop/agent-spec");

  const settingsRel = ".clawloop/settings.json";
  const settingsAbs = path.resolve(root, settingsRel);
  if (fs.existsSync(settingsAbs)) {
    skipped.push(settingsRel);
  } else {
    fs.writeFileSync(settingsAbs, JSON.stringify(settings(userSpec), null, 2) + "\n");
    created.push(settingsRel);
  }

  return { root, userSpec, created, skipped };
}
