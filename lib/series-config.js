// Central registry for all series browser pages.
// Slug is the URL path segment (/series/<slug>) and the eBay API route (/api/series/<slug>/...).
// blobPrefix must stay stable — changing it orphans existing cached blobs.

export const SERIES = {
  "amazing-spider-man-vol-1": {
    displayName: "The Amazing Spider-Man",
    subtitle: "Vol. 1 · 1963–1998",
    blobPrefix: "series/asm-vol1/issue-",
    dataFile: "asm-vol1-issues.json",
    seoTitle: "Amazing Spider-Man Vol. 1 — eBay Bundle Deals | Comic Bundle Finder",
    seoBlurb:
      "The classic run from Stan Lee, Steve Ditko, and John Romita Sr. spanning 442 issues from 1963 to 1998.",
  },
  "x-men-vol-1": {
    displayName: "The X-Men",
    subtitle: "Vol. 1 · 1963–1981",
    blobPrefix: "series/xmen-vol1/issue-",
    dataFile: "xmen-vol1-issues.json",
    seoTitle: "X-Men Vol. 1 — eBay Bundle Deals | Comic Bundle Finder",
    seoBlurb:
      "The original X-Men run from Stan Lee and Jack Kirby, later continued by Roy Thomas and Neal Adams, including annuals and specials.",
  },
  "daredevil-vol-1": {
    displayName: "Daredevil",
    subtitle: "Vol. 1 · 1964–1998",
    blobPrefix: "series/daredevil-vol1/issue-",
    dataFile: "daredevil-vol1-issues.json",
    seoTitle: "Daredevil Vol. 1 — eBay Bundle Deals | Comic Bundle Finder",
    seoBlurb:
      "Daredevil’s classic Marvel run from Stan Lee’s origin through Frank Miller’s legendary arcs and beyond.",
  },
};

export function getSeriesConfig(slug) {
  return SERIES[slug] || null;
}
