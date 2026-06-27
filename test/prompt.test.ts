import { describe, it, expect } from "vitest";
import { buildElaboratorPrompt } from "../src/elaborator/prompt.js";
import type { Batch } from "../src/signals/types.js";

const batch: Batch = {
  owner: "w1",
  file: "cart.md",
  signals: [
    { id: "sig-1", type: "uncovered", target: "cart-remove", file: "cart.md", attempt: 1, createdAt: "t" },
    { id: "sig-2", type: "changed", target: "cart-clear", file: "cart.md", attempt: 1, createdAt: "t" },
    { id: "sig-3", type: "revisit", target: "cart-empty", file: "cart.md", attempt: 1, createdAt: "t" },
  ],
};

describe("buildElaboratorPrompt", () => {
  it("names the mirrored AS file, the targets, and create-vs-revise intents", () => {
    const prompt = buildElaboratorPrompt({
      instructions: "INSTRUCTIONS",
      usContext: "US BODY",
      diaryTail: "",
      batch,
    });

    expect(prompt).toContain("INSTRUCTIONS");
    expect(prompt).toContain("US BODY");
    expect(prompt).toContain("agent-spec/cart.md");
    expect(prompt).toContain("CREATE Agent Spec for `us:cart-remove` (signal sig-1)");
    expect(prompt).toContain("REVISE Agent Spec for `us:cart-clear` (signal sig-2)");
    expect(prompt).toContain("REVISIT `us:cart-empty` (signal sig-3)");
    expect(prompt).toContain("clawloop signals solved");
  });

  it("omits the diary section when empty and includes it when present", () => {
    expect(buildElaboratorPrompt({ instructions: "i", usContext: "u", diaryTail: "", batch })).not.toContain(
      "recent diary",
    );
    expect(
      buildElaboratorPrompt({ instructions: "i", usContext: "u", diaryTail: "yesterday I did X", batch }),
    ).toContain("yesterday I did X");
  });
});
