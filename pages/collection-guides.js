import Head from "next/head";
import Link from "next/link";
import { SERIES } from "../lib/series-config";

// Groups control how series are displayed on this page.
// Multi-slug groups share one card; linkedBelow/linkedAbove renders a
// visual connector between the X-Men and Uncanny X-Men cards.
const GROUPS = [
  {
    slugs: ["amazing-spider-man-vol-1", "amazing-spider-man-vol-2"],
  },
  {
    slugs: ["daredevil-vol-1", "daredevil-vol-2"],
  },
  {
    slugs: ["x-men-vol-1"],
    linkedBelow: true,
  },
  {
    slugs: ["uncanny-x-men"],
    linkedAbove: true,
  },
];

export default function CollectionGuides() {
  return (
    <>
      <Head>
        <title>Collection Guides — Comic Bundle Finder</title>
        <meta name="description" content="Browse pre-built collection guides for classic comic runs. Find eBay bundle deals issue by issue." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem}
        .container{max-width:960px;margin:0 auto}
        .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.75rem}
        .panel-nav{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;padding:0.6rem 1.25rem;margin-bottom:1.75rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem}
        .title-panel{background:#cc1f00;text-align:center;padding:1.25rem 1.75rem 1rem}
        .title-panel h1{font-family:'Bangers',cursive;font-size:clamp(2.5rem,8vw,5rem);color:#fffdf4;letter-spacing:4px;text-shadow:4px 4px 0 #1a1a1a;line-height:1}
        .tagline{color:#ffe066;font-size:0.85rem;letter-spacing:2px;text-transform:uppercase;margin-top:0.4rem;font-weight:400}
        .back-link{font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#003399;text-decoration:none}
        .back-link:hover{text-decoration:underline}
        .intro{font-size:0.88rem;font-weight:400;line-height:1.8;color:#333}
        .caption{display:inline-block;background:#ffe066;border:2px solid #1a1a1a;padding:0.3rem 0.7rem;font-size:0.8rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:1.25rem}

        /* Series groups */
        .series-list{display:flex;flex-direction:column;gap:1.25rem;margin-bottom:1.75rem}
        .series-card{border:3px solid #1a1a1a;box-shadow:5px 5px 0 #1a1a1a;background:#fffdf4;display:flex;overflow:hidden}
        .series-card.linked-below{margin-bottom:0;box-shadow:5px 0 0 #1a1a1a}
        .series-card.linked-above{box-shadow:5px 5px 0 #1a1a1a}
        .series-card-accent{width:8px;flex-shrink:0;background:#cc1f00}
        .series-card-body{flex:1;padding:1.25rem 1.5rem;min-width:0}
        .series-card-name{font-family:'Bangers',cursive;font-size:1.6rem;letter-spacing:2px;color:#1a1a1a;line-height:1.1;margin-bottom:1rem}

        /* Per-volume rows */
        .volume-row{display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap}
        .volume-row+.volume-row{margin-top:0.85rem;padding-top:0.85rem;border-top:1px dashed #ccc}
        .volume-info{flex:1;min-width:180px}
        .volume-subtitle{font-size:0.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-bottom:0.35rem}
        .volume-blurb{font-size:0.88rem;font-weight:400;line-height:1.7;color:#444}

        .btn-series{display:inline-block;background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.15rem;letter-spacing:2px;padding:0.3rem 1.25rem 0.4rem;cursor:pointer;text-decoration:none;white-space:nowrap;transition:transform 0.08s,box-shadow 0.08s,background 0.08s;flex-shrink:0}
        .btn-series:hover{background:#0044cc}
        .btn-series:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #1a1a1a}

        /* Connector between X-Men and Uncanny X-Men */
        .series-connector{display:flex;align-items:center;gap:0.5rem;padding:0.3rem 1.5rem 0.3rem calc(8px + 1.5rem);background:#f0e6c4;border-left:3px solid #1a1a1a;border-right:3px solid #1a1a1a;font-size:0.7rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#888}
        .series-connector::before{content:'';display:block;width:1px;height:12px;background:#aaa}

        @media(max-width:540px){.volume-row{flex-direction:column;align-items:flex-start;gap:0.75rem}}
      `}</style>
      <div className="container">
        <div className="panel title-panel">
          <h1>Collection Guides</h1>
          <div className="tagline">Browse classic runs &mdash; find eBay bundle deals issue by issue</div>
        </div>

        <div className="panel-nav">
          <Link href="/" className="back-link">← Back to Comic Bundle Finder</Link>
        </div>

        <div className="panel">
          <div className="caption">What are Collection Guides?</div>
          <p className="intro">
            Already know which series you&rsquo;re collecting? Skip the manual search. Collection Guides let you
            browse a complete classic run issue by issue and pull live eBay bundle deals for any stretch of
            issues you need — no want list required. Pick a series below to get started.
          </p>
        </div>

        <div className="series-list">
          {GROUPS.map((group, i) => {
            const configs = group.slugs.map((slug) => ({ slug, config: SERIES[slug] })).filter((e) => e.config);
            const cardName = configs[0]?.config.displayName;

            return (
              <div key={i}>
                <div className={`series-card${group.linkedBelow ? " linked-below" : ""}${group.linkedAbove ? " linked-above" : ""}`}>
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
                {group.linkedBelow && (
                  <div className="series-connector">
                    <span>↓ retitled as The Uncanny X-Men</span>
                  </div>
                )}
              </div>
            );
          })}
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
