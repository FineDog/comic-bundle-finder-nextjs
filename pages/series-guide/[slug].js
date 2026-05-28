import fs from "fs";
import path from "path";
import Head from "next/head";
import Link from "next/link";
import { SERIES, SERIES_GROUPS } from "../../lib/series-config";
import SiteNav from "../../components/SiteNav";

export default function SeriesGuidePage({ groupSlug, groupName, volumes }) {
  return (
    <>
      <Head>
        <title>{groupName} — Series Guide | Comic Bundle Finder</title>
        <meta name="description" content={`Browse all ${groupName} series volumes and find eBay bundle deals for every issue.`} />
        <meta property="og:title" content={`${groupName} — Series Guide | Comic Bundle Finder`} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`https://www.comicbundlefinder.com/series-guide/${groupSlug}`} />
        <meta property="og:image" content="https://www.comicbundlefinder.com/preview.png" />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={`https://www.comicbundlefinder.com/series-guide/${groupSlug}`} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem}

        .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.75rem}
        .panel-slim{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;padding:0.6rem 1.25rem;margin-bottom:1.75rem}
        .caption{display:inline-block;background:#ffe066;border:2px solid #1a1a1a;padding:0.3rem 0.7rem;font-size:0.8rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:1.25rem}
        .back-link{font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#003399;text-decoration:none}
        .back-link:hover{text-decoration:underline}

        .series-header{background:#cc1f00;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.25rem 1.75rem 1rem;margin-bottom:1.75rem;text-align:center}
        .series-header h1{font-family:'Bangers',cursive;font-size:clamp(2rem,7vw,3.5rem);color:#fffdf4;letter-spacing:4px;text-shadow:3px 3px 0 #1a1a1a;line-height:1;margin-bottom:0.35rem}
        .series-sub{color:#ffe066;font-size:0.82rem;letter-spacing:2px;text-transform:uppercase;font-weight:400}

        .volume-card{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:5px 5px 0 #1a1a1a;display:flex;overflow:hidden;margin-bottom:1.25rem}
        .volume-card:last-child{margin-bottom:0}
        .volume-card-accent{width:8px;flex-shrink:0;background:#003399}
        .volume-card-body{flex:1;padding:1.25rem 1.5rem;min-width:0}
        .volume-title{font-family:'Bangers',cursive;font-size:1.5rem;letter-spacing:2px;color:#1a1a1a;line-height:1.1;margin-bottom:0.5rem;display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap}
        .issue-count{display:inline-block;background:#ffe066;border:2px solid #1a1a1a;padding:0.15rem 0.6rem;font-family:'Oswald',sans-serif;font-size:0.72rem;font-weight:600;letter-spacing:1px;text-transform:uppercase}
        .volume-blurb{font-size:0.88rem;font-weight:400;line-height:1.7;color:#444;margin-bottom:1rem}
        .btn-series{display:inline-block;background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.1rem;letter-spacing:2px;padding:0.3rem 1.25rem 0.4rem;cursor:pointer;text-decoration:none;white-space:nowrap;transition:transform 0.08s,box-shadow 0.08s}
        .btn-series:hover{background:#0044cc}
        .btn-series:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #1a1a1a}
      `}</style>

      <div className="page-wrap">
        <SiteNav />

        <div className="panel-slim">
          <Link href="/collection-guides" className="back-link">← Collection Guides</Link>
        </div>

        <div className="series-header">
          <h1>{groupName}</h1>
          <div className="series-sub">
            {volumes.length} volume{volumes.length !== 1 ? "s" : ""} &middot; eBay Bundle Deals
          </div>
        </div>

        <div className="panel">
          <div className="caption">Select a Volume</div>
          {volumes.map((v) => (
            <div className="volume-card" key={v.slug}>
              <div className="volume-card-accent" />
              <div className="volume-card-body">
                <div className="volume-title">
                  {v.subtitle}
                  {v.issueCount > 0 && (
                    <span className="issue-count">{v.issueCount} issues</span>
                  )}
                </div>
                <div className="volume-blurb">{v.seoBlurb}</div>
                <Link href={`/series/${v.slug}`} className="btn-series">
                  Browse Series &rarr;
                </Link>
              </div>
            </div>
          ))}
        </div>

        <div className="panel" style={{ textAlign: "center", fontSize: "0.8rem", fontWeight: 400, color: "#666", padding: "0.85rem 1.75rem" }}>
          Bugs? Feature requests? Email us at{" "}
          <a href="mailto:hello@comicbundlefinder.com" style={{ color: "#003399", fontWeight: 600 }}>
            hello@comicbundlefinder.com
          </a>
          <div style={{ marginTop: "0.75rem" }}>
            <a
              href="https://ko-fi.com/O4O31ZDFTF"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                background: "#003399", color: "#fffdf4",
                border: "2px solid #1a1a1a", boxShadow: "3px 3px 0 #1a1a1a",
                fontFamily: "'Oswald', sans-serif", fontWeight: 600,
                fontSize: "0.82rem", letterSpacing: "1px", textTransform: "uppercase",
                padding: "0.35rem 1rem", textDecoration: "none",
              }}
            >
              ☕ Support me on Ko-fi
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

export async function getStaticPaths() {
  return {
    paths: Object.keys(SERIES_GROUPS).map((slug) => ({ params: { slug } })),
    fallback: false,
  };
}

export async function getStaticProps({ params }) {
  const { slug } = params;
  const group = SERIES_GROUPS[slug];
  if (!group) return { notFound: true };

  const volumes = group.slugs.map((seriesSlug) => {
    const config = SERIES[seriesSlug];
    if (!config) return null;
    let issueCount = 0;
    try {
      const issues = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "data", config.dataFile), "utf-8")
      );
      issueCount = issues.length;
    } catch {}
    return {
      slug: seriesSlug,
      subtitle: config.subtitle,
      seoBlurb: config.seoBlurb,
      issueCount,
    };
  }).filter(Boolean);

  return {
    props: {
      groupSlug: slug,
      groupName: group.name,
      volumes,
    },
  };
}
