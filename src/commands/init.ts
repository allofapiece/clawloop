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

  const ensureFile = (rel: string, content: string) => {
    const abs = path.resolve(root, rel);
    if (fs.existsSync(abs)) {
      skipped.push(rel);
      return;
    }
    fs.writeFileSync(abs, content);
    created.push(rel);
  };

  ensureDir(".clawloop");
  ensureDir(userSpec);
  ensureDir(".clawloop/agent-spec");
  ensureDir(".clawloop/agents/elaborator");

  ensureFile(".clawloop/settings.json", JSON.stringify(settings(userSpec), null, 2) + "\n");
  ensureFile(".clawloop/agents/elaborator/instructions.md", ELABORATOR_INSTRUCTIONS);
  ensureFile(".clawloop/agents/elaborator/diary.md", "");
  ensureFile(".clawloop/.gitignore", CLAWLOOP_GITIGNORE);

  return { root, userSpec, created, skipped };
}

/** Runtime files that are machine-local / regenerable — not the durable, committed spec or queue. */
const CLAWLOOP_GITIGNORE = ["leases.json", ".queue.lock/", ""].join("\n");

/** Default Elaborator prompt. Editable per-project; survives re-init and `git pull`. */
const ELABORATOR_INSTRUCTIONS = `# Elaborator

You expand the User Spec (US) into the Agent Spec (AS): the fully-resolved interpretation, with
every ambiguity decided.

Rules:
- The US is the source of truth. NEVER edit User Spec files. AS must never contradict the US.
- Resolve ambiguity conservatively (least-surprising, reversible defaults); do not invent
  requirements the US doesn't imply.
- Write each AS block as a MyST block with an \`(id)=\` label or heading, and a \`:expands:\` line
  listing the US ids it refines, e.g. \`:expands: us:cart-remove\`. An AS block may also depend on
  other AS blocks via \`as:<id>\`.
- Only elaborate the targets named for this iteration. Do not touch unrelated blocks.

You may read any User Spec file for context. To also work on a related block in another file,
claim it first with \`clawloop signals get us:<id>\`. Report finished targets with
\`clawloop signals solved <signal-id>,<signal-id>\`.
`;
