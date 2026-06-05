import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import SiteNav from "../../components/SiteNav";
import SiteFooter from "../../components/SiteFooter";
import ResultsPanel from "../../components/ResultsPanel";
import { runEbaySearch } from "../../lib/ebay-search";

export default function ArcPage({ slug, arcId, arcName, arcDesc, configError }) {
  // "loading-issues" → "loading-ebay" → "done" | "error" | "not-cached"
  const [status, setStatus] = useState("loading-issues");
  const [issues, setIssues] = useState([]);
  const [rows, setRows] = useState([]);
  const [wave2Loading, setWave2Loading] = useState(false);
  const [userZip, setUserZip] = useState(null);
  const didFire = useRef(false);

  useEffect(() => {
    fetch("/api/geolocate")
      .then(r => r.json())
      .then(({ zip }) => setUserZip(zip || null))
      .catch(() => setUserZip(null));
  }, []);

  useEffect(() => {
    if (didFire.current || !arcId) return;
    didFire.current = true;

    fetch(`/api/arc/${arcId}/issues`)
      .then(r => r.json())
      .then(async data => {
        if (data.error) throw new Error(data.error);
        if (data.issues === null) { setStatus("not-cached"); return; }
        const issueList = data.issues || [];
        setIssues(issueList);
        if (!issueList.length) { setStatus("done"); return; }

        setStatus("loading-ebay");
        await runEbaySearch(issueList, userZip, {
          onWave1(wave1Rows) { setRows(wave1Rows); setStatus("done"); },
          onWave2Start()    { setWave2Loading(true); },
          onWave2(merged)   { setRows(merged); },
          onWave2End()      { setWave2Loading(false); },
        });
      })
      .catch(() => setStatus("error"));
  }, [arcId]); // eslint-disable-line react-hooks/exhaustive-deps

  const metaDesc = `Find eBay bundle deals for the ${arcName} story arc. Sellers ranked by how many issues they carry — save on combined shipping.`;
  const pageUrl = `https://www.comicbundlefinder.com/arc/${slug || ""}`;

  return (
    <>
      <Head>
        <title>{arcName} — Story Arc Bundle Deals — Comic Bundle Finder</title>
        <meta name="description" content={metaDesc} />
        <meta property="og:title" content={`${arcName} — Story Arc Bundle Deals`} />
        <meta property="og:description" content={metaDesc} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:image" content="https://www.comicbundlefinder.com/preview.png" />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={pageUrl} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </Head>
      <style>{`
        .arc-title{font-family:'Bangers',cursive;font-size:clamp(2rem,6vw,3.5rem);letter-spacing:3px;color:#1a1a1a;line-height:1;margin-bottom:0.4rem}
        .arc-sub{font-size:0.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-bottom:0.6rem}
        .arc-desc{font-size:1rem;font-weight:400;line-height:1.7;color:#444}
        .issue-grid{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:0.35rem;margin-top:0.25rem}
        .issue-item{background:#f8f3e3;border:1px solid #d4c9a8;padding:0.3rem 0.6rem;font-size:0.82rem;font-weight:400}
      `}</style>

      <div className="page-wrap">
        <SiteNav />

        <div className="panel-slim">
          <a href="/collection-guides" className="breadcrumb-link">&larr; Collection Guides</a>
        </div>

        {configError && (
          <div className="panel" style={{ background: "#fff0f0", borderColor: "#cc1f00", color: "#cc1f00", fontWeight: 600, fontSize: "0.9rem" }}>
            Configuration error: {configError}
          </div>
        )}

        <div className="panel-accent">
          <div className="panel-accent-stripe" />
          <div className="panel-accent-body">
            <h1 className="arc-title">{arcName}</h1>
            <div className="arc-sub">{issues.length > 0 ? issues.length : "…"} issues &middot; Story Arc &middot; eBay Bundle Deals</div>
            {arcDesc && <p className="arc-desc">{arcDesc}</p>}
          </div>
        </div>

        <div className="panel">
          <div className="caption">Issues in this arc</div>
          <ul className="issue-grid">
            {issues.map(issue => (
              <li className="issue-item" key={issue}>{issue}</li>
            ))}
          </ul>
        </div>

        <div className="panel">
          {status === "loading-issues" && (
            <div className="loading-state">
              <div><span className="loading-dots">Loading issues</span></div>
              <div className="loading-sub">Fetching arc issue list…</div>
            </div>
          )}
          {status === "not-cached" && (
            <div className="no-results" style={{ padding: "2rem" }}>
              <strong>Issues not yet indexed.</strong><br />
              This arc&rsquo;s issue list is populated by a nightly job. Check back after the next update (daily at 6:30 AM UTC).
            </div>
          )}
          {status === "loading-ebay" && (
            <div className="loading-state">
              <div><span className="loading-dots">Searching eBay</span></div>
              <div className="loading-sub">Checking all {issues.length} issues for bundle deals…</div>
            </div>
          )}
          {status === "error" && (
            <div className="error-state">Search failed. Please try refreshing the page.</div>
          )}
          {status === "done" && (
            <ResultsPanel
              rows={rows}
              issues={issues}
              wave2Loading={wave2Loading}
              defaultMaxPrice="15"
            />
          )}
        </div>

        <SiteFooter />
      </div>
    </>
  );
}

export async function getStaticPaths() {
  return { paths: [], fallback: "blocking" };
}

export async function getStaticProps({ params }) {
  const { slug } = params;

  const idMatch = slug.match(/^(\d+)/);
  if (!idMatch) return { notFound: true };
  const arcId = parseInt(idMatch[1], 10);

  if (!process.env.METRON_USERNAME || !process.env.METRON_PASSWORD) {
    return { props: { slug, arcId, arcName: "Arc Unavailable", arcDesc: "", configError: "METRON credentials not configured." }, revalidate: 60 };
  }

  const auth = Buffer.from(`${process.env.METRON_USERNAME}:${process.env.METRON_PASSWORD}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json", "User-Agent": "ComicBundleFinder/1.0" };

  let arcRes;
  try {
    arcRes = await fetch(`https://metron.cloud/api/arc/${arcId}/`, { headers });
  } catch (e) {
    return { props: { slug, arcId, arcName: "Arc Unavailable", arcDesc: "", configError: `Network error: ${e.message}` }, revalidate: 60 };
  }
  if (!arcRes.ok) {
    if (arcRes.status === 404) return { notFound: true };
    return { props: { slug, arcId, arcName: "Arc Unavailable", arcDesc: "", configError: `Metron returned ${arcRes.status}` }, revalidate: 60 };
  }
  const arc = await arcRes.json();

  return {
    props: { slug, arcId, arcName: arc.name, arcDesc: arc.desc || "" },
    revalidate: 86400,
  };
}
