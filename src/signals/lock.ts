import fs from "node:fs";

/** Sleep synchronously without burning CPU (used only for short lock-retry backoff). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const STALE_MS = 15_000;
const RETRIES = 100;
const BACKOFF_MS = 50;

/**
 * Run `fn` while holding an exclusive lock on `lockDir`. The lock is a directory (atomic mkdir).
 * A lock older than STALE_MS is assumed orphaned (crashed holder) and stolen. Single-worker today,
 * but this is the seam that makes concurrent `clawloop run` instances safe to add later.
 */
export function withLock<T>(lockDir: string, fn: () => T): T {
  acquire(lockDir);
  try {
    return fn();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

function acquire(lockDir: string): void {
  for (let i = 0; i < RETRIES; i++) {
    try {
      fs.mkdirSync(lockDir);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > STALE_MS) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        // lock vanished between mkdir and stat — retry immediately
        continue;
      }
      sleepSync(BACKOFF_MS);
    }
  }
  throw new Error(`could not acquire queue lock at ${lockDir}`);
}
