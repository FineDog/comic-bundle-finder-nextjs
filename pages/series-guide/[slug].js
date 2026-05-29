import fs from "fs";
import path from "path";
import Head from "next/head";
import Link from "next/link";
import { SERIES } from "../../lib/series-config";
import SiteNav from "../../components/SiteNav";

// --- Matching helpers (run server-side in getServerSideProps) ---

function getBaseName(name) {
  // Strip trailing "(YYYY)" from series names like "The Amazing Spider-Man (1963)"
  return name.replace(/\s*\(\d{4,}\)\s*$/, "").trim();
}

function getYearFromName(name) {
  const m = /\((\d{4})\)\s*$/.exec(name.trim());
  return m ? parseInt(m[1]) : null;
}

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/^the\s+/, "")        // strip leading "The "
    .replace(/[^a-z0-9\s]/g, " ") // punctuation/hyphens -> space
    .replace(/\s+/g, " ")
    .trim();
}

// Match a Metron series name to one of our local SERIES slugs by display name + year
function findLocalSlug(metronName) {
  const year = getYearFromName(metronName);
  if (!year) return null;
  const baseNorm = normalizeName(getBaseName(metronName));
  for (const [slug, config] of Object.entries(SERIES)) {
    if (config.yearBegan !== year) continue;
    if (normalizeName(config.displayName) === baseNorm) return slug;
  }
  return null;
}

// --- Component ---

export default function SeriesGuidePage({ groupName, groupSlug, volumes }) {
  const title = `${groupName} — Series Guide | Comic Bundle Finder`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta
          name="description"
          content={`Browse all ${groupName} volumes and find eBay bundle deals for every issue.`}
        />
        <meta property="og:title" content={title} />
        <meta property="og:type" content="website" />
        <meta
          property="og:url"
          content={`https://www.comicbundlefinder.com/series-guide/${groupSlug}`}
        />
        <meta property="og:image" content="https://www.comicbundlefinder.com/preview.png" />
        <meta name="robots" content="index, follow" />
        <link
          rel="canonical"
          href={`https://www.comicbundlefinder.com/series-guide/${groupSlug}`}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap"
          rel="stylesheet"
        />
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
        .no-volumes{font-size:0.9rem;color:#666;font-weight:400;padding:0.5rem 0}
      `}</style>

      <div className="page-wrap">
        <SiteNav />

        <div className="panel-slim">
          <Link href="/collection-guides" className="back-link">
            &larr; Collection Guides
          </Link>
        </div>

        <div className="series-header">
          <h1>{groupName}</h1>
          <div className="series-sub">
            {volumes.length} volume{volumes.length !== 1 ? "s" : ""} &middot; eBay Bundle Deals
          </div>
        </div>

        <div className="panel">
          <div className="caption">Select a Volume</div>
          {volumes.length === 0 ? (
            <p className="no-volumes">
              No volumes found for this series. Try searching for a different name.
            </p>
          ) : (
            volumes.map((v) => (
              <div className="volume-card" key={String(v.metronId)}>
                <div className="volume-card-accent" />
                <div className="volume-card-body">
                  <div className="volume-title">
                    {v.subtitle}
                    {v.issueCount > 0 && (
                      <span className="issue-count">{v.issueCount} issues</span>
                    )}
                  </div>
                  {v.seoBlurb && <div className="volume-blurb">{v.seoBlurb}</div>}
                  <Link
                    href={"/series/" + (v.localSlug || "metron-" + v.metronId)}
                    className="btn-series"
                  >
                    Browse Series &rarr;
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>

        <div
          className="panel"
          style={{
            textAlign: "center",
            fontSize: "0.8rem",
            fontWeight: 400,
            color: "#666",
            padding: "0.85rem 1.75rem",
          }}
        >
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
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                background: "#003399",
                color: "#fffdf4",
                border: "2px solid #1a1a1a",
                boxShadow: "3px 3px 0 #1a1a1a",
                fontFamily: "'Oswald', sans-serif",
                fontWeight: 600,
                fontSize: "0.82rem",
                letterSpacing: "1px",
                textTransform: "uppercase",
                padding: "0.35rem 1rem",
                textDecoration: "none",
              }}
            >
              Support me on Ko-fi
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

// --- Server-side data fetching ---

export async function getServerSideProps({ params }) {
  const { slug } = params;

  // Convert slug to a search term: "amazing-spider-man" -> "amazing spider man"
  const searchTerm = slug.replace(/-/g, " ");
  const targetNorm = normalizeName(searchTerm);

  const auth = Buffer.from(
    `${process.env.METRON_USERNAME}:${process.env.METRON_PASSWORD}`
  ).toString("base64");

  let seriesData = [];
  try {
    const res = await fetch(
      `https://metron.cloud/api/series/?name=${encodeURIComponent(searchTerm)}&page_size=100`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    if (res.ok) {
      const data = await res.json();
      // Metron uses "series" field for the title, not "name"
      seriesData = (data.results || []).map((s) => ({ ...s, name: s.series }));
    }
  } catch {
    // Metron unreachable — render empty state
  }

  // Keep only series whose base name exactly matches the target (e.g., only "The Amazing
  // Spider-Man" and not "The Amazing Spider-Man: Brand New Day" or similar spin-offs)
  const matched = seriesData.filter((s) => {
    const baseNorm = normalizeName(getBaseName(s.name));
    return baseNorm === targetNorm;
  });

  // Sort chronologically
  matched.sort((a, b) => {
    const yA = getYearFromName(a.name) || 9999;
    const yB = getYearFromName(b.name) || 9999;
    return yA - yB;
  });

  // Build volume objects
  const volumes = matched.map((s) => {
    const localSlug = findLocalSlug(s.name);
    const localConfig = localSlug ? SERIES[localSlug] : null;

    // Issue count: prefer local data file for configured series, else use Metron's count.
    let issueCount = s.issue_count || 0;
    if (localConfig) {
      try {
        const issues = JSON.parse(
          fs.readFileSync(path.join(process.cwd(), "data", localConfig.dataFile), "utf-8")
        );
        issueCount = issues.length;
      } catch {
        issueCount = s.issue_count || 0;
      }
    }

    // Build subtitle: local config has curated text; dynamic volumes get "Vol. N · YYYY–YYYY".
    const year = getYearFromName(s.name);
    const yearEnd = s.year_end || null;
    const vol = s.volume || null;
    let subtitle;
    if (localConfig) {
      subtitle = localConfig.subtitle;
    } else {
      const yearRange = year
        ? (yearEnd && yearEnd !== year ? year + String.fromCharCode(8211) + yearEnd : String(year))
        : "";
      subtitle = vol ? "Vol. " + vol + (yearRange ? " · " + yearRange : "") : yearRange;
    }

    return {
      metronId: s.id,
      name: s.name,
      subtitle,
      seoBlurb: localConfig ? localConfig.seoBlurb : "",
      localSlug: localSlug || null,
      issueCount,
    };
  });

  // Group name for the header: use first result's base name, or a title-cased fallback
  const groupName =
    matched.length > 0
      ? getBaseName(matched[0].name)
      : slug
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");

  return {
    props: {
      groupSlug: slug,
      groupName,
      volumes,
    },
  };
}
