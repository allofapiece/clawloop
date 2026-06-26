import { createConsola } from "consola";

/**
 * The clawloop logger. Default level is info; `--debug` raises it to debug. Tests silence it via
 * test/setup.ts. consola levels: 3 = info, 4 = debug, negative = silent.
 */
export const log = createConsola({ level: 3 });

export function setLogLevel(mode: "info" | "debug" | "silent"): void {
  log.level = mode === "silent" ? -999 : mode === "debug" ? 4 : 3;
}
