import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * The half of the auth config that can run in the Edge runtime.
 *
 * The middleware (src/proxy.ts) runs on every request, and on Vercel it runs at
 * the edge — where Prisma's query engine cannot execute. Importing the full
 * config there pulls in PrismaAdapter and bcrypt through the import graph, and
 * every route 500s: even a static page like /login, because middleware runs
 * before it is served. (It does not reproduce with `next start` locally, which
 * runs middleware in Node.)
 *
 * So this file holds only what the middleware actually needs — enough to
 * verify a JWT and decide whether the request is signed in. The Prisma adapter,
 * the Credentials provider and the DB-reading jwt callback live in auth.ts,
 * which only Node route handlers and server actions import.
 */
export default {
  // Sessions are JWTs, so the middleware never needs to reach the database to
  // know who the caller is — role and region are baked into the token at
  // sign-in by the jwt callback in auth.ts.
  session: { strategy: "jwt" },

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Users are created here with a password (scripts/create-user.ts), so the
      // first Google sign-in finds an existing user with that email and no
      // linked account. Auth.js refuses that by default and bounces to
      // /login?error=OAuthAccountNotLinked — which is why signing in "just
      // didn't work" with nothing on screen.
      //
      // It is called dangerous because a provider that does not verify email
      // ownership would let anyone claim an existing account. That does not
      // apply here: Google verifies the address, the signIn callback below
      // rejects anything outside @ymu.org, and the consent screen is Internal
      // to the youngmusiciansunite.org workspace.
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          // Hint the Google login screen to pre-fill @ymu.org accounts.
          // The actual domain check is enforced in the signIn callback below.
          hd: "ymu.org",
        },
      },
    }),
  ],

  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "google") {
        // Defense-in-depth: the hd param is only a UI hint; validate the domain here.
        return Boolean(profile?.email?.endsWith("@ymu.org"));
      }
      return true;
    },

    // Pure token -> session mapping, no database access, so it is safe at the edge.
    async session({ session, token }) {
      session.user.id = token.sub!;
      session.user.role = token.role as import("@prisma/client").Role;
      session.user.regionId = (token.regionId as string | null) ?? null;
      session.user.regionName = (token.regionName as string | null) ?? null;
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },
} satisfies NextAuthConfig;
