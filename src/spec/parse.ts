import crypto from "node:crypto";

/**
 * Block model (provisional — the block delimiting rules are settled; the MyST surface they sit on may
 * grow). A block begins at an *indicator*:
 *   - a target label on its own line:  `(my-id)=`
 *   - a heading:                        `# …` … `###### …`
 * A `(id)=` immediately followed by a heading binds to it (one block, the explicit id wins). Content
 * before the first indicator becomes a `<file-stem>-beginning` block.
 *
 * The block id is the label (for `(id)=`) or the slugified heading text. Within a file, colliding
 * heading slugs are suffixed (`setup`, `setup-2`); a colliding explicit label is an error.
 *
 * The content hash covers the whole block EXCEPT the `(id)=` line and any `:expands:` metadata line.
 */
export type RefKind = "us" | "as";

export interface Ref {
  kind: RefKind;
  id: string;
}

export interface Block {
  /** Stable id: the `(id)=` label, or the slugified heading, or `<file-stem>-beginning`. */
  id: string;
  /** True when the id came from an explicit `(id)=` label (vs a heading slug). */
  fromLabel: boolean;
  /** sha256 (hex) of the normalized content, excluding the `(id)=` and `:expands:` lines. */
  hash: string;
  /** Parsed `:expands:` refs (empty for most US blocks). */
  expands: Ref[];
}

const LABEL_RE = /^\(([^)]+)\)=\s*$/;
const HEADING_RE = /^#{1,6}\s+(.*\S)\s*$/;
const EXPANDS_RE = /^:expands:\s*(.*)$/;
const REF_RE = /^(us|as):(.+)$/;

/** Slugify heading text: lowercase, non-alphanumerics → single hyphen, trimmed. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseExpands(value: string): Ref[] {
  const refs: Ref[] = [];
  for (const token of value.trim().split(/\s+/)) {
    if (!token) continue;
    const m = token.match(REF_RE);
    if (m) refs.push({ kind: m[1] as RefKind, id: m[2] });
  }
  return refs;
}

function hash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

interface RawBlock {
  id: string;
  fromLabel: boolean;
  lines: string[];
}

/** Parse one markdown file's text into blocks. `fileStem` names the leading pre-indicator block. */
export function parseBlocks(text: string, fileStem: string): Block[] {
  const lines = text.split(/\r?\n/);
  const raw: RawBlock[] = [];
  let cur: RawBlock | null = null;
  // True right after a `(id)=` line until the first non-blank line — a heading here binds to the label.
  let binding = false;

  const start = (id: string, fromLabel: boolean): RawBlock => {
    const block: RawBlock = { id, fromLabel, lines: [] };
    raw.push(block);
    return block;
  };

  for (const line of lines) {
    const label = line.match(LABEL_RE);
    if (label) {
      cur = start(label[1].trim(), true); // the `(id)=` line itself is not kept (excluded from hash)
      binding = true;
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      if (cur && binding) {
        cur.lines.push(line); // bound to the preceding label — same block, heading kept in content
      } else {
        cur = start(slugify(heading[1]), false);
        cur.lines.push(line);
      }
      binding = false;
      continue;
    }

    // content or blank line
    if (!cur) cur = start(`${fileStem}-beginning`, false);
    if (line.trim() !== "") binding = false;
    cur.lines.push(line);
  }

  return finalize(raw);
}

/** Resolve id collisions, parse expands, compute hashes, drop empty blocks. */
function finalize(raw: RawBlock[]): Block[] {
  const seen = new Map<string, number>();
  const blocks: Block[] = [];

  for (const b of raw) {
    const contentLines: string[] = [];
    const expands: Ref[] = [];
    for (const line of b.lines) {
      const ex = line.match(EXPANDS_RE);
      if (ex) {
        expands.push(...parseExpands(ex[1])); // metadata — excluded from hash
        continue;
      }
      contentLines.push(line);
    }

    const content = contentLines.join("\n").trim();
    if (content === "") continue; // a bare label / empty section is not a tracked block

    let id = b.id;
    const count = seen.get(id) ?? 0;
    if (count > 0) {
      if (b.fromLabel) throw new Error(`duplicate explicit block id "${id}"`);
      id = `${id}-${count + 1}`;
    }
    seen.set(b.id, count + 1);

    blocks.push({ id, fromLabel: b.fromLabel, hash: hash(content), expands });
  }

  return blocks;
}
