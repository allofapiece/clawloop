import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../src/commands/init.js";
import { resolvePaths } from "../src/store.js";
import { JsonSignalsManager } from "../src/signals/json-manager.js";
import { signalsGet, signalsSolved, signalsAdd } from "../src/commands/signals.js";
import { scan } from "../src/scan.js";

let tmp: string;
const now = () => "2026-06-26T00:00:00.000Z";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clawloop-sigcmd-"));
  runInit({ cwd: tmp });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const usFile = (name: string, body: string) =>
  fs.writeFileSync(path.join(tmp, ".clawloop/user-spec", name), body);
const asFile = (name: string, body: string) =>
  fs.writeFileSync(path.join(tmp, ".clawloop/agent-spec", name), body);

function manager() {
  return new JsonSignalsManager(resolvePaths(tmp), { now });
}

describe("signals get", () => {
  it("claims the file batch containing the requested US block", () => {
    usFile("wishlist.md", "(wish-add)=\nAdd to wishlist.");
    const m = manager();
    scan({ cwd: tmp, manager: m });

    const res = signalsGet({ cwd: tmp, owner: "w1", manager: m }, "us:wish-add");
    expect(res.claimed?.map((s) => s.target)).toEqual(["wish-add"]);
    // now leased by w1 — a different owner can't claim it
    expect(signalsGet({ cwd: tmp, owner: "w2", manager: m }, "#us:wish-add").reason).toMatch(/leased/);
  });

  it("reports when there is no pending signal for the block", () => {
    const res = signalsGet({ cwd: tmp, owner: "w1", manager: manager() }, "us:nope");
    expect(res.reason).toMatch(/no pending signal/);
  });
});

describe("signals add (revisit)", () => {
  it("queues a revisit for every US block with revisit:all", () => {
    usFile("a.md", "(one)=\nfirst");
    usFile("b.md", "(two)=\nsecond");
    const m = manager();

    const res = signalsAdd({ cwd: tmp, manager: m }, "all");

    expect(res.created.map((s) => s.target).sort()).toEqual(["one", "two"]);
    expect(res.created.every((s) => s.type === "revisit")).toBe(true);
    expect(m.list().map((s) => `${s.type}:${s.target}`).sort()).toEqual(["revisit:one", "revisit:two"]);
  });

  it("queues a revisit for a single US block by id", () => {
    usFile("a.md", "(one)=\nfirst\n\n(two)=\nsecond");
    const m = manager();

    const res = signalsAdd({ cwd: tmp, manager: m }, "two");

    expect(res.created).toHaveLength(1);
    expect(res.created[0]).toMatchObject({ type: "revisit", target: "two", file: "a.md" });
  });

  it("reports when the ref matches no block or pending signal", () => {
    usFile("a.md", "(one)=\nfirst");
    const res = signalsAdd({ cwd: tmp, manager: manager() }, "nope");
    expect(res.reason).toMatch(/no US block or pending signal/);
  });

  it("dedupes a revisit that is already pending", () => {
    usFile("a.md", "(one)=\nfirst");
    const m = manager();
    signalsAdd({ cwd: tmp, manager: m }, "one");
    const second = signalsAdd({ cwd: tmp, manager: m }, "one");
    expect(second.created).toHaveLength(0);
    expect(m.list()).toHaveLength(1);
  });
});

describe("signals solved", () => {
  it("archives an owned, covered signal and rejects one without AS", () => {
    usFile("cart.md", "(a)=\nfirst\n\n(b)=\nsecond");
    const m = manager();
    scan({ cwd: tmp, manager: m });
    const batch = m.claimBatch("w1")!; // both a and b (same file)
    const idA = batch.signals.find((s) => s.target === "a")!.id;
    const idB = batch.signals.find((s) => s.target === "b")!.id;

    // agent wrote AS for `a` only
    asFile("cart.md", "(as-a)=\n## A\n:expands: us:a\n\nbody");

    const res = signalsSolved({ cwd: tmp, owner: "w1", manager: m }, [idA, idB]);
    expect(res.solved).toEqual([idA]);
    expect(res.rejected).toEqual([{ id: idB, reason: "no AS block expands us:b" }]);

    // a is archived + hash recorded; b is still leased/pending
    expect(m.list().map((s) => s.target)).toEqual(["b"]);
    const state = JSON.parse(fs.readFileSync(resolvePaths(tmp).state, "utf8"));
    expect(state.usHashes.a).toBeTruthy();
  });

  it("rejects solving a signal the owner does not hold", () => {
    usFile("cart.md", "(a)=\nfirst");
    const m = manager();
    scan({ cwd: tmp, manager: m });
    const batch = m.claimBatch("w1")!;

    const res = signalsSolved({ cwd: tmp, owner: "someone-else", manager: m }, [batch.signals[0].id]);
    expect(res.solved).toEqual([]);
    expect(res.rejected[0].reason).toMatch(/not leased by you/);
  });
});
