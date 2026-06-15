// Static pages, series-guide group landing pages, and the curated series runs.
import { SERIES, SERIES_GROUPS } from "../lib/series-config";
import { getAllBlogPosts } from "../lib/content";
import { BASE_URL, buildUrlSet, sendSitemap } from "../lib/sitemap-data";

// Hand-maintained list of crawlable static pages. Auth/account/api/results pages
// are intentionally excluded — they're gated, private, or have no SEO value.
const STATIC_PAGES = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/collection-guides", changefreq: "weekly", priority: "0.9" },
  { path: "/gap-analyzer", changefreq: "monthly", priority: "0.7" },
  { path: "/blog", changefreq: "weekly", priority: "0.7" },
  { path: "/faq", changefreq: "monthly", priority: "0.5" },
  { path: "/upgrade", changefreq: "monthly", priority: "0.5" },
];

function SiteMap() {}

export async function getServerSideProps({ res }) {
  const entries = STATIC_PAGES.map((p) => ({
    loc: `${BASE_URL}${p.path}`,
    changefreq: p.changefreq,
    priority: p.priority,
  }));

  for (const slug of Object.keys(SERIES_GROUPS)) {
    entries.push({
      loc: `${BASE_URL}/series-guide/${slug}`,
      changefreq: "weekly",
      priority: "0.8",
    });
  }

  for (const slug of Object.keys(SERIES)) {
    entries.push({
      loc: `${BASE_URL}/series/${slug}`,
      changefreq: "daily",
      priority: "0.9",
    });
  }

  for (const post of getAllBlogPosts()) {
    entries.push({
      loc: `${BASE_URL}/blog/${post.slug}`,
      changefreq: "monthly",
      priority: "0.6",
    });
  }

  sendSitemap(res, buildUrlSet(entries));
  return { props: {} };
}

export default SiteMap;
