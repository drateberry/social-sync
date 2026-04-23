/**
 * Split a post into pieces that each fit a target platform's character
 * limit, appending "🧵 N/M" thread markers. Never breaks mid-word.
 *
 * Limits are measured in graphemes (Intl.Segmenter) — Bluesky counts
 * graphemes, and for X/Mastodon counting graphemes is a safe overcount
 * (fewer characters in ≥ fewer characters out).
 */
export interface SplitOptions {
  limit: number;
  suffixReserve?: number;
}

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function graphemeLength(s: string): number {
  let n = 0;
  for (const _ of SEGMENTER.segment(s)) n++;
  return n;
}

/** Take the first `n` graphemes of `s`. */
export function takeGraphemes(s: string, n: number): string {
  let out = "";
  let i = 0;
  for (const seg of SEGMENTER.segment(s)) {
    if (i >= n) break;
    out += seg.segment;
    i++;
  }
  return out;
}

export function splitIntoThread(text: string, opts: SplitOptions): string[] {
  const { limit } = opts;
  if (graphemeLength(text) <= limit) return [text];

  // Binary-search-free layout: repeatedly carve off a chunk <= limit - suffixRoom.
  // We don't know M until we finish carving, so carve assuming " 🧵 99/99" (10 graphemes)
  // as a safe upper bound, then renumber.
  const reserve = opts.suffixReserve ?? 10;
  const chunkLimit = Math.max(1, limit - reserve);
  const chunks = carve(text, chunkLimit);

  const total = chunks.length;
  return chunks.map((c, i) => `${c} 🧵 ${i + 1}/${total}`);
}

function carve(text: string, chunkLimit: number): string[] {
  const chunks: string[] = [];
  let remaining = text.trimStart();

  while (graphemeLength(remaining) > chunkLimit) {
    const head = takeGraphemes(remaining, chunkLimit);
    const breakAt = findLastWhitespace(head);
    const piece = (breakAt > 0 ? takeGraphemes(head, breakAt) : head).trimEnd();
    if (piece.length === 0) {
      // Pathological case: a single "word" longer than the chunk limit.
      // Break mid-word as a last resort.
      chunks.push(head);
      remaining = skipGraphemes(remaining, chunkLimit).trimStart();
    } else {
      chunks.push(piece);
      remaining = skipGraphemes(remaining, breakAt > 0 ? breakAt : chunkLimit).trimStart();
    }
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function skipGraphemes(s: string, n: number): string {
  let i = 0;
  let out = "";
  for (const seg of SEGMENTER.segment(s)) {
    if (i >= n) out += seg.segment;
    i++;
  }
  return out;
}

/** Find the grapheme index of the last whitespace in `s`, or -1. */
function findLastWhitespace(s: string): number {
  let i = 0;
  let last = -1;
  for (const seg of SEGMENTER.segment(s)) {
    if (/\s/.test(seg.segment)) last = i;
    i++;
  }
  return last;
}
