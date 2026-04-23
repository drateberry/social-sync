import { describe, expect, it } from "vitest";
import {
  graphemeLength,
  splitIntoThread,
  takeGraphemes,
} from "../src/lib/thread-splitter.js";

describe("graphemeLength", () => {
  it("counts family emoji as a single grapheme", () => {
    expect(graphemeLength("👨‍👩‍👧")).toBe(1);
  });
  it("counts flag emoji as a single grapheme", () => {
    expect(graphemeLength("🇺🇸")).toBe(1);
  });
  it("counts plain ASCII correctly", () => {
    expect(graphemeLength("hello")).toBe(5);
  });
});

describe("splitIntoThread", () => {
  it("leaves short text alone", () => {
    expect(splitIntoThread("hi", { limit: 300 })).toEqual(["hi"]);
  });

  it("splits at word boundaries, never mid-word", () => {
    const text = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor";
    const parts = splitIntoThread(text, { limit: 30 });
    expect(parts.length).toBeGreaterThan(1);
    const recombined = parts
      .map((p) => p.replace(/ 🧵 \d+\/\d+$/, ""))
      .join(" ");
    expect(recombined.split(/\s+/).sort()).toEqual(text.split(/\s+/).sort());
    for (const p of parts) {
      expect(graphemeLength(p)).toBeLessThanOrEqual(30);
    }
  });

  it("appends 1/N 2/N suffixes and numbers consistently", () => {
    const text = "a ".repeat(200).trim();
    const parts = splitIntoThread(text, { limit: 50 });
    const total = parts.length;
    for (let i = 0; i < parts.length; i++) {
      expect(parts[i]).toMatch(new RegExp(`🧵 ${i + 1}/${total}$`));
    }
  });

  it("handles a single word longer than the limit (breaks mid-word as last resort)", () => {
    const text = "x".repeat(500);
    const parts = splitIntoThread(text, { limit: 100 });
    for (const p of parts) {
      expect(graphemeLength(p)).toBeLessThanOrEqual(100);
    }
  });

  it("preserves grapheme boundaries (doesn't split inside a family emoji)", () => {
    const text = "word ".repeat(20) + "👨‍👩‍👧 tail";
    const parts = splitIntoThread(text, { limit: 40 });
    // None of the parts should contain an orphaned ZWJ or surrogate artifact.
    for (const p of parts) {
      expect(p).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/); // lone high surrogate
      expect(p).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/); // lone low surrogate
    }
  });
});

describe("takeGraphemes", () => {
  it("takes n full graphemes, not n code units", () => {
    expect(takeGraphemes("👨‍👩‍👧hi", 1)).toBe("👨‍👩‍👧");
    expect(takeGraphemes("👨‍👩‍👧hi", 2)).toBe("👨‍👩‍👧h");
  });
});
