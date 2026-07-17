import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // Hint the Google login screen to pre-fill @ymu.org accounts.
          // The actual domain check is enforced in signIn callback below.
          hd: "ymu.org",
        },
      },
    }),

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
    async signIn({ account, profile }) {
      if (account?.provider === "google") {
        // Defense-in-depth: the hd param is only a UI hint; validate the domain here.
        return Boolean(profile?.email?.endsWith("@ymu.org"));
      }
      return true;
    },

    async jwt({ token, user }) {
      // Only query DB on initial sign-in (when `user` is populated)
      if (user) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id! },
          select: { role: true, regionId: true, region: { select: { name: true } } },
        });
        if (dbUser) {
          token.role = dbUser.role;
          token.regionId = dbUser.regionId ?? null;
          token.regionName = dbUser.region?.name ?? null;
        }
      }
      return token;
    },

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
});
