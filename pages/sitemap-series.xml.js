// One chunk of the metron series sitemap. Crawlers reach this via the sitemap
// index, which lists ?page=0..N (see seriesChunkCount). Series URLs are
// name-based (e.g. /series/infamous-iron-man-2016); the page itself renders from
// the static series index.
import {
  BASE_URL,
  SERIES_CHUNK_SIZE,
  buildUrlSet,
  getSitemapSeries,
  sendSitemap,
} from "../lib/sitemap-data";
import { metronIdToSlug } from "../lib/series-slug";

function SiteMap() {}

export async function getServerSideProps({ res, query }) {
  const page = Math.max(0, parseInt(query.page, 10) || 0);
  const all = getSitemapSeries();
  const start = page * SERIES_CHUNK_SIZE;
  const chunk = all.slice(start, start + SERIES_CHUNK_SIZE);

  const entries = chunk.map((s) => ({
    loc: `${BASE_URL}/series/${metronIdToSlug(s.id)}`,
    changefreq: "weekly",
    priority: "0.6",
  }));
  sendSitemap(res, buildUrlSet(entries));
  return { props: {} };
}

export default SiteMap;
