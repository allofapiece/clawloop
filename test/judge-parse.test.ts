import { describe, it, expect } from "vitest";
import { parseVerdict, buildJudgePrompt } from "../src/eval/judge.js";

describe("parseVerdict", () => {
  it("parses a bare JSON object", () => {
    const v = parseVerdict('{"criteria":[{"id":"J1","pass":true,"evidence":"ok"}]}');
    expect(v).toEqual([{ id: "J1", pass: true, evidence: "ok" }]);
  });

  it("parses JSON inside a ```json fence with surrounding prose", () => {
    const out = 'Here is my verdict:\n```json\n{"criteria":[{"id":"J6","pass":false,"evidence":"hardcoded 2028"}]}\n```\nDone.';
    expect(parseVerdict(out)).toEqual([{ id: "J6", pass: false, evidence: "hardcoded 2028" }]);
  });

  it("coerces missing/odd fields", () => {
    const v = parseVerdict('{"criteria":[{"id":"J2"}]}');
    expect(v).toEqual([{ id: "J2", pass: false, evidence: "" }]);
  });

  it("throws when there is no JSON object", () => {
    expect(() => parseVerdict("no json here")).toThrow();
  });
});

describe("buildJudgePrompt", () => {
  it("includes the US, the AS, and every criterion id, and asks for JSON only", () => {
    const p = buildJudgePrompt("US BODY", "AS BODY");
    expect(p).toContain("US BODY");
    expect(p).toContain("AS BODY");
    expect(p).toContain("J1");
    expect(p).toContain("J7");
    expect(p).toContain("Output ONLY a JSON object");
  });
});
