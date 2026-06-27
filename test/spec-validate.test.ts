import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../src/commands/init.js";
import { validateSpec } from "../src/commands/spec.js";

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

function messages(level: "error" | "warning") {
  return validateSpec(tmp)
    .filter((p) => p.level === level)
    .map((p) => p.message);
}

describe("validateSpec", () => {
  it("passes clean for a well-formed AS", () => {
    usFile("u.md", "(general)=\n# General\nDesired state.");
    asFile("a.md", "(as-main)=\n## Main\n:expands: us:general\n\nbody");
    expect(validateSpec(tmp)).toEqual([]);
  });

  it("errors on a dangling :expands: (us block missing)", () => {
    asFile("a.md", "(as-x)=\n## X\n:expands: us:ghost\n\nbody");
    expect(messages("error")).toContain(":expands: us:ghost — no such User Spec block");
  });

  it("errors on a dangling :depends-on: (as block missing)", () => {
    usFile("u.md", "(general)=\n# General\nstate");
    asFile("a.md", "(as-x)=\n## X\n:expands: us:general\n:depends-on: as:nope\n\nbody");
    expect(messages("error")).toContain(":depends-on: as:nope — no such Agent Spec block");
  });

  it("warns on a loose block and on a heading-slug id", () => {
    // no (id)= label, no :expands:/:depends-on: → both warnings
    asFile("a.md", "## Technology decisions\n\nUse Three.js.");
    const warns = messages("warning");
    expect(warns).toContain("loose block — no :expands: or :depends-on:; link it to the graph or remove it");
    expect(warns.some((m) => m.includes("heading slug"))).toBe(true);
  });
});
