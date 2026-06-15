// Central registry for all series browser pages.
// Slug is the URL path segment (/series/<slug>) and the eBay API route (/api/series/<slug>/...).
// blobPrefix must stay stable — changing it orphans existing cached blobs.

export const SERIES = {
  "amazing-spider-man-vol-1": {
    displayName: "The Amazing Spider-Man",
    subtitle: "Vol. 1 · 1963–1998",
    yearBegan: 1963,
    blobPrefix: "series/asm-vol1/issue-",
    dataFile: "asm-vol1-issues.json",
    seoTitle: "Amazing Spider-Man Vol. 1 — eBay Bundle Deals | Comic Bundle Finder",
    seoBlurb:
      "The classic run from Stan Lee, Steve Ditko, and John Romita Sr. spanning 442 issues from 1963 to 1998.",
  },
  "x-men-vol-1": {
    displayName: "The X-Men",
    subtitle: "Vol. 1 · 1963–1981",
    yearBegan: 1963,
    blobPrefix: "series/xmen-vol1/issue-",
    dataFile: "xmen-vol1-issues.json",
    seoTitle: "X-Men Vol. 1 — eBay Bundle Deals | Comic Bundle Finder",
    seoBlurb:
      "The original X-Men run from Stan Lee and Jack Kirby, continued by Roy Thomas and Neal Adams, and culminating in the legendary Claremont/Byrne era through issue #141.",
  },
  "daredevil-vol-1": {
    displayName: "Daredevil",
    subtitle: "Vol. 1 · 1964–1998",
    yearBegan: 1964,
    blobPrefix: "series/daredevil-vol1/issue-",
    dataFile: "daredevil-vol1-issues.json",
    seoTitle: "Daredevil Vol. 1 — eBay Bundle Deals | Comic Bundle Finder",
    seoBlurb:
      "Daredevil’s classic Marvel run from Stan Lee’s origin through Frank Miller’s legendary arcs and beyond.",
  },
  "amazing-spider-man-vol-2": {
    displayName: "The Amazing Spider-Man",
    subtitle: "Vol. 2 · 1999–2014",
    yearBegan: 1999,
    blobPrefix: "series/asm-vol2/issue-",
    dataFile: "asm-vol2-issues.json",
    seoTitle: "Amazing Spider-Man Vol. 2 — eBay Bundle Deals | Comic Bundle Finder",
    seoBlurb:
      "The modern Marvel continuation featuring J. Michael Straczynski’s acclaimed run, the Brand New Day era, and Dan Slott’s landmark run through issue #700 — 267 issues from 1999 to 2014.",
  },
  "daredevil-vol-2": {
    displayName: "Daredevil",
    subtitle: "Vol. 2 · 1998–2011",
    yearBegan: 1998,
    blobPrefix: "series/daredevil-vol2/issue-",
    dataFile: "daredevil-vol2-issues.json",
    seoTitle: "Daredevil Vol. 2 — eBay Bundle Deals | Comic Bundle Finder",
    seoBlurb:
      "The Marvel Knights relaunch featuring Kevin Smith’s retelling, Brian Michael Bendis’s acclaimed noir run, and Ed Brubaker’s dark continuation — 133 issues from 1998 to 2011.",
  },
  "uncanny-x-men": {
    displayName: "The Uncanny X-Men",
    subtitle: "#142–544 · 1981–2011",
    yearBegan: 1981,
    blobPrefix: "series/uncanny-xmen/issue-",
    dataFile: "uncanny-xmen-issues.json",
    seoTitle: "Uncanny X-Men — eBay Bundle Deals | Comic Bundle Finder",
    seoBlurb:
      "The direct continuation of X-Men Vol. 1 under the Uncanny X-Men title — Chris Claremont’s legendary run through the 2000s, issues #142–544 from 1981 to 2011.",
  },
};

export function getSeriesConfig(slug) {
  return SERIES[slug] || null;
}

// Groups related volumes under a single searchable franchise name.
// Used by /collection-guides search and /series-guide/[slug] landing pages.
export const SERIES_GROUPS = {
  "amazing-spider-man": {
    name: "The Amazing Spider-Man",
    slugs: ["amazing-spider-man-vol-1", "amazing-spider-man-vol-2"],
  },
  "daredevil": {
    name: "Daredevil",
    slugs: ["daredevil-vol-1", "daredevil-vol-2"],
  },
  "x-men": {
    name: "The X-Men",
    slugs: ["x-men-vol-1"],
  },
  "uncanny-x-men": {
    name: "The Uncanny X-Men",
    slugs: ["uncanny-x-men"],
  },
};
