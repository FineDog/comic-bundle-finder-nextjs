import { SERIES } from "../lib/series-config";

const BASE_URL = "https://www.comicbundlefinder.com";

function SiteMap() {}

export async function getServerSideProps({ res }) {
  const slugs = Object.keys(SERIES);

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE_URL}</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${BASE_URL}/collection-guides</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  ${slugs
    .map(
      (slug) => `<url>
    <loc>${BASE_URL}/series/${slug}</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>`
    )
    .join("\n  ")}
</urlset>`;

  res.setHeader("Content-Type", "text/xml");
  res.write(sitemap);
  res.end();

  return { props: {} };
}

export default SiteMap;
