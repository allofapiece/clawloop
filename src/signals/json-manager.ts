import fs from "node:fs";
import type { Paths } from "../store.js";
import { withLock } from "./lock.js";
import type { Batch, DoneSignal, NewSignal, Signal, SignalsManager } from "./types.js";

interface Lease {
  owner: string;
  expiresAt: string;
  signalIds: string[];
}
type Leases = Record<string, Lease>; // keyed by US file

interface QueueState {
  signals: Signal[];
  done: DoneSignal[];
  leases: Leases;
}

export interface JsonSignalsOptions {
  /** Clock injection for deterministic tests. */
  now?: () => string;
  /** Lease time-to-live in ms (default 2 min). */
  ttlMs?: number;
}

/** File-backed `SignalsManager`: signals.json + signals-done.json (committed) + leases.json (runtime). */
export class JsonSignalsManager implements SignalsManager {
  private readonly now: () => string;
  private readonly ttlMs: number;

  constructor(private readonly paths: Paths, opts: JsonSignalsOptions = {}) {
    this.now = opts.now ?? (() => new Date().toISOString());
    this.ttlMs = opts.ttlMs ?? 120_000;
  }

  add(input: NewSignal): Signal | null {
    return this.mutate((st) => {
      const exists = st.signals.some((s) => s.type === input.type && s.target === input.target);
      if (exists) return null;
      const id = `sig-${this.nextId(st)}`;
      const signal: Signal = { id, ...input, attempt: 0, createdAt: this.now() };
      st.signals.push(signal);
      return signal;
    });
  }

  list(): Signal[] {
    return this.read().signals;
  }

  pendingCount(): number {
    return this.read().signals.length;
  }

  claimBatch(owner: string): Batch | null {
    return this.mutate((st) => {
      this.reapInto(st);
      const leasedFiles = new Set(Object.keys(st.leases));
      const seed = st.signals.find((s) => !leasedFiles.has(s.file));
      if (!seed) return null;
      return this.doClaim(st, owner, seed.file);
    });
  }

  claimByFile(owner: string, file: string): Batch | null {
    return this.mutate((st) => {
      this.reapInto(st);
      if (st.leases[file]) return null; // held by someone (reap already cleared expired)
      return this.doClaim(st, owner, file);
    });
  }

  claimedBy(owner: string): Signal[] {
    return this.mutate((st) => {
      this.reapInto(st);
      const files = new Set(
        Object.entries(st.leases)
          .filter(([, l]) => l.owner === owner)
          .map(([f]) => f),
      );
      return st.signals.filter((s) => files.has(s.file)).map((s) => ({ ...s }));
    });
  }

  heartbeat(owner: string): void {
    this.mutate((st) => {
      for (const lease of Object.values(st.leases)) {
        if (lease.owner === owner) lease.expiresAt = this.expiry();
      }
    });
  }

  solve(ids: string[]): void {
    if (ids.length === 0) return;
    const set = new Set(ids);
    this.mutate((st) => {
      const solvedAt = this.now();
      for (const s of st.signals) {
        if (set.has(s.id)) st.done.push({ ...s, solvedAt });
      }
      st.signals = st.signals.filter((s) => !set.has(s.id));
      for (const [file, lease] of Object.entries(st.leases)) {
        lease.signalIds = lease.signalIds.filter((id) => !set.has(id));
        if (lease.signalIds.length === 0) delete st.leases[file];
      }
    });
  }

  drop(ids: string[]): void {
    if (ids.length === 0) return;
    const set = new Set(ids);
    this.mutate((st) => {
      st.signals = st.signals.filter((s) => !set.has(s.id));
      for (const [file, lease] of Object.entries(st.leases)) {
        lease.signalIds = lease.signalIds.filter((id) => !set.has(id));
        if (lease.signalIds.length === 0) delete st.leases[file];
      }
    });
  }

  releaseOwner(owner: string): void {
    this.mutate((st) => {
      for (const [file, lease] of Object.entries(st.leases)) {
        if (lease.owner === owner) delete st.leases[file];
      }
    });
  }

  reap(): string[] {
    return this.mutate((st) => this.reapInto(st));
  }

  // ──────────────────────────────────────────────────────────── internals

  /** Claim `file`'s pending signals for `owner` (caller has reaped + checked it's unleased). */
  private doClaim(st: QueueState, owner: string, file: string): Batch | null {
    const batch = st.signals.filter((s) => s.file === file);
    if (batch.length === 0) return null;
    for (const s of batch) s.attempt += 1;
    st.leases[file] = { owner, expiresAt: this.expiry(), signalIds: batch.map((s) => s.id) };
    return { owner, file, signals: batch.map((s) => ({ ...s })) };
  }

  /** Drop expired leases (mutating `st`); returns the reverted signal ids. */
  private reapInto(st: QueueState): string[] {
    const nowMs = Date.parse(this.now());
    const reverted: string[] = [];
    for (const [file, lease] of Object.entries(st.leases)) {
      if (Date.parse(lease.expiresAt) <= nowMs) {
        reverted.push(...lease.signalIds);
        delete st.leases[file];
      }
    }
    return reverted;
  }

  private nextId(st: QueueState): number {
    let max = 0;
    for (const s of [...st.signals, ...st.done]) {
      const n = Number(s.id.replace(/^sig-/, ""));
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max + 1;
  }

  private expiry(): string {
    return new Date(Date.parse(this.now()) + this.ttlMs).toISOString();
  }

  private read(): QueueState {
    return {
      signals: readJson<Signal[]>(this.paths.signals, []),
      done: readJson<DoneSignal[]>(this.paths.signalsDone, []),
      leases: readJson<Leases>(this.paths.leases, {}),
    };
  }

  private mutate<T>(fn: (st: QueueState) => T): T {
    return withLock(this.paths.queueLock, () => {
      const st = this.read();
      const result = fn(st);
      writeJson(this.paths.signals, st.signals);
      writeJson(this.paths.signalsDone, st.done);
      writeJson(this.paths.leases, st.leases);
      return result;
    });
  }
}

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
