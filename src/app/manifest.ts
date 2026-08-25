import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SVP — School Visit Planner",
    // What the launcher prints under the icon, where it gets truncated around
    // 12 characters. "SVP" so it never gets cut, and so it matches how the
    // Regional Managers already refer to it.
    short_name: "SVP",
    description:
      "Weekly route and visit planner for YMU Regional Managers across Miami-Dade schools.",
    id: "/",
    start_url: "/",
    display: "standalone",
    // No `orientation` lock, unlike YMU-A's portrait. This app is a planning
    // tool with a sidebar, a week grid and a map — all of which are better in
    // landscape on a tablet, which is where an RM actually plans a week.
    background_color: "#faf6eb",
    // Indigo, matching the app's own accent and viewport themeColor. See
    // scripts/generate-icons.mjs for why SVP is indigo where YMU-A is blue.
    theme_color: "#4f46e5",
    icons: [
      // `any` and `maskable` are DIFFERENT ARTWORK — a launcher crops a
      // maskable icon to its own shape and only guarantees the middle 80%, so
      // the square version with the wordmark cannot serve both purposes.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
