// Generates the PWA icon set for SVP.
//
//   npm run icons
//
// PORTED FROM YMU-A's scripts/generate-icons.mjs, and the two-icons rule there
// applies here unchanged: `any` is drawn as authored (square, corners intact),
// while `maskable` is cropped by the launcher to whatever shape the platform
// likes — usually a circle — with only the middle 80% guaranteed to survive.
// They are DIFFERENT ARTWORK, not the same file listed twice.
//
// WHAT IS DIFFERENT HERE, AND WHY.
//
// These icons sit on the same home screen as YMU-A's, so "on brand" is not
// enough — they have to be tellable apart at 60px, in a hurry, by someone who
// has both installed. Two things do that work:
//
//   SHAPE, which is the one that actually carries it. YMU-A's icons are the
//   YMU letterforms / square lockup. SVP's is a route: a line from a start dot
//   through a stop to a pin. Different silhouette, so the distinction survives
//   at any size and in greyscale.
//
//   COLOUR, as backup. SVP's accent is indigo (the same indigo-600 the app's
//   own UI uses for its heading and focus rings — see src/app/page.tsx), not
//   YMU-A's brand blue. Close cousins on purpose: same family, different app.
//
// The route mark is composed in this file rather than living in public/brand/
// because it is NOT official YMU branding — public/brand/ holds the real,
// unmodified files (the YMU letterforms, used below for the family
// resemblance) and nothing else should be mistaken for them. Building it here
// also means one colour parameter instead of a second near-identical SVG.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brand = join(root, "public", "brand");
const out = join(root, "public", "icons");

const INDIGO = "#4f46e5";
const CREAM = "#faf6eb";

/**
 * The largest width a 2.63:1 mark can take inside the maskable safe circle.
 *
 * The safe zone is a circle of diameter 0.8 × size. Inscribing a rectangle of
 * aspect r in a circle of diameter d gives w = d / sqrt(1 + 1/r²) — about
 * 0.75 × size for the letterforms. The route mark is square (1:1), where the
 * same formula gives 0.57, so it gets its own smaller ratio below.
 */
const MASKABLE_MARK_RATIO = 0.54;

/**
 * The route mark, as an SVG string in the given colour.
 *
 * A start dot, a stop on the way, and a pin at the destination — which is
 * literally what the app does (proposeVisits.ts orders a day's schools into a
 * drive). Stroke-based and chunky (9 units on a 100 unit box) so it holds up
 * at 32px; anything finer turns to mush at favicon size.
 */
function routeMark(color) {
  // viewBox is cropped to the artwork's real bounds (x 13..93, y 12..91 once
  // stroke width and the dots' radii are counted) rather than a round 0 0 100
  // 100. Otherwise every resize below is scaling ~15% of empty margin, and the
  // mark sits visibly high and left of where the maths says it should.
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="11 9 84 84">
  <g fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 82 C22 60 48 66 54 46" />
  </g>
  <circle cx="22" cy="82" r="9" fill="${color}" />
  <circle cx="54" cy="46" r="6.5" fill="${color}" />
  <path d="M72 12 c11.6 0 21 9.4 21 21 0 14.7-21 33-21 33 S51 47.7 51 33 c0-11.6 9.4-21 21-21 z" fill="${color}" />
  <circle cx="72" cy="33" r="7.5" fill="${CREAM}" />
</svg>`);
}

/**
 * Square icon, corners intact: cream field, the route in indigo, and the YMU
 * letterforms underneath so it still reads as one of ours rather than a
 * generic maps app.
 */
async function anyIcon(size) {
  // Both layers are placed with explicit top/left. Sharp IGNORES `gravity`
  // when either is present, so mixing them ("gravity: south, top: 0") silently
  // pins the layer to the top-left corner instead — which is how the wordmark
  // ended up overlapping the route on the first pass.
  const routeSize = Math.round(size * 0.5);
  const wordmarkWidth = Math.round(size * 0.44);
  // The letterforms are 2.63:1; sharp needs the height to position them.
  const wordmarkHeight = Math.round(wordmarkWidth / 2.63);

  const route = await sharp(routeMark(INDIGO), { density: 600 })
    .resize({ width: routeSize })
    .toBuffer();

  const wordmark = await sharp(join(brand, "ymu-symbol.svg"), { density: 600 })
    .resize({ width: wordmarkWidth })
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background: CREAM },
  })
    .composite([
      {
        input: route,
        top: Math.round(size * 0.12),
        left: Math.round((size - routeSize) / 2),
      },
      {
        input: wordmark,
        // Sits in the band below the route: 0.12 + 0.5 leaves the bottom
        // 0.38 of the icon, and this centres the wordmark in it.
        top: Math.round(size * 0.81 - wordmarkHeight / 2),
        left: Math.round((size - wordmarkWidth) / 2),
      },
    ])
    .png()
    .toBuffer();
}

/**
 * Maskable: indigo field, cream route, no wordmark. The letterforms are the
 * first thing a circle mask would eat, and they are unreadable at 192px
 * anyway — the same reason YMU-A's maskable drops its emblem's wordmark.
 */
async function maskableIcon(size) {
  // The pin's inner hole is punched in CREAM by routeMark(), which is exactly
  // right on the cream field above and exactly wrong here — on indigo it has
  // to be the field colour, or the pin gets a cream dot floating in it.
  const svg = routeMark(CREAM)
    .toString()
    .replace(`r="7.5" fill="${CREAM}"`, `r="7.5" fill="${INDIGO}"`);

  const route = await sharp(Buffer.from(svg), { density: 600 })
    .resize({ width: Math.round(size * MASKABLE_MARK_RATIO) })
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background: INDIGO },
  })
    .composite([{ input: route, gravity: "center" }])
    .png()
    .toBuffer();
}

mkdirSync(out, { recursive: true });

for (const size of [192, 512]) {
  writeFileSync(join(out, `icon-${size}.png`), await anyIcon(size));
  writeFileSync(join(out, `maskable-${size}.png`), await maskableIcon(size));
  console.log(`  icon-${size}.png + maskable-${size}.png`);
}

// iOS never masks; it rounds the corners itself and shows the rest as given.
writeFileSync(join(out, "apple-touch-icon.png"), await anyIcon(180));
console.log("  apple-touch-icon.png");

// The favicon browsers fall back to. Far too small for the wordmark, so it
// gets the route alone on indigo — same reasoning as maskable, more so.
writeFileSync(join(out, "icon-32.png"), await maskableIcon(32));
console.log("  icon-32.png");

console.log("\nDone.");
