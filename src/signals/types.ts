export type SignalType =
  | "uncovered"
  | "changed"
  | "revisit"
  | "orphaned"
  | "validation_failed"
  | "dep-changed";

/** A unit of elaboration work. Durable + committed (the queue is part of `.clawloop`). */
export interface Signal {
  id: string;
  type: SignalType;
  /** What the signal is about: a US block id, or (for validation_failed) the AS file to fix. */
  target: string;
  /** The file (relative, posix) this signal's work lives in — the batch/lease unit. */
  file: string;
  /** How many times an agent has been handed this signal. Recorded for future priority escalation. */
  attempt: number;
  /** Extra context (e.g. the validation errors for a validation_failed signal). */
  detail?: string;
  createdAt: string;
}

export interface DoneSignal extends Signal {
  solvedAt: string;
}

/** A file's worth of signals claimed together by one worker for one iteration. */
export interface Batch {
  owner: string;
  file: string;
  signals: Signal[];
}

export interface NewSignal {
  type: SignalType;
  target: string;
  file: string;
  detail?: string;
}

/**
 * The queue abstraction. `JsonSignalsManager` is the only impl today; a `SqliteSignalsManager` can
 * replace it without touching callers. Status is *derived*: a signal is in-progress iff an active
 * (non-expired) lease covers its file, else pending. Only `attempt` + existence are durable.
 */
export interface SignalsManager {
  /** Add a pending signal unless an identical `(type, target)` is already pending. */
  add(input: NewSignal): Signal | null;
  /** All pending signals (committed queue), in FIFO order. */
  list(): Signal[];
  pendingCount(): number;
  /** Reap expired leases, then claim the oldest unleased file's signals for `owner`. */
  claimBatch(owner: string): Batch | null;
  /** Claim a specific file's pending signals for `owner`; null if leased elsewhere or no signals. */
  claimByFile(owner: string, file: string): Batch | null;
  /** Pending signals currently leased by `owner` (the iteration's working set). */
  claimedBy(owner: string): Signal[];
  /** Extend the lease(s) held by `owner` (called periodically while working). */
  heartbeat(owner: string): void;
  /** Archive signals as solved (removes them from the queue and any lease). */
  solve(ids: string[]): void;
  /** Remove pending signals outright, NOT archived — for ones made obsolete (e.g. their block was deleted). */
  drop(ids: string[]): void;
  /** Drop `owner`'s leases; their unsolved signals revert to pending (attempt already counted). */
  releaseOwner(owner: string): void;
  /** Revert expired leases to pending; returns the reverted signal ids. */
  reap(): string[];
}
