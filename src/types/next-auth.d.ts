import { Role } from "@prisma/client";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      /// Administers the app, independently of the job title in `role`.
      isAppAdmin: boolean;
      regionId: string | null;
      regionName: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Role;
    isAppAdmin: boolean;
    regionId: string | null;
    regionName: string | null;
  }
}
