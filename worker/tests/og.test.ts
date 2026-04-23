import { describe, expect, it } from "vitest";
import { parseOg } from "../src/lib/og.js";

describe("parseOg", () => {
  it("extracts og:title, og:description, og:image", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="My Title">
        <meta property="og:description" content="A description">
        <meta property="og:image" content="https://example.com/img.png">
      </head></html>`;
    const card = parseOg("https://example.com/post", html);
    expect(card).toEqual({
      url: "https://example.com/post",
      title: "My Title",
      description: "A description",
      image_url: "https://example.com/img.png",
    });
  });

  it("resolves relative og:image to absolute URL", () => {
    const html = `<head><meta property="og:image" content="/img.png"></head>`;
    const card = parseOg("https://example.com/post", html);
    expect(card.image_url).toBe("https://example.com/img.png");
  });

  it("falls back to twitter:* when og:* is missing", () => {
    const html = `<head>
      <meta name="twitter:title" content="Tweet Title">
      <meta name="twitter:description" content="Tweet desc">
      <meta name="twitter:image" content="https://example.com/t.png">
    </head>`;
    const card = parseOg("https://example.com/post", html);
    expect(card.title).toBe("Tweet Title");
    expect(card.description).toBe("Tweet desc");
    expect(card.image_url).toBe("https://example.com/t.png");
  });

  it("falls back to <title> when no og:title", () => {
    const html = `<head><title>Fallback Title</title></head>`;
    const card = parseOg("https://example.com/p", html);
    expect(card.title).toBe("Fallback Title");
  });

  it("handles attributes in either order", () => {
    const html = `<head>
      <meta content="reversed" property="og:title">
    </head>`;
    const card = parseOg("https://example.com/p", html);
    expect(card.title).toBe("reversed");
  });

  it("returns all nulls on empty HTML", () => {
    const card = parseOg("https://example.com/p", "");
    expect(card).toEqual({
      url: "https://example.com/p",
      title: null,
      description: null,
      image_url: null,
    });
  });
});
