function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const b = Number(p);
    if (!Number.isInteger(b) || b < 0 || b > 255) return null;
    n = (n << 8) | b;
  }
  return n >>> 0;
}

function matchesIpv4Cidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  if (!range || !bitsStr) return false;
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

/**
 * Checks whether `ip` matches any entry in the allowlist.
 * Entries may be exact IPs (v4 or v6) or IPv4 CIDR ranges (e.g. "1.2.3.0/24").
 * IPv6 CIDR is not supported — add the full address exactly instead.
 */
export function isAllowed(ip: string, allowlist: readonly string[]): boolean {
  for (const entry of allowlist) {
    if (entry === ip) return true;
    if (entry.includes("/") && matchesIpv4Cidr(ip, entry)) return true;
  }
  return false;
}

export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
