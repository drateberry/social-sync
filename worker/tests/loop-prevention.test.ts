import { describe, expect, it, beforeEach } from "vitest";
import type {
  BlogPostRow,
  NormalizedPost,
  Platform,
  PostMirrorRow,
  PostRow,
} from "@social-sync/shared";
import { decideSyncAction, canonicalizeUrl } from "../src/lib/loop-prevention.js";
import { computeContentHash } from "../src/lib/content-hash.js";
import type { Db } from "../src/lib/db.js";

/**
 * FakeDb: in-memory stand-in for the Db class used in production.
 * Only the methods exercised by decideSyncAction need to be implemented.
 */
class FakeDb {
  posts = new Map<string, PostRow>(); // key: `${platform}:${origin_post_id}`
  mirrors = new Map<string, PostMirrorRow>(); // key: `${platform}:${platform_post_id}`
  blog = new Map<string, BlogPostRow>(); // key: url
  nextMirrorId = 1;

  async findMirrorByPlatformPostId(platform: Platform, platformPostId: string) {
    return this.mirrors.get(`${platform}:${platformPostId}`) ?? null;
  }
  async findPostByOrigin(platform: Platform, originPostId: string) {
    return this.posts.get(`${platform}:${originPostId}`) ?? null;
  }
  async findBlogPostByUrl(url: string) {
    return this.blog.get(url) ?? null;
  }
  async findRecentContentHashMatch(hash: string, sinceMs: number) {
    for (const p of this.posts.values()) {
      if (p.content_hash === hash && p.created_at >= sinceMs) return p;
    }
    return null;
  }

  addPost(p: PostRow) {
    this.posts.set(`${p.origin_platform}:${p.origin_post_id}`, p);
  }
  addMirror(m: Omit<PostMirrorRow, "id"> & { id?: number }) {
    const id = m.id ?? this.nextMirrorId++;
    const row: PostMirrorRow = { ...m, id } as PostMirrorRow;
    if (row.platform_post_id) {
      this.mirrors.set(`${row.platform}:${row.platform_post_id}`, row);
    }
  }
  addBlog(b: BlogPostRow) {
    this.blog.set(b.url, b);
  }
}

function asDb(fake: FakeDb): Db {
  return fake as unknown as Db;
}

function makePost(overrides: Partial<NormalizedPost> = {}): NormalizedPost {
  return {
    platform: "mastodon",
    platform_post_id: "m1",
    url: "https://mastodon.example/@me/1",
    created_at: 1_700_000_000_000,
    text: "Hello world",
    media: [],
    urls_in_text: [],
    is_reply: false,
    is_repost: false,
    is_quote: false,
    raw: null,
    ...overrides,
  };
}

