import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/auth.config";

// Deliberately NOT `import { auth } from "@/auth"` — that pulls PrismaAdapter
// and bcrypt into the Edge bundle, where they cannot run, and every request
// 500s on Vercel. auth.config.ts is the edge-safe half.
const { auth } = NextAuth(authConfig);

/**
 * Pages that must answer to an anonymous request. Static files are handled by
 * the matcher below, not here.
 *
 *   /api/auth, /login   the sign-in flow itself.
 *   /~offline           what the service worker serves when the network is
 *                       gone — which is precisely when it cannot check a
 *                       session. Extension-less, so the matcher's file rule
 *                       does not cover it.
 */
const PUBLIC_PATHS = ["/api/auth", "/login", "/~offline"];

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path))) {
    return NextResponse.next();
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Everything except Next internals and ANY request for a file (a path whose
    // last segment contains a dot). App routes never look like that — ids are
    // cuids, API routes have no extension — so the only things this exempts are
    // static assets, which carry nothing worth gating.
    //
    // This used to exempt "public/" instead, which matched NOTHING: files in
    // public/ are served from the root, so every one of them — the Leaflet
    // marker PNGs, the brand SVGs, the install icons, /manifest.webmanifest,
    // /serwist/sw.js — was auth-gated. Two consequences, both of which cost a
    // debugging session:
    //
    //   The manifest is fetched WITHOUT credentials, so it is always "signed
    //   out". Redirected, the browser sees no manifest and the install option
    //   silently never appears.
    //
    //   Worse for the service worker: the redirect is built from NEXTAUTH_URL,
    //   which in production is a different origin than the one being fetched.
    //   The precache request follows it to a host that isn't listening, hangs
    //   forever, and the worker never leaves "installing" — no error, no
    //   install, nothing to grep for.
    "/((?!_next/static|_next/image|favicon.ico|[^?]*\\.[^/?]+$).*)",
  ],
};
