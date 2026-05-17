import Head from "next/head";
import Link from "next/link";
import { SERIES } from "../lib/series-config";

export default function CollectionGuides() {
  const series = Object.entries(SERIES);

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
        .title-panel{background:#cc1f00;text-align:center;padding:1.25rem 1.75rem 1rem}
        .title-panel h1{font-family:'Bangers',cursive;font-size:clamp(2.5rem,8vw,5rem);color:#fffdf4;letter-spacing:4px;text-shadow:4px 4px 0 #1a1a1a;line-height:1}
        .tagline{color:#ffe066;font-size:0.85rem;letter-spacing:2px;text-transform:uppercase;margin-top:0.4rem;font-weight:400}
        .back-link{display:inline-block;font-size:0.82rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#003399;text-decoration:none;margin-bottom:1.75rem;border-bottom:2px solid #003399;padding-bottom:1px}
        .back-link:hover{color:#cc1f00;border-color:#cc1f00}
        .intro{font-size:0.88rem;font-weight:400;line-height:1.8;color:#333}
        .series-list{display:flex;flex-direction:column;gap:1.25rem}
        .series-card{border:3px solid #1a1a1a;box-shadow:5px 5px 0 #1a1a1a;background:#fffdf4;display:flex;align-items:stretch;overflow:hidden}
        .series-card-accent{width:8px;flex-shrink:0;background:#cc1f00}
        .series-card-body{flex:1;padding:1.25rem 1.5rem;display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap}
        .series-card-text{flex:1;min-width:200px}
        .series-card-name{font-family:'Bangers',cursive;font-size:1.6rem;letter-spacing:2px;color:#1a1a1a;line-height:1.1}
        .series-card-subtitle{font-size:0.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-top:0.2rem;margin-bottom:0.6rem}
        .series-card-blurb{font-size:0.88rem;font-weight:400;line-height:1.7;color:#444}
        .btn-series{display:inline-block;background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.25rem;letter-spacing:2px;padding:0.3rem 1.5rem 0.4rem;cursor:pointer;text-decoration:none;white-space:nowrap;transition:transform 0.08s,box-shadow 0.08s,background 0.08s;flex-shrink:0}
        .btn-series:hover{background:#0044cc}
        .btn-series:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #1a1a1a}
        .caption{display:inline-block;background:#ffe066;border:2px solid #1a1a1a;padding:0.3rem 0.7rem;font-size:0.8rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:1.25rem}
        @media(max-width:500px){.series-card-body{flex-direction:column;align-items:flex-start;gap:1rem}}
      `}</style>
      <div className="container">
        <div className="panel title-panel">
          <h1>Collection Guides</h1>
          <div className="tagline">Browse classic runs &mdash; find eBay bundle deals issue by issue</div>
        </div>

        <Link href="/" className="back-link">← Back to Comic Bundle Finder</Link>

        <div className="panel">
          <div className="caption">What are Collection Guides?</div>
          <p className="intro">
            Already know which series you&rsquo;re collecting? Skip the manual search. Collection Guides let you
            browse a complete classic run issue by issue and pull live eBay bundle deals for any stretch of
            issues you need — no want list required. Pick a series below to get started.
          </p>
        </div>

        <div className="series-list">
          {series.map(([slug, config]) => (
            <div className="series-card" key={slug}>
              <div className="series-card-accent" />
              <div className="series-card-body">
                <div className="series-card-text">
                  <div className="series-card-name">{config.displayName}</div>
                  <div className="series-card-subtitle">{config.subtitle}</div>
                  <div className="series-card-blurb">{config.seoBlurb}</div>
                </div>
                <Link href={`/series/${slug}`} className="btn-series">Browse Series &rarr;</Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
