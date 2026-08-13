// School-name normalization and matching, shared by calendar sync.
//
// Ported from the sibling YMU-A project (scripts/import-schools.ts), which
// grew these rules against the real MDCPS roster. It is a strictly stronger
// version of scripts/verify-geocoding.ts's local `normalizeName`: it also
// collapses "Senior High School"/"Middle"/"Elementary" to level tokens and
// drops the noise words ("School", "Center", "Academy") that otherwise inflate
// the similarity of two unrelated schools.

import stringSimilarity from "string-similarity";

/**
 * Reduce a school name to a comparable form: strip roster prefixes/codes,
 * uppercase, collapse level words to tokens, drop noise words and punctuation.
 */
export function normalizeSchoolName(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^MDCPS\s*\|\s*/i, "");
  s = s.replace(/\s*-\s*\(\d+\)\s*$/, "");
  s = s.toUpperCase();
  s = s.replace(/[.,'"&/]/g, " ");
  s = s.replace(/\bSENIOR HIGH SCHOOL\b|\bSENIOR HIGH\b|\bHIGH SCHOOL\b|\bSR HIGH\b/g, "HS");
  s = s.replace(/\bMIDDLE SCHOOL\b|\bMIDDLE\b/g, "MS");
  s = s.replace(/\bELEMENTARY SCHOOL\b|\bELEMENTARY\b/g, "ES");
  s = s.replace(/\bSCHOOL\b|\bCENTER\b|\bCENTRE\b|\bACADEMY\b|\bLEARNING\b/g, " ");
  s = s.replace(/\bK[\s-]?(\d+)\b/g, "K$1");
  s = s.replace(/\bPK[\s-]?(\d+)\b/g, "PK$1");
  s = s.replace(/[^A-Z0-9 ]/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

// A school name that says "Middle" cannot be the same school as one that says
// "Senior High", however similar the rest of the string is. YMU-A added this
// guard after a production incident where Hialeah Senior High got pinned to
// Homestead Senior High's calendar; without it, fuzzy matching on this roster
// produces confident-looking garbage.
const LEVEL_TOKENS = ["HS", "MS", "ES", "K8", "K5", "K12", "PK8"] as const;

/** True when both names declare a school level and the levels disagree. */
export function levelsConflict(normalizedA: string, normalizedB: string): boolean {
  const levelsOf = (s: string) =>
    new Set(LEVEL_TOKENS.filter((t) => new RegExp(`\\b${t}\\b`).test(s)));
  const a = levelsOf(normalizedA);
  const b = levelsOf(normalizedB);
  if (!a.size || !b.size) return false;
  for (const token of a) if (b.has(token)) return false;
  return true;
}

// These numbers are measured, not guessed — see scripts/check-calendar-matching.ts,
// which re-derives them from the real roster.
//
// Hiding each school from its own list and matching its name against the rest
// puts the worst false positive at 0.700 ("North Dade Middle School" ->
// "South Dade Middle School" — same level, opposite ends of the county, so
// neither the level guard nor the runner-up gap catches it). Real calendar
// names that differ from their school's name score 0.52–0.93. Those two ranges
// OVERLAP, so no threshold separates them: anything low enough to auto-pin
// "Norland Senior High School" -> "Miami Norland Senior HS" (0.52) also
// auto-pins North Dade onto South Dade.
//
// So the split is deliberate: auto-pin only above every observed false
// positive, and route the overlapping middle to a human instead of guessing.
// This costs little in practice — the YMU-A import arrives with calendars
// already pinned, so this path only sees genuinely new calendars.
export const NAME_MATCH_THRESHOLD = 0.72;
// Below the threshold but plausible: flagged for review with its candidates
// rather than silently reported as "nothing matched".
export const NAME_REVIEW_FLOOR = 0.45;
// If the runner-up is this close, the top score is not evidence of anything.
export const AMBIGUITY_MARGIN = 0.08;

export type NameCandidate<T> = { item: T; score: number };

export type NameMatch<T> =
  | { status: "matched"; item: T; score: number }
  | { status: "ambiguous"; candidates: NameCandidate<T>[] }
  | { status: "no_match"; candidates: NameCandidate<T>[] };

/**
 * Match `query` against `items` by normalized name: exact first, then fuzzy
 * with a level guard and an ambiguity check. Returns the top three candidates
 * on failure so the caller can record them for review.
 */
export function matchByName<T>(
  query: string,
  items: T[],
  nameOf: (item: T) => string
): NameMatch<T> {
  const normalizedQuery = normalizeSchoolName(query);
  if (!normalizedQuery || items.length === 0) return { status: "no_match", candidates: [] };

  const targets = items.map((item) => normalizeSchoolName(nameOf(item)));

  const exactIndex = targets.indexOf(normalizedQuery);
  if (exactIndex !== -1) {
    return { status: "matched", item: items[exactIndex], score: 1 };
  }

  const { ratings } = stringSimilarity.findBestMatch(normalizedQuery, targets);
  const ranked = ratings
    .map((rating, index) => ({
      item: items[index],
      score: rating.rating,
      conflicts: levelsConflict(normalizedQuery, targets[index]),
    }))
    .sort((a, b) => b.score - a.score);

  const viable = ranked.filter((candidate) => !candidate.conflicts);
  const top = viable[0];
  const runnerUp = viable[1];
  // Only viable candidates are surfaced for review: offering a reviewer a
  // level-conflicting school as a "candidate" invites them to confirm exactly
  // the mistake the guard just prevented.
  const candidates = viable.slice(0, 3).map(({ item, score }) => ({ item, score }));

  if (!top || top.score < NAME_REVIEW_FLOOR) {
    return { status: "no_match", candidates };
  }
  if (
    top.score < NAME_MATCH_THRESHOLD ||
    (runnerUp && top.score - runnerUp.score < AMBIGUITY_MARGIN)
  ) {
    return { status: "ambiguous", candidates };
  }
  return { status: "matched", item: top.item, score: top.score };
}
