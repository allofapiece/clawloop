import { describe, it, expect } from "vitest";
import { parseBlocks } from "../src/spec/parse.js";

describe("parseBlocks", () => {
  it("uses the label as id for a (id)= block and excludes the label line from the hash", () => {
    const a = parseBlocks("(cart-remove)=\nEach cart row has a remove control.", "cart");
    const b = parseBlocks("Each cart row has a remove control.", "cart");
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe("cart-remove");
    expect(a[0].fromLabel).toBe(true);
    // hash ignores the (id)= line, so labelled and bare content hash identically
    expect(a[0].hash).toBe(b[0].hash);
  });

  it("binds a (id)= immediately before a heading into one block", () => {
    const blocks = parseBlocks("(cart-remove)=\n## Remove item\n\nbody text", "cart");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("cart-remove");
  });

  it("derives id from a heading slug and includes the heading in the hash", () => {
    const blocks = parseBlocks("## Remove item!\n\nbody", "cart");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("remove-item");
    expect(blocks[0].fromLabel).toBe(false);
  });

  it("starts a new block at each heading (flat segmentation)", () => {
    const blocks = parseBlocks("## A\ntext a\n### B\ntext b", "f");
    expect(blocks.map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("names leading pre-indicator content <file-stem>-beginning", () => {
    const blocks = parseBlocks("intro prose\n\n## A\nbody", "cart");
    expect(blocks.map((b) => b.id)).toEqual(["cart-beginning", "a"]);
  });

  it("suffixes colliding heading slugs", () => {
    const blocks = parseBlocks("## Setup\nx\n## Setup\ny", "f");
    expect(blocks.map((b) => b.id)).toEqual(["setup", "setup-2"]);
  });

  it("throws on a colliding explicit label", () => {
    expect(() => parseBlocks("(a)=\nx\n\n(a)=\ny", "f")).toThrow(/duplicate explicit block id/);
  });

  it("parses namespaced :expands: refs and excludes the line from the hash", () => {
    const withExpands = parseBlocks(
      "(as-btn)=\n## Button\n:expands: us:cart-remove as:button-design\n\nbody",
      "as",
    );
    const without = parseBlocks("(as-btn)=\n## Button\n\nbody", "as");
    expect(withExpands[0].expands).toEqual([
      { kind: "us", id: "cart-remove" },
      { kind: "as", id: "button-design" },
    ]);
    expect(withExpands[0].hash).toBe(without[0].hash);
  });

  it("hash changes when the body changes but not when only the id label changes", () => {
    const v1 = parseBlocks("(a)=\nbody one", "f")[0];
    const renamed = parseBlocks("(b)=\nbody one", "f")[0];
    const edited = parseBlocks("(a)=\nbody two", "f")[0];
    expect(renamed.hash).toBe(v1.hash);
    expect(edited.hash).not.toBe(v1.hash);
  });

  it("drops a bare label with no content", () => {
    expect(parseBlocks("(a)=\n", "f")).toHaveLength(0);
  });
});
