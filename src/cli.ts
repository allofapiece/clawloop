#!/usr/bin/env node
import * as readline from "node:readline/promises";
import { realpathSync } from "node:fs";
import { stdin, stdout, argv } from "node:process";
import { fileURLToPath } from "node:url";
import { runInit, DEFAULT_USER_SPEC } from "./commands/init.js";

interface ParsedCli {
  command: "init" | "run" | "scan" | "signals" | "help";
  /** init: skip the interactive survey and use defaults. */
  yes?: boolean;
  /** run: do a single iteration and exit. */
  once?: boolean;
  /** run: raise log level to debug. */
  debug?: boolean;
  /** signals: the subcommand. */
  signalsAction?: "get" | "solved";
  /** signals get: the us ref. */
  ref?: string;
  /** signals solved: the signal ids. */
  ids?: string[];
  /** A parse error to report instead of running. */
  error?: string;
}

/** Parse argv (already sliced past `node cli.js`). Pure: no I/O, safe to import in tests. */
export function parseCliArgs(argv: string[]): ParsedCli {
  const args = argv.filter((a) => a.length > 0);
  if (args.length === 0) return { command: "help" };

  const [first, ...rest] = args;
  if (first === "--help" || first === "-h" || first === "help") return { command: "help" };

  if (first === "init") {
    let yes = false;
    for (const a of rest) {
      if (a === "-y" || a === "--yes") yes = true;
      else return { command: "init", error: `unknown flag "${a}" for init` };
    }
    return { command: "init", yes };
  }

  if (first === "run") {
    let once = false;
    let debug = false;
    for (const a of rest) {
      if (a === "--once") once = true;
      else if (a === "--debug") debug = true;
      else return { command: "run", error: `unknown flag "${a}" for run` };
    }
    return { command: "run", once, debug };
  }

  if (first === "scan") {
    if (rest.length > 0) return { command: "scan", error: `\`scan\` takes no arguments (got "${rest.join(" ")}")` };
    return { command: "scan" };
  }

  if (first === "signals") {
    const [action, ...args] = rest;
    if (action === "get") {
      if (args.length !== 1) return { command: "signals", error: "`signals get` needs exactly one <us:id>" };
      return { command: "signals", signalsAction: "get", ref: args[0] };
    }
    if (action === "solved") {
      const ids = args.flatMap((a) => a.split(",")).filter(Boolean);
      if (ids.length === 0) return { command: "signals", error: "`signals solved` needs one or more <signal-id>" };
      return { command: "signals", signalsAction: "solved", ids };
    }
    return { command: "signals", error: `unknown signals subcommand "${action ?? ""}" (use get | solved)` };
  }

  return { command: "help", error: `unknown command "${first}"` };
}

const HELP = [
  "clawloop — spec-as-desired-state multi-agent coding orchestrator.",
  "",
  "Usage: clawloop <command> [options]",
  "",
  "Commands:",
  "  init [-y]    Scaffold .clawloop/ in the current directory.",
  "               -y, --yes   skip the survey and use defaults.",
  "  run [--once] [--debug]   Drive elaboration until Ctrl-C (--once: one iteration; --debug: verbose).",
  "  scan         Scan US/AS once and enqueue signals.",
  "  signals get <us:id>        Claim another block's batch (agent, in-iteration).",
  "  signals solved <ids>       Mark signals solved (agent, in-iteration).",
  "  help         Show this help.",
  "",
].join("\n");

/** Run the interactive init survey, then scaffold. Returns nothing; prints results. */
async function runInitCommand(yes: boolean): Promise<void> {
  let userSpec = DEFAULT_USER_SPEC;

  if (!yes) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await rl.question(`Where is the User Spec stored? (${DEFAULT_USER_SPEC}) `)).trim();
      if (answer) userSpec = answer;
    } finally {
      rl.close();
    }
  }

  const result = runInit({ userSpec });

  if (result.created.length > 0) {
    stdout.write(`Created in ${result.root}:\n`);
    for (const p of result.created) stdout.write(`  + ${p}\n`);
  }
  if (result.skipped.length > 0) {
    stdout.write(`Already existed (left untouched):\n`);
    for (const p of result.skipped) stdout.write(`  · ${p}\n`);
  }
}

/** The agent-facing `signals` subcommands. `CLAWLOOP_OWNER` ties them to the running iteration. */
async function runSignalsCommand(parsed: ParsedCli): Promise<void> {
  const owner = process.env.CLAWLOOP_OWNER;
  if (!owner) {
    stdout.write("CLAWLOOP_OWNER is not set — `signals get/solved` run inside an elaboration iteration.\n");
    process.exitCode = 1;
    return;
  }
  const ctx = { cwd: process.cwd(), owner };
  const { signalsGet, signalsSolved } = await import("./commands/signals.js");

  if (parsed.signalsAction === "get") {
    const res = signalsGet(ctx, parsed.ref!);
    if (res.reason) {
      stdout.write(`${res.reason}\n`);
      process.exitCode = 1;
    } else {
      stdout.write(res.claimed!.map((s) => `${s.id}\t${s.type}\tus:${s.target}`).join("\n") + "\n");
    }
    return;
  }

  const res = signalsSolved(ctx, parsed.ids!);
  if (res.solved.length) stdout.write(`solved: ${res.solved.join(", ")}\n`);
  for (const r of res.rejected) stdout.write(`rejected ${r.id}: ${r.reason}\n`);
  if (res.rejected.length) process.exitCode = 1;
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));

  if (parsed.error) {
    stdout.write(`${parsed.error}\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }

  switch (parsed.command) {
    case "init":
      await runInitCommand(parsed.yes ?? false);
      return;
    case "run": {
      const { setLogLevel } = await import("./log.js");
      setLogLevel(parsed.debug ? "debug" : "info");
      const { run } = await import("./run.js");
      await run({ once: parsed.once });
      return;
    }
    case "scan": {
      const { scan } = await import("./scan.js");
      const { created, pending } = scan();
      stdout.write(`scan: ${created.length} new signal(s), ${pending.length} pending\n`);
      return;
    }
    case "signals":
      await runSignalsCommand(parsed);
      return;
    case "help":
      stdout.write(HELP);
      return;
  }
}

// Only run when invoked directly (not when imported by tests). argv[1] may be a bin symlink
// (e.g. via `npm link`), so resolve it to the real path before comparing.
if (argv[1] && realpathSync(argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    stdout.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
