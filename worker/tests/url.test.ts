import { describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "../src/lib/url.js";

describe("normalizeBaseUrl", () => {
  it("prepends https:// when the scheme is missing", () => {
    expect(normalizeBaseUrl("mastodon.social")).toBe("https://mastodon.social");
  });

  it("preserves an explicit https scheme", () => {
    expect(normalizeBaseUrl("https://mastodon.social")).toBe("https://mastodon.social");
  });

  it("preserves an explicit http scheme (for local dev)", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });

  it("strips trailing slashes", () => {
    expect(normalizeBaseUrl("https://mastodon.social/")).toBe("https://mastodon.social");
    expect(normalizeBaseUrl("mastodon.social///")).toBe("https://mastodon.social");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeBaseUrl("  mastodon.social  ")).toBe("https://mastodon.social");
  });

  it("is case-insensitive about the scheme", () => {
    expect(normalizeBaseUrl("HTTPS://mastodon.social")).toBe("HTTPS://mastodon.social");
  });
});
