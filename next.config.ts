import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

// Compiles src/app/sw.ts and builds the precache manifest the worker reads as
// self.__SW_MANIFEST. Without this the /serwist/sw.js route serves nothing and
// the app is not installable.
export default withSerwist(nextConfig);
