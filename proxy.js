import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

// Protects the whole app: unauthenticated users are redirected to /login.
// Named `proxy` (not `middleware`) per this Next.js version's file convention.
export async function proxy(req) {
  const { pathname } = req.nextUrl;

  // Allow trusted local/CLI tools (e.g. the `lain` terminal command) to call
  // the API with a static bearer token instead of going through OAuth. Only
  // applies to /api/* routes, and only if LAIN_API_TOKEN is configured.
  if (pathname.startsWith("/api/") && isValidApiToken(req)) {
    return NextResponse.next();
  }

  let session = null;
  try {
    session = await auth();
  } catch (err) {
    // A stale/corrupted session cookie (e.g. left over from before AUTH_SECRET
    // was rotated) makes auth() throw instead of returning null. Treat that
    // the same as "unauthenticated" and clear the bad cookie, instead of
    // letting Next.js render its default HTML error page (which breaks
    // client-side code expecting JSON from /api/* routes).
    console.error("[proxy] auth() failed, treating as unauthenticated:", err);

    if (pathname.startsWith("/api/")) {
      const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      clearSessionCookies(res);
      return res;
    }
    const loginUrl = new URL("/login", req.url);
    const res = NextResponse.redirect(loginUrl);
    clearSessionCookies(res);
    return res;
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

function isValidApiToken(req) {
  const expected = process.env.LAIN_API_TOKEN;
  if (!expected) return false;

  const header = req.headers.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return false;

  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function clearSessionCookies(res) {
  for (const name of [
    "authjs.session-token",
    "__Secure-authjs.session-token",
  ]) {
    res.cookies.delete(name);
  }
}

export const config = {
  matcher: [
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico|.*\\.svg$|.*\\.png$|.*\\.webp$).*)",
  ],
};