describe("loop-prevention decideSyncAction", () => {
  let db: FakeDb;
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    db = new FakeDb();
  });

  it("accepts a brand-new origin post", async () => {
    const post = makePost();
    const hash = await computeContentHash(post, []);
    const decision = await decideSyncAction(asDb(db), {
      post,
      contentHash: hash,
      now: NOW,
    });
    expect(decision.action).toBe("accept");
  });

  it("skips when #nosync is present as a whole tag", async () => {
    const post = makePost({ text: "draft thought #nosync" });
    const hash = await computeContentHash(post, []);
    const decision = await decideSyncAction(asDb(db), {
      post,
      contentHash: hash,
      now: NOW,
    });
    expect(decision).toMatchObject({ action: "skip", reason: "nosync_tag" });
  });

  it("does NOT skip when text merely contains 'nosync' as a substring", async () => {
    const post = makePost({ text: "nosyncing is not a word #vibes" });
    const hash = await computeContentHash(post, []);
    const decision = await decideSyncAction(asDb(db), {
      post,
      contentHash: hash,
      now: NOW,
    });
    expect(decision.action).toBe("accept");
  });

  it("is case-insensitive on #nosync", async () => {
    const post = makePost({ text: "#NoSync" });
    const hash = await computeContentHash(post, []);
    const decision = await decideSyncAction(asDb(db), {
      post,
      contentHash: hash,
      now: NOW,
    });
    expect(decision).toMatchObject({ action: "skip", reason: "nosync_tag" });
  });

  it("skips replies, reposts, and quote posts", async () => {
    for (const kind of ["is_reply", "is_repost", "is_quote"] as const) {
      const post = makePost({ [kind]: true });
      const hash = await computeContentHash(post, []);
      const decision = await decideSyncAction(asDb(db), {
        post,
        contentHash: hash,
        now: NOW,
      });
      expect(decision).toMatchObject({ action: "skip", reason: "unsupported_kind" });
    }
  });

  /**
   * THE CANARY TEST.
   *
   * Scenario: we published an X post, mirrored it to Mastodon,
   * and the Mastodon poller now sees that mirror. Rule 1 must fire.
   */
  it("canary: X origin → Mastodon mirror → Mastodon poll does NOT re-sync", async () => {
    // Step 1: X post was ingested as origin.
    const originPost: PostRow = {
      id: "uuid-x-1",
      origin_platform: "x",
      origin_post_id: "x1",
      origin_url: "https://x.com/me/status/x1",
      content_hash: "hash-abc",
      normalized_text: "",
      media_json: "[]",
      created_at: NOW - 60_000,
    };
    db.addPost(originPost);

    // Step 2: publisher created a Mastodon mirror with known platform_post_id.
    db.addMirror({
      post_id: "uuid-x-1",
      platform: "mastodon",
      platform_post_id: "mast-mirror-1",
      platform_url: "https://mastodon.example/@me/mast-mirror-1",
      status: "published",
      idempotency_key: "idem-mast-1",
      skip_reason: null,
      error: null,
      attempted_at: NOW - 30_000,
      published_at: NOW - 30_000,
    });

    // Step 3: Mastodon poller returns that mirror on next run.
    const pollerPost = makePost({
      platform: "mastodon",
      platform_post_id: "mast-mirror-1",
      url: "https://mastodon.example/@me/mast-mirror-1",
      text: "Hello world",
      created_at: NOW - 25_000,
    });
    const hash = await computeContentHash(pollerPost, []);

    const decision = await decideSyncAction(asDb(db), {
      post: pollerPost,
      contentHash: hash,
      now: NOW,
    });

    expect(decision).toMatchObject({ action: "skip", reason: "mirror" });
  });

  it("rule 2: already-ingested origin is skipped on re-poll", async () => {
    db.addPost({
      id: "uuid-m-1",
      origin_platform: "mastodon",
      origin_post_id: "m1",
      origin_url: "https://mastodon.example/@me/m1",
      content_hash: "hash-xyz",
      normalized_text: "",
      media_json: "[]",
      created_at: NOW - 1000,
    });
    const post = makePost({ platform: "mastodon", platform_post_id: "m1" });
    const hash = await computeContentHash(post, []);
    const decision = await decideSyncAction(asDb(db), {
      post,
      contentHash: hash,
      now: NOW,
    });
    expect(decision).toMatchObject({ action: "skip", reason: "origin_seen" });
  });

  it("rule 3: blog URL + recent publish window → skipped as origin_blog", async () => {
    db.addBlog({
      url: "https://www.example.com/posts/foo",
      title: "Foo",
      published_at: NOW - 30 * 60 * 1000, // 30 min ago
      discovered_at: NOW - 30 * 60 * 1000,
    });
    const post = makePost({
      text: "New post: Foo https://www.example.com/posts/foo",
      urls_in_text: ["https://www.example.com/posts/foo"],
      created_at: NOW - 29 * 60 * 1000,
    });
    const hash = await computeContentHash(post, []);
    const decision = await decideSyncAction(asDb(db), {
      post,
      contentHash: hash,
      now: NOW,
    });
    expect(decision).toMatchObject({ action: "skip", reason: "origin_blog" });
  });

  it("rule 3 does NOT fire when blog post is older than the 2h window", async () => {
    db.addBlog({
      url: "https://www.example.com/posts/old",
      title: "Old",
      published_at: NOW - 5 * 60 * 60 * 1000, // 5h ago
      discovered_at: NOW - 5 * 60 * 60 * 1000,
    });
    const post = makePost({
      text: "Revisiting my old post https://www.example.com/posts/old",
      urls_in_text: ["https://www.example.com/posts/old"],
      created_at: NOW,
    });
    const hash = await computeContentHash(post, []);
    const decision = await decideSyncAction(asDb(db), {
      post,
      contentHash: hash,
      now: NOW,
    });
    expect(decision.action).toBe("accept");
  });

  it("rule 3 canonicalizes URLs to match regardless of tracking params", async () => {
    db.addBlog({
      url: "https://www.example.com/posts/tracked",
      title: "Tracked",
      published_at: NOW - 10 * 60 * 1000,
      discovered_at: NOW - 10 * 60 * 1000,
    });
    const post = makePost({
      text: "New post https://www.example.com/posts/tracked?utm_source=x&utm_medium=social",
      urls_in_text: [
        "https://www.example.com/posts/tracked?utm_source=x&utm_medium=social",
      ],
      created_at: NOW,
    });
    const hash = await computeContentHash(post, []);
    const decision = await decideSyncAction(asDb(db), {
      post,
      contentHash: hash,
      now: NOW,
    });
    expect(decision).toMatchObject({ action: "skip", reason: "origin_blog" });
  });

  /**
   * Regression test for the crash-mid-publish scenario:
   * the publisher called the platform API successfully, then crashed
   * before writing platform_post_id. Now the same text comes back via
   * the poller with no mirror row to match. Rule 4 (content-hash) is
   * the last line of defense.
   */
  it("rule 4: same content hash within 30m → skipped as content_hash_recent", async () => {
    const sharedText = "Cloudflare Workers are great for pollers";
    const originPost = makePost({
      platform: "x",
      platform_post_id: "x1",
      text: sharedText,
      created_at: NOW - 10 * 60 * 1000,
    });
    const hash = await computeContentHash(originPost, []);
    db.addPost({
      id: "uuid-x-1",
      origin_platform: "x",
      origin_post_id: "x1",
      origin_url: "https://x.com/me/status/x1",
      content_hash: hash,
      normalized_text: "",
      media_json: "[]",
      created_at: NOW - 10 * 60 * 1000,
    });

    const reflectedPost = makePost({
      platform: "mastodon",
      platform_post_id: "m-reflect-1",
      text: sharedText,
      created_at: NOW - 9 * 60 * 1000,
    });

    const decision = await decideSyncAction(asDb(db), {
      post: reflectedPost,
      contentHash: hash,
      now: NOW,
    });
    expect(decision).toMatchObject({ action: "skip", reason: "content_hash_recent" });
  });

  it("rule 4 does NOT fire outside the 30m window", async () => {
    const sharedText = "yesterday's thought";
    const originPost = makePost({
      platform: "x",
      platform_post_id: "x1",
      text: sharedText,
      created_at: NOW - 24 * 60 * 60 * 1000,
    });
    const hash = await computeContentHash(originPost, []);
    db.addPost({
      id: "uuid-x-1",
      origin_platform: "x",
      origin_post_id: "x1",
      origin_url: "https://x.com/me/status/x1",
      content_hash: hash,
      normalized_text: "",
      media_json: "[]",
      created_at: NOW - 24 * 60 * 60 * 1000,
    });

    const post = makePost({
      platform: "mastodon",
      platform_post_id: "m1",
      text: sharedText,
      created_at: NOW,
    });
    const decision = await decideSyncAction(asDb(db), {
      post,
      contentHash: hash,
      now: NOW,
    });
    expect(decision.action).toBe("accept");
  });
});

