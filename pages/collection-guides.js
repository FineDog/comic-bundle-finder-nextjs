import fs from "fs";
import path from "path";
import { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import { SERIES_GROUPS } from "../lib/series-config";
import SiteNav from "../components/SiteNav";

export default function CollectionGuides({ arcs }) {
  const [query, setQuery] = useState("");
  const [seriesQuery, setSeriesQuery] = useState("");
  const [charQuery, setCharQuery] = useState("");
  const [charSuggestions, setCharSuggestions] = useState([]);
  const [charSuggestLoading, setCharSuggestLoading] = useState(false);
  const [charResults, setCharResults] = useState(null); // { count, results } after submit
  const [charSearching, setCharSearching] = useState(false);
  const [charSubmittedQuery, setCharSubmittedQuery] = useState("");

  // Debounced typeahead — shows up to 8 suggestions while typing
  useEffect(() => {
    if (charQuery.trim().length < 3) {
      setCharSuggestions([]);
      setCharSuggestLoading(false);
      return;
    }
    setCharSuggestLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/characters/search?q=${encodeURIComponent(charQuery.trim())}`);
        const data = await res.json();
        setCharSuggestions(data.results ? data.results.slice(0, 8) : []);
      } catch {
        setCharSuggestions([]);
      } finally {
        setCharSuggestLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [charQuery]);

  async function handleCharSearch(e) {
    e.preventDefault();
    const q = charQuery.trim();
    if (q.length < 3) return;
    setCharSearching(true);
    setCharSuggestions([]);
    setCharSubmittedQuery(q);
    try {
      const res = await fetch(`/api/characters/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setCharResults(data);
    } catch {
      setCharResults({ count: 0, results: [] });
    } finally {
      setCharSearching(false);
    }
  }

  const seriesItems = Object.entries(SERIES_GROUPS).map(([slug, g]) => ({ slug, name: g.name }));
  const seriesMatches =
    seriesQuery.trim().length >= 2
      ? seriesItems.filter((s) => s.name.toLowerCase().includes(seriesQuery.trim().toLowerCase()))
      : [];

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

        @media(max-width:540px){.arc-result-card{flex-direction:column;align-items:flex-start}}
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
          <div className="caption">Search by Series Name</div>
          <div className="arc-search-wrap">
            <input
              className="arc-search-input"
              type="search"
              placeholder="e.g. Spider-Man, Daredevil, X-Men…"
              value={seriesQuery}
              onChange={(e) => setSeriesQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          {seriesQuery.trim().length >= 2 && (
            <div className="arc-results">
              {seriesMatches.length === 0 ? (
                <p className="arc-no-results">No series found for &ldquo;{seriesQuery.trim()}&rdquo;.</p>
              ) : (
                seriesMatches.map((s) => (
                  <div className="arc-result-card" key={s.slug}>
                    <span className="arc-result-name">{s.name}</span>
                    <Link href={`/series-guide/${s.slug}`} className="arc-result-link">
                      View Volumes &rarr;
                    </Link>
                  </div>
                ))
              )}
            </div>
          )}
          {seriesQuery.trim().length < 2 && (
            <p className="arc-hint">
              Type at least 2 characters to search {seriesItems.length} series.
            </p>
          )}
        </div>

        {/* Character Search */}
        <div className="panel">
          <div className="section-title">Characters</div>
          <div className="caption">Search by Character Name</div>
          <form onSubmit={handleCharSearch}>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <div className="arc-search-wrap" style={{ flex: 1, marginBottom: 0 }}>
                <input
                  className="arc-search-input"
                  type="search"
                  placeholder="e.g. Spider-Man, Wolverine, Daredevil…"
                  value={charQuery}
                  onChange={(e) => { setCharQuery(e.target.value); setCharResults(null); setCharSubmittedQuery(""); }}
                  autoComplete="off"
                />
              </div>
              <button type="submit" className="arc-result-link" style={{ flexShrink: 0, border: "2px solid #1a1a1a", cursor: "pointer" }}>
                Search
              </button>
            </div>
          </form>

          {/* Typeahead suggestions — shown while typing, before submit */}
          {charResults === null && (
            <>
              {charSuggestLoading && <p className="arc-hint">Searching Metron…</p>}
              {!charSuggestLoading && charQuery.trim().length >= 3 && charSuggestions.length > 0 && (
                <>
                  <div className="arc-results">
                    {charSuggestions.map((c) => (
                      <div className="arc-result-card" key={c.id}>
                        <span className="arc-result-name">{c.name}</span>
                        <Link href={`/character/${c.id}`} className="arc-result-link">
                          View Character &rarr;
                        </Link>
                      </div>
                    ))}
                  </div>
                  <p className="arc-hint" style={{ marginTop: "0.5rem" }}>
                    Press Enter or click Search to see all results.
                  </p>
                </>
              )}
              {!charSuggestLoading && charQuery.trim().length < 3 && (
                <p className="arc-hint">Type at least 3 characters to search the Metron database live.</p>
              )}
            </>
          )}

          {/* Full results after submit */}
          {charSearching && <p className="arc-hint">Searching Metron…</p>}
          {charResults !== null && !charSearching && (
            <>
              {charResults.results?.length === 0 ? (
                <p className="arc-no-results">No characters found for &ldquo;{charSubmittedQuery}&rdquo;.</p>
              ) : (
                <>
                  <p className="arc-hint" style={{ marginBottom: "0.5rem" }}>
                    {charResults.count > charResults.results.length
                      ? `Showing ${charResults.results.length} of ${charResults.count} results — refine your search to narrow down.`
                      : `${charResults.results.length} result${charResults.results.length !== 1 ? "s" : ""} for “${charSubmittedQuery}”`}
                  </p>
                  <div className="arc-results">
                    {charResults.results.map((c) => (
                      <div className="arc-result-card" key={c.id}>
                        <span className="arc-result-name">{c.name}</span>
                        <Link href={`/character/${c.id}`} className="arc-result-link">
                          View Character &rarr;
                        </Link>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
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
