import type { NearbyStation } from "@/types/database";

/**
 * Station search: ranked, typo-tolerant, and entirely on-device.
 *
 * On-device because the whole station list is small enough to hold (128 rows
 * at the time of writing, ~30KB). That buys instant results per keystroke, no
 * request to debounce, and search that still works with no signal -- which for
 * a driver looking for fuel is not a small thing. If the list ever grows past
 * a few thousand this should move into Postgres, where pg_trgm does the same
 * measure with an index behind it.
 */

/** Below this length a term is not fuzzy-matched. Three characters are close
 *  to everything, and "hp" matching "Yeshwanthpur" reads as a broken search. */
const FUZZY_MIN_LENGTH = 4;

/**
 * Trigram similarity a word must reach to count as a typo of the term.
 *
 * Tuned against the real station list rather than picked: over a sample of
 * plausible misspellings, 0.4 resolved 10 of 12 (missing "umia" for "umiya",
 * which scores 0.38 -- dropping a letter from a short word costs a larger
 * share of its trigrams), 0.35 resolved 11, and 0.3 resolved the same 11 while
 * letting noticeably more unrelated words collide. So 0.35.
 *
 * Collisions are survivable anyway: a fuzzy hit scores half its similarity,
 * below every exact, prefix and substring match, so a stray one lands at the
 * bottom of the results rather than displacing what was actually meant.
 */
const FUZZY_THRESHOLD = 0.35;

/**
 * Character trigrams, padded at the edges so the start and end of a word carry
 * weight. The same decomposition Postgres's pg_trgm uses, so moving this to
 * SQL later would rank things the same way.
 */
function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const set = new Set<string>();

  for (let index = 0; index < padded.length - 2; index += 1) {
    set.add(padded.slice(index, index + 3));
  }

  return set;
}

/** Jaccard similarity of two words' trigrams, 0 to 1. */
function similarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);

  let shared = 0;
  for (const gram of left) {
    if (right.has(gram)) shared += 1;
  }

  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * How well one typed term matches a station, 0 for "not at all".
 *
 * Tiered rather than pure similarity so that exact and prefix matches always
 * beat a lucky fuzzy one: someone typing "shiroli" wants Shiroli first, not a
 * station whose name happens to share trigrams with it.
 */
function scoreTerm(term: string, words: string[]): number {
  let best = 0;

  for (const word of words) {
    if (word === term) return 1;

    if (word.startsWith(term)) {
      best = Math.max(best, 0.9);
      continue;
    }

    if (word.includes(term)) {
      best = Math.max(best, 0.6);
      continue;
    }

    if (term.length >= FUZZY_MIN_LENGTH) {
      const score = similarity(term, word);
      if (score >= FUZZY_THRESHOLD) best = Math.max(best, score * 0.5);
    }
  }

  return best;
}

/** The words a station can be found by. Address and area are included so
 *  "kolhapur" or "rajarampuri" find stations, not just their names. */
function searchableWords(station: NearbyStation): string[] {
  return [station.name, station.area, station.address, station.operator]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Stations matching `query`, best first.
 *
 * Every typed term has to match something -- "bpcl heb" means both, not
 * either -- which keeps multi-word queries narrowing rather than widening.
 * Ties break on distance, so of two equally good matches the closer one wins.
 */
export function rankStations(
  stations: NearbyStation[],
  query: string,
): NearbyStation[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scored: { station: NearbyStation; score: number }[] = [];

  for (const station of stations) {
    const words = searchableWords(station);

    let total = 0;
    let matchedEvery = true;

    for (const term of terms) {
      const score = scoreTerm(term, words);
      if (score === 0) {
        matchedEvery = false;
        break;
      }
      total += score;
    }

    if (matchedEvery) scored.push({ station, score: total });
  }

  scored.sort((a, b) =>
    b.score === a.score ? a.station.distance_m - b.station.distance_m : b.score - a.score,
  );

  return scored.map((entry) => entry.station);
}