describe("canonicalizeUrl", () => {
  it("strips UTM params and trailing slash", () => {
    expect(canonicalizeUrl("https://example.com/a/?utm_source=x")).toBe(
      "https://example.com/a",
    );
  });
  it("preserves non-tracking query params", () => {
    expect(canonicalizeUrl("https://example.com/a?page=2")).toBe(
      "https://example.com/a?page=2",
    );
  });
  it("returns input as-is when unparseable", () => {
    expect(canonicalizeUrl("not a url")).toBe("not a url");
  });
  it("keeps the path '/' as a single slash", () => {
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com/");
  });
});

describe("content hash normalization", () => {
  it("yields the same hash across platforms after mention/URL stripping", async () => {
    const a = makePost({
      platform: "x",
      text: "Check this @user https://t.co/abc cool link",
    });
    const b = makePost({
      platform: "mastodon",
      text: "Check this @user@host.com https://example.com/foo cool link",
    });
    const hashA = await computeContentHash(a, []);
    const hashB = await computeContentHash(b, []);
    expect(hashA).toBe(hashB);
  });

  it("differs when media bytes differ", async () => {
    const post = makePost();
    const h1 = await computeContentHash(post, ["aa"]);
    const h2 = await computeContentHash(post, ["bb"]);
    expect(h1).not.toBe(h2);
  });

  it("is stable regardless of media ordering", async () => {
    const post = makePost();
    const h1 = await computeContentHash(post, ["aa", "bb"]);
    const h2 = await computeContentHash(post, ["bb", "aa"]);
    expect(h1).toBe(h2);
  });
});
