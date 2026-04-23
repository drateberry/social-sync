import { describe, expect, it } from "vitest";
import { blueskyRkey } from "../src/lib/idempotency.js";

const TID_REGEX = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

describe("blueskyRkey", () => {
  it("produces a valid TID (13 chars, base32-sortable, restricted first char)", async () => {
    const rkey = await blueskyRkey("post-abc-123");
    expect(rkey).toMatch(TID_REGEX);
    expect(rkey).toHaveLength(13);
  });

  it("is deterministic for the same input", async () => {
    const a = await blueskyRkey("post-abc-123");
    const b = await blueskyRkey("post-abc-123");
    expect(a).toBe(b);
  });

  it("returns distinct TIDs for different post ids", async () => {
    const a = await blueskyRkey("post-1");
    const b = await blueskyRkey("post-2");
    expect(a).not.toBe(b);
  });

  it("returns distinct TIDs for different thread parts of the same post", async () => {
    const a = await blueskyRkey("post-abc", 0);
    const b = await blueskyRkey("post-abc", 1);
    expect(a).not.toBe(b);
    expect(a).toMatch(TID_REGEX);
    expect(b).toMatch(TID_REGEX);
  });

  it("accepts postIds containing characters that are not TID-valid", async () => {
    const rkey = await blueskyRkey("ss-73e73d7c-c0d4-4aec-9bdd-448821906a1b");
    expect(rkey).toMatch(TID_REGEX);
  });
});
