import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../src/commands/init.js";
import { resolvePaths } from "../src/store.js";
import { validateSpec } from "../src/spec/audit.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clawloop-spec-"));
  runInit({ cwd: tmp });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const usFile = (name: string, body: string) =>
  fs.writeFileSync(path.join(tmp, ".clawloop/user-spec", name), body);
const asFile = (name: string, body: string) =>
  fs.writeFileSync(path.join(tmp, ".clawloop/agent-spec", name), body);

const audit = () => validateSpec(resolvePaths(tmp));
const kinds = () => audit().map((p) => p.kind);

describe("validateSpec", () => {
  it("passes clean for a well-formed AS", () => {
    usFile("u.md", "(general)=\n# General\nDesired state.");
    asFile("a.md", "(as-main)=\n## Main\n:expands: us:general\n\nbody");
    expect(audit()).toEqual([]);
  });

  it("flags a dangling :expands: (us block missing)", () => {
    asFile("a.md", "(as-x)=\n## X\n:expands: us:ghost\n\nbody");
    expect(kinds()).toContain("dangling-expands");
  });

  it("flags a dangling :depends-on: (as block missing)", () => {
    usFile("u.md", "(general)=\n# General\nstate");
    asFile("a.md", "(as-x)=\n## X\n:expands: us:general\n:depends-on: as:nope\n\nbody");
    expect(kinds()).toContain("dangling-depends");
  });

  it("flags loose and heading-slug-id blocks as errors", () => {
    // no (id)= label, no :expands:/:depends-on:
    asFile("a.md", "## Technology decisions\n\nUse Three.js.");
    const found = kinds();
    expect(found).toContain("loose");
    expect(found).toContain("no-id");
    expect(audit().every((p) => p.level === "error")).toBe(true);
  });
});
