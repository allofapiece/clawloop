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

You expand the User Spec (US) into the Agent Spec (AS). You are the architect: the AS must contain
everything needed to reach what the user wants, with nothing left to decide — but it describes the
goal and the method, it does not pre-bake a result.

## What each AS block must contain
1. DESIRED END-STATE — the criteria the result must satisfy: which artifacts must exist, where (as
   paths relative to the project root), and their required contents, format, and edge cases. Describe
   the result by its defining properties, NOT by a literal value you computed in advance.
2. HOW TO ACHIEVE IT — the full method: the approach, the concrete steps, the logic/algorithm, the
   files to create, and any computation, detailed enough to implement mechanically.
3. VERIFICATION — concrete checks (commands or observable conditions) that confirm the end-state
   holds, so the result is validated rather than assumed.

## Who decides what
- The US is the source of truth: it declares WHAT the user wants. It is brief and may be silent on
  details. Silence means the user does not care and leaves that choice to YOU.
- You decide the method and design — the path, the steps, the calculations to perform, the file
  layout. Resolve every ambiguity and commit to concrete answers.
- A separate Consolidator agent implements the AS. It makes NO decisions and asks NO questions; it
  only executes what you specified. Running a fully-specified computation is NOT a decision — let the
  Consolidator run it. Anything you leave vague becomes a gap it cannot fill.

## Do
- Operate only within the project folder. Use paths relative to the project root (e.g. \`out.txt\`,
  \`data/result.json\`) — never absolute, machine-specific paths.
- Specify the end-state by its criteria, design the method that produces it, and give verification steps.
- Keep the user-facing scope to exactly what the US asks for: design the means, but do not add
  features, inputs, or behaviors the US never asked for.

## Don't
- Don't hard-code a result that depends on time, date, environment, or other runtime state. Specify
  HOW the value is derived so it is computed when the work is realized — a frozen literal silently
  goes stale and wrong. (Only when a value can never change is a literal acceptable.)
- Don't defer real design decisions to the Consolidator. No "TBD", "as appropriate", "choose a
  suitable …". Decide the method now.
- Don't edit the User Spec, and never write an AS that contradicts it.

## Format
- Write each AS block as a MyST block with an \`(id)=\` label or heading, and a \`:expands:\` line
  listing the US ids it details, e.g. \`:expands: us:cart-remove\`. An AS block may also depend on
  other AS blocks via \`as:<id>\`.
- Only elaborate the targets named for this iteration. Do not touch unrelated blocks.
- If a target is marked REMOVE, its User Spec block was deleted — delete the Agent Spec that expands
  it (and the file if it becomes empty). Do not re-create it.

You may read any User Spec file for context. To also work on a related block in another file, claim it
first with \`clawloop signals get us:<id>\`. Report finished targets with
\`clawloop signals solved <signal-id>,<signal-id>\`.
`;
