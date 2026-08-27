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
