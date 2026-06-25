#!/usr/bin/env node
import * as readline from "node:readline/promises";
import { stdin, stdout, argv } from "node:process";
import { fileURLToPath } from "node:url";
import { runInit, DEFAULT_USER_SPEC } from "./commands/init.js";

interface ParsedCli {
  command: "init" | "help";
  /** init: skip the interactive survey and use defaults. */
  yes?: boolean;
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

  return { command: "help", error: `unknown command "${first}"` };
}

const HELP = [
  "clawloop — spec-as-desired-state multi-agent coding orchestrator.",
  "",
  "Usage: clawloop <command> [options]",
  "",
  "Commands:",
  "  init [-y]   Scaffold .clawloop/ in the current directory.",
  "              -y, --yes   skip the survey and use defaults.",
  "  help        Show this help.",
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
    case "help":
      stdout.write(HELP);
      return;
  }
}

// Only run when invoked directly (not when imported by tests).
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  main().catch((err) => {
    stdout.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
