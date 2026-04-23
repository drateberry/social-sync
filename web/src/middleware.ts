import { NextResponse, type NextRequest } from "next/server";
import { isAllowed, parseAllowlist } from "@/lib/ip-allowlist";

export function middleware(req: NextRequest) {
  const allowlist = parseAllowlist(process.env.ALLOWED_IPS);

  // If unset, treat as "no restriction" — useful for local dev and for
  // turning the gate off in production by deleting the secret.
  if (allowlist.length === 0) return NextResponse.next();

  const ip = req.headers.get("cf-connecting-ip") ?? "";
  if (!ip || !isAllowed(ip, allowlist)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  // Run on every path. Static assets go through the ASSETS binding
  // in OpenNext before reaching middleware, so this doesn't block CSS/JS.
  matcher: "/:path*",
};
