import fs from "node:fs";
import path from "node:path";
import { parseBlocks, type Block } from "./parse.js";

export interface LoadedBlock extends Block {
  /** Source file, relative to the spec dir (posix), e.g. `cart.md` or `sub/cart.md`. */
  file: string;
}

/** Read every `.md` file under `dir` (recursively) and parse it into blocks tagged with their file. */
export function loadBlocks(dir: string): LoadedBlock[] {
  if (!fs.existsSync(dir)) return [];
  const blocks: LoadedBlock[] = [];
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const full = path.join(entry.parentPath, entry.name);
    const rel = path.relative(dir, full).split(path.sep).join("/");
    const stem = path.basename(entry.name, ".md");
    for (const b of parseBlocks(fs.readFileSync(full, "utf8"), stem)) {
      blocks.push({ ...b, file: rel });
    }
  }
  return blocks;
}

/** US block ids must be unique across the whole User Spec so a signal's target is unambiguous. */
export function assertUniqueIds(blocks: LoadedBlock[]): void {
  const byId = new Map<string, string>();
  for (const b of blocks) {
    const prev = byId.get(b.id);
    if (prev) {
      throw new Error(`duplicate User Spec block id "${b.id}" in ${prev} and ${b.file}`);
    }
    byId.set(b.id, b.file);
  }
}
