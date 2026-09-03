import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Email domains allowed to sign in with Google.
 *
 * Two, not one: staff mail is @ymu.org, but the Academic Manager's address is
 * on @youngmusiciansunite.org — the organisation's other domain. The `hd` hint
 * on the provider below can only carry one, so it stays on the common case and
 * this list is the authority.
 */
const ALLOWED_SIGN_IN_DOMAINS = ["@ymu.org", "@youngmusiciansunite.org"] as const;

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
        //
        // Both domains, because the organisation uses both: the Academic
        // Manager is jpelaez@youngmusiciansunite.org, and checking only
        // "@ymu.org" silently refused his Google sign-in — the same
        // fails-with-nothing-on-screen symptom that allowDangerousEmailAccountLinking
        // above was added to fix. He could still get in with a password, which
        // is why it went unnoticed.
        //
        // Deliberately still a domain check and not an allowlist: this app is
        // administration-only. YMU-A and the inventory app cannot do this —
        // their teachers sign in with personal Gmail — so those two gate on
        // whether the person is already on the roster instead.
        const email = profile?.email?.toLowerCase() ?? "";
        return ALLOWED_SIGN_IN_DOMAINS.some((d) => email.endsWith(d));
      }
      return true;
    },

    // Pure token -> session mapping, no database access, so it is safe at the edge.
    async session({ session, token }) {
      session.user.id = token.sub!;
      session.user.role = token.role as import("@prisma/client").Role;
      session.user.isAppAdmin = Boolean(token.isAppAdmin);
      session.user.regionId = (token.regionId as string | null) ?? null;
      session.user.regionName = (token.regionName as string | null) ?? null;
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },
} satisfies NextAuthConfig;
