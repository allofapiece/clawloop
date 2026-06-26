import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../src/commands/init.js";
import { resolvePaths } from "../src/store.js";
import { JsonSignalsManager } from "../src/signals/json-manager.js";
import { runIteration } from "../src/run.js";
import type { Backend, BackendResult } from "../src/backend/backend.js";

let tmp: string;
const now = () => "2026-06-26T00:00:00.000Z";

/** A backend that writes the AS file a real agent would, so the iteration can be tested offline. */
function backendWriting(asFiles: Record<string, string>): Backend {
  return {
    async run(_prompt, opts): Promise<BackendResult> {
      for (const [rel, body] of Object.entries(asFiles)) {
        const full = path.join(opts.cwd, ".clawloop/agent-spec", rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body);
      }
      return { ok: true, stdout: "", stderr: "" };
    },
  };
}

const noopBackend: Backend = {
  async run() {
    return { ok: true, stdout: "", stderr: "" };
  },
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clawloop-iter-"));
  runInit({ cwd: tmp });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const usFile = (name: string, body: string) =>
  fs.writeFileSync(path.join(tmp, ".clawloop/user-spec", name), body);

describe("runIteration", () => {
  it("is idle when there are no signals", async () => {
    const manager = new JsonSignalsManager(resolvePaths(tmp), { now });
    const summary = await runIteration({ cwd: tmp, manager, backend: noopBackend }, "w1");
    expect(summary.idle).toBe(true);
  });

  it("scans, elaborates a batch, solves it, and records the hash", async () => {
    usFile("cart.md", "(cart-remove)=\nEach cart row has a remove control.");
    const manager = new JsonSignalsManager(resolvePaths(tmp), { now });
    const backend = backendWriting({
      "cart.md": "(as-remove-button)=\n## Remove button\n:expands: us:cart-remove\n\nA danger button.",
    });

    const summary = await runIteration({ cwd: tmp, manager, backend }, "w1");

    expect(summary).toMatchObject({ idle: false, file: "cart.md", claimed: 1, solved: 1 });
    expect(manager.pendingCount()).toBe(0); // archived

    // hash recorded → a re-scan finds nothing new
    const second = await runIteration({ cwd: tmp, manager, backend }, "w2");
    expect(second.idle).toBe(true);

    const state = JSON.parse(fs.readFileSync(resolvePaths(tmp).state, "utf8"));
    expect(state.usHashes["cart-remove"]).toBeTruthy();
  });

  it("reverts to pending (no hash recorded) when the agent produces no covering AS", async () => {
    usFile("cart.md", "(cart-remove)=\nEach cart row has a remove control.");
    const manager = new JsonSignalsManager(resolvePaths(tmp), { now });

    const summary = await runIteration({ cwd: tmp, manager, backend: noopBackend }, "w1");

    expect(summary).toMatchObject({ idle: false, solved: 0 });
    expect(manager.pendingCount()).toBe(1); // reverted, will retry
    expect(fs.existsSync(resolvePaths(tmp).state)).toBe(false); // no hash recorded
  });
});
