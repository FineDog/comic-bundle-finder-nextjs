// Sitemap index. Points crawlers at the segmented child sitemaps:
//   /sitemap-pages.xml   — home, static pages, series-guide groups, curated series
//   /sitemap-arcs.xml    — every indexed story arc (issueCount >= 2)
//   /sitemap-series.xml?page=N — metron series, chunked (issueCount >= 2)
import { BASE_URL, buildSitemapIndex, seriesChunkCount, sendSitemap } from "../lib/sitemap-data";

function SiteMap() {}

export async function getServerSideProps({ res }) {
  const locs = [
    `${BASE_URL}/sitemap-pages.xml`,
    `${BASE_URL}/sitemap-arcs.xml`,
  ];
  for (let i = 0; i < seriesChunkCount(); i++) {
    locs.push(`${BASE_URL}/sitemap-series.xml?page=${i}`);
  }
  sendSitemap(res, buildSitemapIndex(locs));
  return { props: {} };
}

export default SiteMap;
