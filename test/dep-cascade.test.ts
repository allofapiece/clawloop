import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../src/commands/init.js";
import { scan } from "../src/scan.js";
import { resolvePaths, readState, writeState } from "../src/store.js";
import { recordDepHashes } from "../src/elaborator/elaborator.js";
import { parseBlocks } from "../src/spec/parse.js";

let tmp: string;
const NOW = () => "2026-06-27T00:00:00.000Z";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clawloop-dep-"));
  runInit({ cwd: tmp });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const usFile = (name: string, body: string) =>
  fs.writeFileSync(path.join(tmp, ".clawloop/user-spec", name), body);
const asFile = (name: string, body: string) =>
  fs.writeFileSync(path.join(tmp, ".clawloop/agent-spec", name), body);

const hashOf = (text: string, id: string) => parseBlocks(text, "f").find((b) => b.id === id)!.hash;

// X (as:asx, expands us:u1) depends on Y (as:asy, expands us:u2).
const US = "(u1)=\n# U1\nuno\n\n(u2)=\n# U2\ndos";
const Y = "(asy)=\n## Y\n:expands: us:u2\n\nY body";
const X = "(asx)=\n## X\n:expands: us:u1\n:depends-on: as:asy\n\nX body";

function converged(asyDepHash: string) {
  usFile("u.md", US);
  asFile("y.md", Y);
  asFile("x.md", X);
  writeState(resolvePaths(tmp), {
    usHashes: { u1: hashOf(US, "u1"), u2: hashOf(US, "u2") },
    depHashes: { asx: { asy: asyDepHash } },
  });
}

describe("dependency cascade", () => {
  it("emits dep-changed when the dependency drifted from the reconciled version", () => {
    converged("a-stale-hash"); // X was reconciled against an old Y

    const dc = scan({ cwd: tmp, now: NOW }).created.filter((s) => s.type === "dep-changed");

    expect(dc).toHaveLength(1);
    expect(dc[0]).toMatchObject({ type: "dep-changed", target: "u1", file: "u.md" });
    expect(dc[0].detail).toContain("as:asy");
  });

  it("stays quiet once X is reconciled against the current Y", () => {
    converged(hashOf(Y, "asy")); // depHashes already matches current Y

    expect(scan({ cwd: tmp, now: NOW }).created.filter((s) => s.type === "dep-changed")).toEqual([]);
  });

  it("recordDepHashes advances the seen version so the next scan is quiet", () => {
    converged("a-stale-hash");

    recordDepHashes(resolvePaths(tmp), ["u1"]); // re-elaborated us:u1 → X reconciled to current Y

    expect(readState(resolvePaths(tmp)).depHashes.asx.asy).toBe(hashOf(Y, "asy"));
    expect(scan({ cwd: tmp, now: NOW }).created.filter((s) => s.type === "dep-changed")).toEqual([]);
  });
});
