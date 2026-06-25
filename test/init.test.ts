import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit, DEFAULT_USER_SPEC } from "../src/commands/init.js";
import { parseCliArgs } from "../src/cli.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clawloop-test-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function readSettings() {
  return JSON.parse(fs.readFileSync(path.join(tmp, ".clawloop/settings.json"), "utf8"));
}

describe("runInit", () => {
  it("creates the .clawloop scaffold with default user-spec path", () => {
    const result = runInit({ cwd: tmp });

    expect(fs.existsSync(path.join(tmp, ".clawloop"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, ".clawloop/user-spec"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, ".clawloop/agent-spec"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, ".clawloop/settings.json"))).toBe(true);

    expect(result.userSpec).toBe(DEFAULT_USER_SPEC);
    expect(result.created).toContain(".clawloop");
    expect(result.created).toContain(".clawloop/settings.json");
  });

  it("writes settings.json with relative user-spec path and elaborator backend", () => {
    runInit({ cwd: tmp });
    const settings = readSettings();

    expect(settings.userSpec).toBe(".clawloop/user-spec");
    expect(settings.agents.elaborator.backend).toEqual({
      type: "claude_code_cli",
      model: "default",
    });
  });

  it("respects a custom user-spec path and creates that folder", () => {
    const result = runInit({ cwd: tmp, userSpec: "docs/spec" });

    expect(result.userSpec).toBe("docs/spec");
    expect(fs.existsSync(path.join(tmp, "docs/spec"))).toBe(true);
    expect(readSettings().userSpec).toBe("docs/spec");
  });

  it("stores an absolute user-spec path as relative in settings", () => {
    const abs = path.join(tmp, "custom-spec");
    const result = runInit({ cwd: tmp, userSpec: abs });

    expect(result.userSpec).toBe("custom-spec");
    expect(readSettings().userSpec).toBe("custom-spec");
  });

  it("is idempotent: re-running leaves existing files untouched", () => {
    runInit({ cwd: tmp });
    const settingsPath = path.join(tmp, ".clawloop/settings.json");
    fs.writeFileSync(settingsPath, '{"edited": true}\n');

    const second = runInit({ cwd: tmp });

    expect(second.skipped).toContain(".clawloop/settings.json");
    expect(second.created).not.toContain(".clawloop/settings.json");
    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8"))).toEqual({ edited: true });
  });
});

describe("parseCliArgs", () => {
  it("defaults to help with no args", () => {
    expect(parseCliArgs([])).toEqual({ command: "help" });
  });

  it("parses init", () => {
    expect(parseCliArgs(["init"])).toEqual({ command: "init", yes: false });
  });

  it("parses init -y and --yes", () => {
    expect(parseCliArgs(["init", "-y"])).toEqual({ command: "init", yes: true });
    expect(parseCliArgs(["init", "--yes"])).toEqual({ command: "init", yes: true });
  });

  it("reports an unknown init flag", () => {
    expect(parseCliArgs(["init", "--nope"]).error).toMatch(/unknown flag/);
  });

  it("reports an unknown command", () => {
    expect(parseCliArgs(["bogus"]).error).toMatch(/unknown command/);
  });
});
