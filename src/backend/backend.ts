export interface BackendRunOptions {
  /** Working directory the agent runs in (the project root). */
  cwd: string;
  /** Extra env vars for the agent process (e.g. CLAWLOOP_OWNER for the signals subcommands). */
  env?: Record<string, string>;
}

export interface BackendResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * An LLM backend that runs a prompt as an autonomous agent with file access. `ClaudeCodeBackend` is
 * the only impl today; the seam lets us add e.g. a Codex backend without touching the elaborator.
 */
export interface Backend {
  run(prompt: string, opts: BackendRunOptions): Promise<BackendResult>;
}
