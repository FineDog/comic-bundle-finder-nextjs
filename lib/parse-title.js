// Structured parser for eBay listing titles and comic search queries.
// Replaces the old positional-regex titleMatchesIssue with field-by-field comparison.

// Normalize series name for storage: lowercase, collapse whitespace, strip leading articles.
function normSeries(s) {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:the|a|an)\s+/, "");
}

// Normalize for fuzzy comparison: also strips hyphens so spider-man ≡ spiderman.
function normForMatch(s) {
  return s.toLowerCase().replace(/-/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Parse an eBay listing title into structured fields.
 *
 * Rules (applied in order):
 *  1. Content inside () → metadata; never an issue or volume number.
 *  2. "Vol N" / "Volume N" → volume.
 *  3. "#N" → issue.
 *  4. Otherwise, first standalone number after the series words → issue.
 *     Consecutive standalone numbers immediately following → lot set.
 *  5. Everything before the issue anchor (minus vol notation) → series.
 *  6. Everything after the issue anchor → metadata.
 *
 * @param {string} title
 * @returns {{ series: string, volume: number|null, issue: number|null, issueSet: Set<number>, metadata: string[] }}
 */
export function parseTitle(title) {
  const parenMeta = [];
  let s = title.replace(/\(([^)]*)\)/g, (_, inner) => {
    const tokens = inner.trim().split(/\s+/).filter(Boolean);
    for (const t of tokens) parenMeta.push(t.toLowerCase());
    return " ";
  });

  let volume = null;
  s = s.replace(/\bvol(?:ume)?\.?\s*(\d+)/i, (_, n) => {
    volume = parseInt(n, 10);
    return " ";
  });

  let issue = null;
  let seriesPart = s;
  let afterIssue = "";

  const hashMatch = s.match(/#\s*(\d+)/);
  if (hashMatch) {
    issue = parseInt(hashMatch[1], 10);
    seriesPart = s.slice(0, hashMatch.index);
    afterIssue = s.slice(hashMatch.index + hashMatch[0].length);
  } else {
    // \b(\d+)\b matches whole numbers only — "50th" does not match because
    // there is no word boundary between "0" and "t".
    const numMatch = s.match(/\b(\d+)\b/);
    if (numMatch) {
      issue = parseInt(numMatch[1], 10);
      seriesPart = s.slice(0, numMatch.index);
      afterIssue = s.slice(numMatch.index + numMatch[0].length);
    }
  }

  const issueSet = new Set();
  if (issue !== null) issueSet.add(issue);

  // Consume consecutive standalone numbers at the start of afterIssue (lot listings).
  // Stop as soon as we see anything non-numeric (including ordinal suffixes like "th").
  let rem = afterIssue;
  let lotMatch;
  while ((lotMatch = rem.match(/^\s*(\d+)\b(?![a-zA-Z])/))) {
    issueSet.add(parseInt(lotMatch[1], 10));
    rem = rem.slice(lotMatch[0].length);
  }

  const series = normSeries(seriesPart.replace(/[^a-zA-Z0-9\s-]/g, " "));
  const postTokens = (rem.match(/\S+/g) || []).map((t) => t.toLowerCase());
  const metadata = [...parenMeta, ...postTokens];

  return { series, volume, issue, issueSet, metadata };
}

/**
 * Parse a user query or DB issue name into structured fields.
 *
 * Parens are stripped entirely — they serve as year/edition disambiguators
 * (e.g. "Amazing Spider-Man #1 (1963)") and must not become required filters.
 * Only text appearing after the issue number (outside parens) becomes metadataFilters.
 *
 * @param {string} query
 * @returns {{ series: string, volume: number|null, issue: number|null, metadataFilters: string[] }}
 */
export function parseQuery(query) {
  let s = query.replace(/\([^)]*\)/g, " ");

  let volume = null;
  s = s.replace(/\bvol(?:ume)?\.?\s*(\d+)/i, (_, n) => {
    volume = parseInt(n, 10);
    return " ";
  });

  let issue = null;
  let seriesPart = s;
  let afterIssue = "";

  const hashMatch = s.match(/#\s*(\d+)/);
  if (hashMatch) {
    issue = parseInt(hashMatch[1], 10);
    seriesPart = s.slice(0, hashMatch.index);
    afterIssue = s.slice(hashMatch.index + hashMatch[0].length);
  } else {
    const numMatch = s.match(/\b(\d+)\b/);
    if (numMatch) {
      issue = parseInt(numMatch[1], 10);
      seriesPart = s.slice(0, numMatch.index);
      afterIssue = s.slice(numMatch.index + numMatch[0].length);
    }
  }

  const series = normSeries(seriesPart.replace(/[^a-zA-Z0-9\s-]/g, " "));
  const metadataFilters = afterIssue
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  return { series, volume, issue, metadataFilters };
}

/**
 * Returns true if a listing title matches a query (DB issue name or user-typed search).
 *
 * Matching rules:
 *  - Series: all normalized query series words must appear in the normalized listing title.
 *  - Issue: exact match, or in the lot set for multi-issue listings.
 *  - Volume: if both sides specify one, they must agree; if either omits it, accept.
 *  - Metadata filters: every term from the query must appear as a case-insensitive
 *    substring in the listing title. No filter terms → no metadata filtering.
 *
 * @param {string} listingTitle
 * @param {string} queryString
 * @returns {boolean}
 */
export function titleMatchesQuery(listingTitle, queryString) {
  const listing = parseTitle(listingTitle);
  const query = parseQuery(queryString);

  // Series: check all query words against the full normalized title so publisher
  // prefixes in listing titles ("Marvel Comics Daredevil #18") don't break matches.
  const normTitle = normForMatch(listingTitle);
  const queryWords = normForMatch(query.series).split(/\s+/).filter(Boolean);
  if (queryWords.length > 0 && !queryWords.every((w) => normTitle.includes(w))) return false;

  // Issue: exact match (or contained in lot set).
  if (query.issue !== null && !listing.issueSet.has(query.issue)) return false;

  // Volume: both sides must agree when both are present.
  if (query.volume !== null && listing.volume !== null && query.volume !== listing.volume) {
    return false;
  }

  // Metadata filters: each term must appear somewhere in the original title.
  const titleLower = listingTitle.toLowerCase();
  for (const filter of query.metadataFilters) {
    if (!titleLower.includes(filter)) return false;
  }

  return true;
}
