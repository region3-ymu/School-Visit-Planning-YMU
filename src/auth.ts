import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import authConfig from "@/auth.config";

/**
 * The full auth setup: the edge-safe config plus everything that needs the
 * database. Only Node route handlers and server actions may import this — the
 * middleware imports auth.config.ts instead. See the comment there for why.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),

  providers: [
    ...authConfig.providers,

    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: String(credentials.email) },
          select: { id: true, email: true, name: true, hashedPassword: true },
        });

        if (!user?.hashedPassword) return null;

        const valid = await bcrypt.compare(
          String(credentials.password),
          user.hashedPassword
        );
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    /**
     * Google may attach to an account, but it may never create one.
     *
     * PrismaAdapter registers any identity that gets past the callbacks, and
     * `role` on User defaults to MENTOR. So a staff member whose Google
     * identity sits on the organisation's *other* domain was not linked to
     * their own row — the email did not match, so they got a brand-new one
     * with the wrong job title, no region and none of their history.
     *
     * That is exactly what happened to the North manager: region1@ymu.org
     * already existed as a REGIONAL_MANAGER, he signed in as
     * region1@youngmusiciansunite.org, and the app quietly grew a second Eric
     * Levy who was a Mentor. Nothing on screen looked like a failure — it
     * looked like somebody had set his role wrong, which is the expensive kind
     * of bug, because the fix people reach for is to edit the role.
     *
     * scripts/create-user.ts is the only thing that makes accounts. Google
     * only ever attaches to one that is already on the roster.
     */
    async signIn(params) {
      // The domain check runs first and still lives in auth.config.ts, which
      // the middleware imports — it has to stay free of Prisma. This half
      // needs the database, so it can only live here.
      if (!(await authConfig.callbacks!.signIn!(params))) return false;

      if (params.account?.provider !== "google") return true;

      const email = params.user?.email ?? params.profile?.email;
      if (!email) return false;

      // Case-insensitively: Google hands back whatever capitalisation the
      // person's Workspace profile carries, and the roster is typed by hand.
      const onRoster = await prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true },
      });

      // Surfaces as ?error=AccessDenied on /login, which says what to do.
      return Boolean(onRoster);
    },

    async jwt({ token, user }) {
      // Only query the DB on initial sign-in (when `user` is populated). What
      // it writes onto the token is what lets the middleware authorize without
      // a database round trip.
      if (user) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id! },
          select: {
            role: true,
            isAppAdmin: true,
            regionId: true,
            region: { select: { name: true } },
          },
        });
        if (dbUser) {
          token.role = dbUser.role;
          token.isAppAdmin = dbUser.isAppAdmin;
          token.regionId = dbUser.regionId ?? null;
          token.regionName = dbUser.region?.name ?? null;
        }
      }
      return token;
    },
  },
});
