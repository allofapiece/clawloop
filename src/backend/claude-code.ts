import { spawn } from "node:child_process";
import type { Backend, BackendResult, BackendRunOptions } from "./backend.js";
import type { BackendConfig } from "../store.js";

/**
 * Runs the prompt via the Claude Code CLI in non-interactive print mode, auto-accepting edits so it
 * can write Agent Spec files without a human-in-the-loop. The CLI is the agent: it reads the US,
 * writes `agent-spec/*.md`, and exits.
 */
export class ClaudeCodeBackend implements Backend {
  constructor(
    private readonly model: string,
    private readonly bin = process.env.CLAWLOOP_CLAUDE_BIN ?? "claude",
  ) {}

  run(prompt: string, opts: BackendRunOptions): Promise<BackendResult> {
    const args = ["-p", prompt, "--permission-mode", "acceptEdits"];
    if (this.model !== "default") args.push("--model", this.model);

    return new Promise((resolve) => {
      const child = spawn(this.bin, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (err) => resolve({ ok: false, stdout, stderr: stderr + String(err) }));
      child.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
    });
  }
}

/** Build the backend for a settings `backend` config. */
export function createBackend(cfg: BackendConfig): Backend {
  if (cfg.type === "claude_code_cli") return new ClaudeCodeBackend(cfg.model);
  throw new Error(`unknown backend type "${cfg.type}"`);
}
