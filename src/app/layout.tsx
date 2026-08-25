import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { SerwistProvider } from "@serwist/turbopack/react";
import InstallPrompt from "@/components/InstallPrompt";
import SwUpdatePrompt from "@/components/SwUpdatePrompt";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  applicationName: "SVP",
  title: "Regional School Visit Planner",
  description: "Dynamic route planner for Miami-Dade County Public Schools",
  icons: {
    icon: "/icons/icon-32.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    // What iOS prints under the home-screen icon. Matches manifest.ts's
    // short_name — if these disagree, the same app shows up under two
    // different names depending on the platform.
    title: "SVP",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  // Must agree with manifest.ts's theme_color, or the installed app and the
  // browser tab disagree about what colour SVP is.
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
  // No userScalable: false — the week grid and the map are dense, and pinch
  // zoom is how you read them on a phone.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="antialiased">
      <body className={inter.className}>
        <SerwistProvider swUrl="/serwist/sw.js">
          <SessionProvider>{children}</SessionProvider>
          <SwUpdatePrompt />
        </SerwistProvider>
        <InstallPrompt />
      </body>
    </html>
  );
}
