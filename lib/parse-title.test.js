import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTitle, parseQuery, titleMatchesQuery } from "./parse-title.js";

// ── parseTitle ──────────────────────────────────────────────────────────────

test("parseTitle: Vol + # notation", () => {
  const r = parseTitle("Amazing Spider-Man Vol 1 #155");
  assert.equal(r.series, "amazing spider-man");
  assert.equal(r.volume, 1);
  assert.equal(r.issue, 155);
  assert.deepEqual(r.metadata, []);
});

test("parseTitle: # only, four-digit issue", () => {
  const r = parseTitle("Amazing Spider-Man #1000");
  assert.equal(r.series, "amazing spider-man");
  assert.equal(r.volume, null);
  assert.equal(r.issue, 1000);
  assert.deepEqual(r.metadata, []);
});

test("parseTitle: year in parens + cross-title ordinal number", () => {
  const r = parseTitle("Daredevil 18 (2011) Spider-Man 50th Anniversary Variant");
  assert.equal(r.series, "daredevil");
  assert.equal(r.issue, 18);
  // "50th" is NOT parsed as a standalone issue number — the word boundary
  // check prevents it, and it ends up in post-issue metadata.
  assert.deepEqual(r.metadata, ["2011", "spider-man", "50th", "anniversary", "variant"]);
});

test("parseTitle: bare number issue with post-issue grade", () => {
  const r = parseTitle("Amazing Spider-Man 300 CGC 9.8");
  assert.equal(r.series, "amazing spider-man");
  assert.equal(r.issue, 300);
  assert.ok(r.metadata.includes("cgc"));
  assert.ok(r.metadata.includes("9.8"));
});

test("parseTitle: lot listing builds issueSet from consecutive numbers", () => {
  const r = parseTitle("Spider-Man 155 156 157 lot of 3");
  assert.equal(r.issue, 155);
  assert.ok(r.issueSet.has(155));
  assert.ok(r.issueSet.has(156));
  assert.ok(r.issueSet.has(157));
  assert.equal(r.issueSet.size, 3);
});

test("parseTitle: ordinal suffix stops lot scan", () => {
  // "50th" must not be consumed as a lot number.
  const r = parseTitle("Daredevil 18 50th Anniversary");
  assert.equal(r.issue, 18);
  assert.ok(!r.issueSet.has(50), "50th should not be in lot set");
});

test("parseTitle: DB-style issue name with year in parens", () => {
  const r = parseTitle("The Amazing Spider-Man #1 (1963)");
  assert.equal(r.series, "amazing spider-man");
  assert.equal(r.issue, 1);
  assert.equal(r.volume, null);
});

test("parseTitle: Volume with period (Vol. 2)", () => {
  const r = parseTitle("Daredevil Vol. 2 #1");
  assert.equal(r.volume, 2);
  assert.equal(r.issue, 1);
  assert.equal(r.series, "daredevil");
});

// ── parseQuery ──────────────────────────────────────────────────────────────

test("parseQuery: bare series + number", () => {
  const q = parseQuery("daredevil 18");
  assert.equal(q.series, "daredevil");
  assert.equal(q.issue, 18);
  assert.deepEqual(q.metadataFilters, []);
});

test("parseQuery: series + number + single metadata term", () => {
  const q = parseQuery("daredevil 18 variant");
  assert.equal(q.series, "daredevil");
  assert.equal(q.issue, 18);
  assert.deepEqual(q.metadataFilters, ["variant"]);
});

test("parseQuery: metadata with decimal grade", () => {
  const q = parseQuery("amazing spider-man 300 cgc 9.8");
  assert.equal(q.series, "amazing spider-man");
  assert.equal(q.issue, 300);
  assert.deepEqual(q.metadataFilters, ["cgc", "9.8"]);
});

test("parseQuery: multi-word metadata phrase", () => {
  const q = parseQuery("amazing spider-man 300 first printing");
  assert.equal(q.issue, 300);
  assert.deepEqual(q.metadataFilters, ["first", "printing"]);
});

