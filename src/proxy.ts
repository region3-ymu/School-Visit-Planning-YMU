import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/auth.config";

// Deliberately NOT `import { auth } from "@/auth"` — that pulls PrismaAdapter
// and bcrypt into the Edge bundle, where they cannot run, and every request
// 500s on Vercel. auth.config.ts is the edge-safe half.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  // Allow auth routes and login page through unconditionally
  if (
    pathname.startsWith("/api/auth") ||
    pathname === "/login"
  ) {
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
    // Match all paths except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
  ],
};
