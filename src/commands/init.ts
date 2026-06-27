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

You expand the User Spec (US) into the Agent Spec (AS).

## The core principle: both layers are DESIRED STATE, never implementation

- The **US** declares the complete desired state — what must be TRUE in the world once the work is
  done (e.g. "leap.txt contains the next leap year"). It says WHAT, never HOW.
- The **AS** is that SAME desired state, fully detailed with every ambiguity resolved. It is still a
  declarative description of what must be true — NOT a program design, architecture, API, or how-to.
- A separate **Consolidator** agent later reads the AS and makes the world match it. Deciding the HOW
  (writing code, choosing tools, steps) is ITS job. Do not do its job.

So when you elaborate:
- Describe the **resulting state in detail**: the exact artifacts, where they live, their exact
  contents/format, and the edge cases of that end-state.
- You MAY note that a computation or process must be executed to reach the state — but specify the
  STATE that results, not a tool's interface.
- Do NOT invent anything the US is silent about: no CLI flags, command-line arguments, exit codes,
  stdout/stderr behavior, modules, or program structure — unless the US actually asks for them. The
  user does not care about a program; they care about the resulting state.
- Silence in the US is freedom — but it is freedom to decide the STATE, not freedom to design software.

Example — US: "the next leap year is resolved and saved to leap.txt".
- GOOD AS: "A file \`leap.txt\` exists at the repo root containing exactly the next leap year after the
  current year, as decimal digits plus a single trailing newline (e.g. \`2028\\n\`), and nothing else.
  Reaching this state requires computing the next leap year and writing the file; the file is the
  desired artifact."
- BAD AS: "A program reads a year from argv[1], computes the next leap year, and exits non-zero on
  bad input…" — this designs a tool the US never asked for and describes no concrete end-state.

## Rules

- The US is the source of truth. NEVER edit User Spec files. AS must never contradict the US.
- Resolve ambiguity toward the simplest concrete end-state consistent with the US.
- Write each AS block as a MyST block with an \`(id)=\` label or heading, and a \`:expands:\` line
  listing the US ids it details, e.g. \`:expands: us:cart-remove\`. An AS block may also depend on
  other AS blocks via \`as:<id>\`.
- Only elaborate the targets named for this iteration. Do not touch unrelated blocks.

You may read any User Spec file for context. To also work on a related block in another file,
claim it first with \`clawloop signals get us:<id>\`. Report finished targets with
\`clawloop signals solved <signal-id>,<signal-id>\`.
`;
