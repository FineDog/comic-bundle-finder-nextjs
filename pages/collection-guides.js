import fs from "fs";
import path from "path";
import { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { SERIES } from "../lib/series-config";
import SiteNav from "../components/SiteNav";

const GROUPS = [
  { slugs: ["amazing-spider-man-vol-1", "amazing-spider-man-vol-2"] },
  { slugs: ["daredevil-vol-1", "daredevil-vol-2"] },
  { slugs: ["x-men-vol-1"] },
  { slugs: ["uncanny-x-men"] },
];

export default function CollectionGuides({ arcs }) {
  const [query, setQuery] = useState("");

  const matches =
    query.trim().length >= 2
      ? arcs
          .filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))
          .slice(0, 20)
      : [];

  return (
    <>
      <Head>
        <title>Collection Guides — Comic Bundle Finder</title>
        <meta name="description" content="Browse pre-built collection guides for classic comic runs and story arcs. Find eBay bundle deals issue by issue." />
        <meta property="og:title" content="Collection Guides — Comic Bundle Finder" />
        <meta property="og:description" content="Browse pre-built collection guides for classic comic runs and story arcs. Find eBay bundle deals issue by issue." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://www.comicbundlefinder.com/collection-guides" />
        <meta property="og:image" content="https://www.comicbundlefinder.com/preview.png" />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href="https://www.comicbundlefinder.com/collection-guides" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "CollectionPage",
              "name": "Collection Guides — Comic Bundle Finder",
              "description": "Browse pre-built collection guides for classic comic runs and story arcs. Find eBay bundle deals issue by issue.",
              "url": "https://www.comicbundlefinder.com/collection-guides",
              "isPartOf": {
                "@type": "WebSite",
                "name": "Comic Bundle Finder",
                "url": "https://www.comicbundlefinder.com",
              },
            }),
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem}

        .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.75rem}
        .caption{display:inline-block;background:#ffe066;border:2px solid #1a1a1a;padding:0.3rem 0.7rem;font-size:0.8rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:1.25rem}
        .intro{font-size:0.88rem;font-weight:400;line-height:1.8;color:#333}
        .section-title{font-family:'Bangers',cursive;font-size:1.8rem;letter-spacing:2px;color:#cc1f00;margin-bottom:1.25rem}

        /* Arc search */
        .arc-search-wrap{position:relative;margin-bottom:1rem}
        .arc-search-input{width:100%;border:3px solid #1a1a1a;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:1rem;font-weight:400;padding:0.6rem 0.85rem;color:#1a1a1a;box-shadow:3px 3px 0 #1a1a1a}
        .arc-search-input:focus{outline:none;border-color:#003399;box-shadow:3px 3px 0 #003399}
        .arc-search-input::placeholder{color:#aaa;font-weight:400}
        .arc-results{margin-top:0.75rem;display:flex;flex-direction:column;gap:0.5rem}
        .arc-result-card{display:flex;align-items:center;justify-content:space-between;gap:1rem;background:#f8f3e3;border:2px solid #1a1a1a;padding:0.6rem 0.85rem;flex-wrap:wrap}
        .arc-result-name{font-weight:600;font-size:0.95rem;flex:1;min-width:0}
        .arc-result-link{display:inline-block;background:#cc1f00;color:#fffdf4;border:2px solid #1a1a1a;box-shadow:2px 2px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1rem;letter-spacing:1.5px;padding:0.2rem 0.85rem 0.25rem;text-decoration:none;white-space:nowrap;flex-shrink:0;transition:transform 0.08s,box-shadow 0.08s}
        .arc-result-link:hover{background:#a81800}
        .arc-result-link:active{transform:translate(1px,1px);box-shadow:1px 1px 0 #1a1a1a}
        .arc-no-results{font-size:0.88rem;font-weight:400;color:#666;padding:0.5rem 0}
        .arc-hint{font-size:0.78rem;font-weight:400;color:#888;margin-top:0.5rem}
        .arc-coming-soon{font-size:0.88rem;font-weight:400;color:#888;font-style:italic}

        /* Series groups */
        .series-list{display:flex;flex-direction:column;gap:1.25rem;margin-bottom:1.75rem}
        .series-card{border:3px solid #1a1a1a;box-shadow:5px 5px 0 #1a1a1a;background:#fffdf4;display:flex;overflow:hidden}
        .series-card-accent{width:8px;flex-shrink:0;background:#cc1f00}
        .series-card-body{flex:1;padding:1.25rem 1.5rem;min-width:0}
        .series-card-name{font-family:'Bangers',cursive;font-size:1.6rem;letter-spacing:2px;color:#1a1a1a;line-height:1.1;margin-bottom:1rem}
        .volume-row{display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap}
        .volume-row+.volume-row{margin-top:0.85rem;padding-top:0.85rem;border-top:1px dashed #ccc}
        .volume-info{flex:1;min-width:180px}
        .volume-subtitle{font-size:0.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-bottom:0.35rem}
        .volume-blurb{font-size:0.88rem;font-weight:400;line-height:1.7;color:#444}
        .btn-series{display:inline-block;background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.15rem;letter-spacing:2px;padding:0.3rem 1.25rem 0.4rem;cursor:pointer;text-decoration:none;white-space:nowrap;transition:transform 0.08s,box-shadow 0.08s,background 0.08s;flex-shrink:0}
        .btn-series:hover{background:#0044cc}
        .btn-series:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #1a1a1a}
        @media(max-width:540px){.volume-row{flex-direction:column;align-items:flex-start;gap:0.75rem}}
      `}</style>
      <div className="page-wrap">
        <SiteNav />

        <div className="panel">
          <div className="caption">What are Collection Guides?</div>
          <p className="intro">
            Already know which series or story arc you&rsquo;re collecting? Skip the manual search.
            Collection Guides let you pull live eBay bundle deals for any run or arc you need —
            no want list required.
          </p>
        </div>

        {/* Story Arc Search */}
        <div className="panel">
          <div className="section-title">Story Arcs</div>
          <div className="caption">Search by Arc Name</div>
          {arcs.length === 0 ? (
            <p className="arc-coming-soon">
              Arc search index is being built — check back soon.
            </p>
          ) : (
            <>
              <div className="arc-search-wrap">
                <input
                  className="arc-search-input"
                  type="search"
                  placeholder="e.g. Brand New Day, Infinity Gauntlet, Knightfall…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                />
              </div>
              {query.trim().length >= 2 && (
                <div className="arc-results">
                  {matches.length === 0 ? (
                    <p className="arc-no-results">No arcs found for &ldquo;{query.trim()}&rdquo;.</p>
                  ) : (
                    matches.map((arc) => (
                      <div className="arc-result-card" key={arc.id}>
                        <span className="arc-result-name">{arc.name}</span>
                        <Link href={`/arc/${arc.slug}`} className="arc-result-link">
                          Find Bundles &rarr;
                        </Link>
                      </div>
                    ))
                  )}
                </div>
              )}
              {query.trim().length < 2 && (
                <p className="arc-hint">
                  Type at least 2 characters to search {arcs.length.toLocaleString()} story arcs.
                </p>
              )}
            </>
          )}
        </div>

        {/* Series Guides */}
        <div className="panel">
          <div className="section-title">Series Guides</div>
          <div className="caption">Browse by Series</div>
          <div className="series-list">
            {GROUPS.map((group, i) => {
              const configs = group.slugs.map((slug) => ({ slug, config: SERIES[slug] })).filter((e) => e.config);
              const cardName = configs[0]?.config.displayName;
              return (
                <div className="series-card" key={i}>
                  <div className="series-card-accent" />
                  <div className="series-card-body">
                    <div className="series-card-name">{cardName}</div>
                    {configs.map(({ slug, config }) => (
                      <div className="volume-row" key={slug}>
                        <div className="volume-info">
                          <div className="volume-subtitle">{config.subtitle}</div>
                          <div className="volume-blurb">{config.seoBlurb}</div>
                        </div>
                        <Link href={`/series/${slug}`} className="btn-series">Browse Series &rarr;</Link>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
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

export async function getStaticProps() {
  let arcs = [];
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), "public", "data", "arc-index.json"),
      "utf-8"
    );
    arcs = JSON.parse(raw);
  } catch {
    // File doesn't exist yet — first deploy before nightly job has run
  }
  return { props: { arcs }, revalidate: 3600 };
}
