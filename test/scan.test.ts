import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../src/commands/init.js";
import { scan } from "../src/scan.js";
import { parseBlocks } from "../src/spec/parse.js";

let tmp: string;
const NOW = () => "2026-06-26T00:00:00.000Z";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clawloop-scan-"));
  runInit({ cwd: tmp }); // default layout: .clawloop/user-spec, .clawloop/agent-spec
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const usFile = (name: string, body: string) =>
  fs.writeFileSync(path.join(tmp, ".clawloop/user-spec", name), body);
const asFile = (name: string, body: string) =>
  fs.writeFileSync(path.join(tmp, ".clawloop/agent-spec", name), body);
const writeState = (usHashes: Record<string, string>) =>
  fs.writeFileSync(path.join(tmp, ".clawloop/state.json"), JSON.stringify({ usHashes }));

describe("scan", () => {
  it("emits an uncovered signal for a US block no AS block expands", () => {
    usFile("cart.md", "(cart-remove)=\nEach cart row has a remove control.");

    const { created } = scan({ cwd: tmp, now: NOW });

    expect(created).toEqual([
      { id: "sig-1", type: "uncovered", target: "cart-remove", file: "cart.md", attempt: 0, createdAt: NOW() },
    ]);
  });

  it("does not emit for a covered US block whose recorded hash matches", () => {
    usFile("cart.md", "(cart-remove)=\nEach cart row has a remove control.");
    asFile("btn.md", "(as-btn)=\n## Button\n:expands: us:cart-remove\n\nbody");
    const hash = parseHash("(cart-remove)=\nEach cart row has a remove control.");
    writeState({ "cart-remove": hash });

    expect(scan({ cwd: tmp, now: NOW }).created).toEqual([]);
  });

  it("emits a changed signal when a covered US block's content drifts from the recorded hash", () => {
    usFile("cart.md", "(cart-remove)=\nNew, edited requirement text.");
    asFile("btn.md", "(as-btn)=\n## Button\n:expands: us:cart-remove\n\nbody");
    writeState({ "cart-remove": "stale-hash-value" });

    const { created } = scan({ cwd: tmp, now: NOW });

    expect(created).toEqual([
      { id: "sig-1", type: "changed", target: "cart-remove", file: "cart.md", attempt: 0, createdAt: NOW() },
    ]);
  });

  it("detects a real edit: record v1's hash, edit the block, scan flags changed", () => {
    const v1 = "(cart-remove)=\nEach cart row has a remove control.";
    usFile("cart.md", v1);
    asFile("btn.md", "(as-btn)=\n## Button\n:expands: us:cart-remove\n\nbody");
    writeState({ "cart-remove": parseHash(v1) }); // the real hash, as the Elaborator would record it

    // Unchanged → no signal.
    expect(scan({ cwd: tmp, now: NOW }).created).toEqual([]);

    // Edit the requirement text → scan must notice the drift.
    usFile("cart.md", "(cart-remove)=\nEach cart row has a remove control, with a confirm dialog.");
    expect(scan({ cwd: tmp, now: NOW }).created).toEqual([
      { id: "sig-1", type: "changed", target: "cart-remove", file: "cart.md", attempt: 0, createdAt: NOW() },
    ]);
  });

  it("is idempotent: re-running does not duplicate signals", () => {
    usFile("cart.md", "(cart-remove)=\nEach cart row has a remove control.");

    const first = scan({ cwd: tmp, now: NOW });
    const second = scan({ cwd: tmp, now: NOW });

    expect(first.created).toHaveLength(1);
    expect(second.created).toHaveLength(0);
    expect(second.pending).toHaveLength(1);
  });

  it("emits an orphaned signal when an AS expands a US block that no longer exists", () => {
    // AS references us:gone, but no US block defines it (the US file was deleted).
    asFile("ghost.md", "(as-ghost)=\n## Ghost\n:expands: us:gone\n\nbody");

    const { created } = scan({ cwd: tmp, now: NOW });

    expect(created).toEqual([
      { id: "sig-1", type: "orphaned", target: "gone", file: "ghost.md", attempt: 0, createdAt: NOW() },
    ]);
  });

  it("does not emit orphaned when the US block still exists", () => {
    usFile("cart.md", "(cart-remove)=\nremove control");
    asFile("btn.md", "(as-btn)=\n## Button\n:expands: us:cart-remove\n\nbody");
    writeState({ "cart-remove": parseHash("(cart-remove)=\nremove control") });

    const orphans = scan({ cwd: tmp, now: NOW }).created.filter((s) => s.type === "orphaned");
    expect(orphans).toEqual([]);
  });

  it("drops a stale US-side signal when its block is deleted, keeping only the orphaned signal", () => {
    // 1) a US block with no AS yet → uncovered signal queued
    usFile("beta.md", "(beta)=\nBeta desired state.");
    expect(scan({ cwd: tmp, now: NOW }).created.map((s) => s.type)).toEqual(["uncovered"]);

    // 2) the US block is deleted, but an AS block still expands it
    fs.rmSync(path.join(tmp, ".clawloop/user-spec/beta.md"));
    asFile("beta.md", "(as-beta)=\n## Beta\n:expands: us:beta\n\nbody");

    const result = scan({ cwd: tmp, now: NOW });

    expect(result.dropped.map((s) => s.type)).toEqual(["uncovered"]); // stale uncovered pruned
    expect(result.pending.map((s) => `${s.type}:${s.target}`)).toEqual(["orphaned:beta"]); // only orphan remains
  });

  it("errors on a globally-duplicate US block id across files", () => {
    usFile("a.md", "(dup)=\nfirst");
    usFile("b.md", "(dup)=\nsecond");
    expect(() => scan({ cwd: tmp, now: NOW })).toThrow(/duplicate User Spec block id/);
  });

  it("persists signals to .clawloop/signals.json", () => {
    usFile("cart.md", "(cart-remove)=\nremove control");
    scan({ cwd: tmp, now: NOW });

    const written = JSON.parse(fs.readFileSync(path.join(tmp, ".clawloop/signals.json"), "utf8"));
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ type: "uncovered", target: "cart-remove" });
  });
});

// Mirror the scan's hashing so the "matches" test pins real behavior, not a copied constant.
function parseHash(text: string): string {
  return parseBlocks(text, "cart")[0].hash;
}