test("parseQuery: DB-style name strips year from parens, no metadata filters", () => {
  const q = parseQuery("The Amazing Spider-Man #155 (1976)");
  assert.equal(q.series, "amazing spider-man");
  assert.equal(q.issue, 155);
  assert.deepEqual(q.metadataFilters, []);
});

test("parseQuery: explicit volume", () => {
  const q = parseQuery("daredevil vol 2 1");
  assert.equal(q.volume, 2);
  assert.equal(q.issue, 1);
  assert.equal(q.series, "daredevil");
});

// ── titleMatchesQuery ───────────────────────────────────────────────────────

test("Daredevil 18 listing does NOT match query 'Daredevil 50'", () => {
  assert.equal(
    titleMatchesQuery(
      "Daredevil 18 (2011) Spider-Man 50th Anniversary Variant",
      "Daredevil 50"
    ),
    false
  );
});

test("Daredevil 18 listing matches query 'Daredevil 18'", () => {
  assert.equal(
    titleMatchesQuery(
      "Daredevil 18 (2011) Spider-Man 50th Anniversary Variant",
      "Daredevil 18"
    ),
    true
  );
});

test("Daredevil 18 variant listing matches query 'daredevil 18 variant'", () => {
  assert.equal(
    titleMatchesQuery("Daredevil #18 Variant Cover", "daredevil 18 variant"),
    true
  );
});

test("Daredevil 18 listing does NOT match query 'daredevil 18 cgc'", () => {
  assert.equal(
    titleMatchesQuery("Daredevil 18 (2011) Spider-Man 50th Anniversary Variant", "daredevil 18 cgc"),
    false
  );
});

test("Amazing Spider-Man 300 CGC 9.8 matches query 'amazing spider-man 300 cgc 9.8'", () => {
  assert.equal(
    titleMatchesQuery("Amazing Spider-Man 300 CGC 9.8", "amazing spider-man 300 cgc 9.8"),
    true
  );
});

test("Amazing Spider-Man 300 CGC 9.8 does NOT match query 'amazing spider-man 300 9.6'", () => {
  assert.equal(
    titleMatchesQuery("Amazing Spider-Man 300 CGC 9.8", "amazing spider-man 300 9.6"),
    false
  );
});

test("Lot listing matches query for any issue in the set", () => {
  assert.equal(titleMatchesQuery("Spider-Man 155 156 157 lot of 3", "spider-man 155"), true);
  assert.equal(titleMatchesQuery("Spider-Man 155 156 157 lot of 3", "spider-man 156"), true);
  assert.equal(titleMatchesQuery("Spider-Man 155 156 157 lot of 3", "spider-man 157"), true);
});

test("Lot listing does NOT match issue outside the set", () => {
  assert.equal(titleMatchesQuery("Spider-Man 155 156 157 lot of 3", "spider-man 158"), false);
});

test("Hyphen-normalized series: spider-man query finds spiderman listing", () => {
  assert.equal(titleMatchesQuery("Spiderman #155 VF", "spider-man 155"), true);
});

test("Hyphen-normalized series: spiderman query finds spider-man listing", () => {
  assert.equal(titleMatchesQuery("Spider-Man #155 VF", "spiderman 155"), true);
});

test("DB-style issue name matches its own listing title", () => {
  assert.equal(
    titleMatchesQuery("Amazing Spider-Man #155 VF/NM", "The Amazing Spider-Man #155 (1976)"),
    true
  );
});

test("Volume agreement: listing vol 1 matches query with no volume", () => {
  assert.equal(
    titleMatchesQuery("Daredevil Vol 1 #18 FN", "Daredevil #18"),
    true
  );
});

test("Volume agreement: mismatched volumes reject", () => {
  assert.equal(
    titleMatchesQuery("Daredevil Vol 2 #18 FN", "daredevil vol 1 18"),
    false
  );
});

test("Publisher prefix in listing title does not block series match", () => {
  assert.equal(
    titleMatchesQuery("Marvel Comics Daredevil #18 VF/NM 9.0", "Daredevil 18"),
    true
  );
});
