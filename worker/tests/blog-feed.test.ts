import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/pollers/blog.js";

describe("parseFeed", () => {
  it("parses RSS 2.0 items", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Example</title>
  <item>
    <title>Hello</title>
    <link>https://www.example.com/posts/hello</link>
    <pubDate>Mon, 20 Apr 2026 12:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Second</title>
    <link>https://www.example.com/posts/second</link>
    <pubDate>Tue, 21 Apr 2026 09:00:00 GMT</pubDate>
  </item>
</channel></rss>`;
    const entries = parseFeed(xml);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.url).toBe("https://www.example.com/posts/hello");
    expect(entries[0]?.title).toBe("Hello");
    expect(entries[0]?.published_at).toBe(Date.parse("Mon, 20 Apr 2026 12:00:00 GMT"));
  });

  it("handles CDATA in titles", () => {
    const xml = `<rss><channel><item>
      <title><![CDATA[Hello & goodbye]]></title>
      <link>https://example.com/a</link>
      <pubDate>Mon, 20 Apr 2026 12:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const entries = parseFeed(xml);
    expect(entries[0]?.title).toBe("Hello & goodbye");
  });

  it("parses Atom feed with alternate link", () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom Post</title>
    <link rel="alternate" href="https://example.com/atom-a" />
    <link rel="self" href="https://example.com/self" />
    <published>2026-04-20T12:00:00Z</published>
  </entry>
</feed>`;
    const entries = parseFeed(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.url).toBe("https://example.com/atom-a");
    expect(entries[0]?.published_at).toBe(Date.parse("2026-04-20T12:00:00Z"));
  });

  it("returns empty array on unrecognized input", () => {
    expect(parseFeed("<html></html>")).toEqual([]);
  });
});
