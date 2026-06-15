// Every indexed story arc with 2+ issues. Arc URLs are /arc/<slug> where slug
// already begins with the Metron id (e.g. "659-til-death-do-us").
import { BASE_URL, buildUrlSet, getSitemapArcs, sendSitemap } from "../lib/sitemap-data";

function SiteMap() {}

export async function getServerSideProps({ res }) {
  const entries = getSitemapArcs().map((arc) => ({
    loc: `${BASE_URL}/arc/${arc.slug}`,
    changefreq: "weekly",
    priority: "0.7",
  }));
  sendSitemap(res, buildUrlSet(entries));
  return { props: {} };
}

export default SiteMap;
