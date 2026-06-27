import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../src/commands/init.js";
import { resolvePaths } from "../src/store.js";
import { JsonSignalsManager } from "../src/signals/json-manager.js";

let tmp: string;
let clock: number;
const now = () => new Date(clock).toISOString();

function makeManager(ttlMs = 120_000) {
  return new JsonSignalsManager(resolvePaths(tmp), { now, ttlMs });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clawloop-sig-"));
  runInit({ cwd: tmp });
  clock = Date.parse("2026-06-26T00:00:00.000Z");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("JsonSignalsManager", () => {
  it("adds signals and dedupes identical (type, target)", () => {
    const m = makeManager();
    expect(m.add({ type: "uncovered", target: "a", file: "f.md" })).not.toBeNull();
    expect(m.add({ type: "uncovered", target: "a", file: "f.md" })).toBeNull();
    expect(m.pendingCount()).toBe(1);
  });

  it("claims a whole file's batch and counts the attempt", () => {
    const m = makeManager();
    m.add({ type: "uncovered", target: "a", file: "cart.md" });
    m.add({ type: "uncovered", target: "b", file: "cart.md" });
    m.add({ type: "uncovered", target: "c", file: "wishlist.md" });

    const batch = m.claimBatch("w1");
    expect(batch?.file).toBe("cart.md");
    expect(batch?.signals.map((s) => s.target)).toEqual(["a", "b"]);
    expect(batch?.signals.every((s) => s.attempt === 1)).toBe(true);
  });

  it("does not hand a leased file to a second worker", () => {
    const m = makeManager();
    m.add({ type: "uncovered", target: "a", file: "cart.md" });
    m.add({ type: "uncovered", target: "c", file: "wishlist.md" });

    expect(m.claimBatch("w1")?.file).toBe("cart.md");
    expect(m.claimBatch("w2")?.file).toBe("wishlist.md"); // not cart.md — it's leased
    expect(m.claimBatch("w3")).toBeNull(); // everything leased
  });

  it("solve archives signals and frees the file", () => {
    const m = makeManager();
    m.add({ type: "uncovered", target: "a", file: "cart.md" });
    const batch = m.claimBatch("w1")!;
    m.solve(batch.signals.map((s) => s.id));

    expect(m.pendingCount()).toBe(0);
    const done = JSON.parse(fs.readFileSync(resolvePaths(tmp).signalsDone, "utf8"));
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ target: "a", solvedAt: now() });
  });

  it("releaseOwner reverts unsolved signals to pending (attempt retained)", () => {
    const m = makeManager();
    m.add({ type: "uncovered", target: "a", file: "cart.md" });
    m.claimBatch("w1");
    m.releaseOwner("w1");

    expect(m.pendingCount()).toBe(1);
    const reclaimed = m.claimBatch("w2")!;
    expect(reclaimed.signals[0].attempt).toBe(2); // claimed twice now
  });

  it("drop removes pending signals without archiving and frees their lease", () => {
    const m = makeManager();
    m.add({ type: "uncovered", target: "a", file: "cart.md" });
    const batch = m.claimBatch("w1")!;

    m.drop(batch.signals.map((s) => s.id));

    expect(m.pendingCount()).toBe(0);
    expect(m.claimBatch("w2")).toBeNull(); // lease freed, nothing to claim
    const done = JSON.parse(fs.readFileSync(resolvePaths(tmp).signalsDone, "utf8"));
    expect(done).toEqual([]); // dropped, not archived
  });

  it("reap reverts an expired lease so the file is reclaimable", () => {
    const m = makeManager(60_000);
    m.add({ type: "uncovered", target: "a", file: "cart.md" });
    m.claimBatch("w1");

    expect(m.claimBatch("w2")).toBeNull(); // still leased

    clock += 61_000; // lease expires
    expect(m.reap()).toHaveLength(1);
    expect(m.claimBatch("w2")?.file).toBe("cart.md"); // reclaimable after reap
  });

  it("heartbeat extends the lease so reap leaves it alone", () => {
    const m = makeManager(60_000);
    m.add({ type: "uncovered", target: "a", file: "cart.md" });
    m.claimBatch("w1");

    clock += 40_000;
    m.heartbeat("w1"); // pushes expiry to now+60s
    clock += 40_000; // 80s since claim, but only 40s since heartbeat
    expect(m.reap()).toHaveLength(0);
  });
});
