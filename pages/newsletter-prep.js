import { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";

// ── Shared styles ─────────────────────────────────────────────────────────────

const TH = {
  padding: "6px 10px",
  textAlign: "center",
  fontFamily: "Oswald, sans-serif",
  fontSize: "13px",
  fontWeight: "bold",
};
const TD = {
  padding: "6px 10px",
  borderBottom: "1px solid #e0d8c0",
  verticalAlign: "middle",
};

function btn(bg, color = "#fff") {
  return {
    background: bg,
    color,
    border: "2px solid #1a1a1a",
    padding: "6px 14px",
    cursor: "pointer",
    fontFamily: "Oswald, sans-serif",
    fontSize: "13px",
    fontWeight: "bold",
    boxShadow: "3px 3px 0 #1a1a1a",
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Loading() {
  return (
    <div style={{ padding: "32px", textAlign: "center", fontFamily: "Oswald, sans-serif", color: "#666" }}>
      Loading…
    </div>
  );
}

function Err({ msg }) {
  return (
    <div style={{ color: "#cc1f00", fontFamily: "Oswald, sans-serif", padding: "16px" }}>
      Error: {msg}
    </div>
  );
}

// ── New Releases tab ──────────────────────────────────────────────────────────

function ReleasesTab({ selected, onToggle }) {
  const today = new Date().toISOString().slice(0, 10);
  const [dateInput, setDateInput] = useState(today);
  const [releases, setReleases] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function load(date) {
    setLoading(true);
    setError(null);
    fetch(`/api/newsletter/releases?date=${date}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setReleases(data.releases);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }

  useEffect(() => {
    load(today);
  }, []);

  return (
    <div>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "14px", flexWrap: "wrap" }}>
        <input
          type="date"
          value={dateInput}
          onChange={(e) => setDateInput(e.target.value)}
          style={{ fontFamily: "Oswald, sans-serif", padding: "5px 8px", border: "2px solid #1a1a1a", background: "#fff", fontSize: "13px" }}
        />
        <button onClick={() => load(dateInput)} style={btn("#cc1f00")}>
          Load Week
        </button>
        {releases && (
          <>
            <button
              onClick={() => releases.slice(0, 10).forEach((r) => { if (!selected.has(r.name)) onToggle(r.name); })}
              style={btn("#1a1a1a")}
            >
              Select Top 10
            </button>
            <button
              onClick={() => releases.forEach((r) => { if (!selected.has(r.name)) onToggle(r.name); })}
              style={btn("#1a1a1a")}
            >
              Select All
            </button>
          </>
        )}
        {releases && (
          <span style={{ fontFamily: "Oswald, sans-serif", fontSize: "13px", color: "#666" }}>
            {releases.length} releases
          </span>
        )}
      </div>

      {loading && <Loading />}
      {error && <Err msg={error} />}
      {releases && !loading && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Oswald, sans-serif", fontSize: "14px" }}>
            <thead>
              <tr style={{ background: "#1a1a1a", color: "#ffe066" }}>
                <th style={TH}>✓</th>
                <th style={TH}>Cover</th>
                <th style={{ ...TH, textAlign: "left", width: "35%" }}>Title</th>
                <th style={TH}>Publisher</th>
                <th style={TH}>Pulls</th>
                <th style={TH}>Rating</th>
                <th style={TH}>Price</th>
                <th style={TH}>POTW</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((r, i) => {
                const isSelected = selected.has(r.name);
                return (
                  <tr
                    key={r.url || i}
                    onClick={() => onToggle(r.name)}
                    style={{
                      background: isSelected ? "#fff9d0" : i % 2 === 0 ? "#fffdf4" : "#f5f0e4",
                      cursor: "pointer",
                    }}
                  >
                    <td style={{ ...TD, textAlign: "center" }}>
                      <input type="checkbox" checked={isSelected} readOnly style={{ cursor: "pointer" }} />
                    </td>
                    <td style={TD}>
                      {r.cover && (
                        <img src={r.cover} alt="" style={{ width: "36px", height: "54px", objectFit: "cover", display: "block" }} />
                      )}
                    </td>
                    <td style={TD}>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#1a1a1a", fontWeight: "bold", display: "block" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.name}
                      </a>
                      {r.description && (
                        <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>
                          {r.description.slice(0, 90)}{r.description.length > 90 ? "…" : ""}
                        </div>
                      )}
                    </td>
                    <td style={{ ...TD, textAlign: "center", fontSize: "12px" }}>
                      {r.publisher?.replace(/ Comics$/, "")}
                    </td>
                    <td style={{ ...TD, textAlign: "center", fontWeight: "bold", color: r.pulls > 400 ? "#cc1f00" : "#1a1a1a" }}>
                      {r.pulls != null ? r.pulls.toLocaleString() : "–"}
                    </td>
                    <td style={{ ...TD, textAlign: "center" }}>
                      {r.rating != null ? `★${r.rating.toFixed(1)}` : "–"}
                    </td>
                    <td style={{ ...TD, textAlign: "center" }}>{r.price || "–"}</td>
                    <td style={{ ...TD, textAlign: "center" }}>{r.potw ? "🏆" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Reddit tab ────────────────────────────────────────────────────────────────

function RedditTab() {
  const [posts, setPosts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/newsletter/reddit")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setPosts(data.posts);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <Loading />;
  if (error) return <Err msg={error} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <p style={{ fontFamily: "Oswald, sans-serif", fontSize: "13px", color: "#666", marginBottom: "8px" }}>
        Top posts from r/comicbooks, r/Marvel, r/DCcomics this week.
      </p>
      {posts?.map((p) => (
        <div
          key={p.id}
          style={{ padding: "10px 14px", border: "1px solid #c8bfa0", background: "#fffdf4" }}
        >
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px", flexWrap: "wrap" }}>
            <span style={{ background: "#ffe066", border: "1px solid #1a1a1a", padding: "1px 6px", fontSize: "11px", fontFamily: "Oswald, sans-serif" }}>
              {p.subreddit}
            </span>
            {p.updated && (
              <span style={{ fontSize: "11px", color: "#888", fontFamily: "Oswald, sans-serif" }}>
                {new Date(p.updated).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            )}
          </div>
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            style={{ fontFamily: "Oswald, sans-serif", fontWeight: "bold", color: "#1a1a1a", fontSize: "14px" }}
          >
            {p.title}
          </a>
        </div>
      ))}
    </div>
  );
}

// ── News tab ──────────────────────────────────────────────────────────────────

function NewsTab() {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/newsletter/rss")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setItems(data.items);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <Loading />;
  if (error) return <Err msg={error} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {items?.map((item, i) => (
        <div key={i} style={{ padding: "10px 14px", border: "1px solid #c8bfa0", background: "#fffdf4" }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}>
            <span
              style={{
                background: item.source === "CBR" ? "#cc1f00" : "#1a1a1a",
                color: "#fff",
                padding: "1px 6px",
                fontSize: "11px",
                fontFamily: "Oswald, sans-serif",
              }}
            >
              {item.source}
            </span>
            {item.pubDate && (
              <span style={{ fontSize: "11px", color: "#666", fontFamily: "Oswald, sans-serif" }}>
                {new Date(item.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            )}
          </div>
          <a
            href={item.link}
            target="_blank"
            rel="noreferrer"
            style={{ fontFamily: "Oswald, sans-serif", fontWeight: "bold", color: "#1a1a1a", fontSize: "14px" }}
          >
            {item.title}
          </a>
          {item.description && (
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#666", fontFamily: "Oswald, sans-serif" }}>
              {item.description}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Metron New Releases tab ───────────────────────────────────────────────────

function MetronReleasesTab({ selected, onToggle }) {
  const nextWed = (() => {
    const d = new Date();
    const day = d.getDay();
    const diff = (3 - day + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  })();

  const [weekInput, setWeekInput] = useState(nextWed);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function load(week) {
    setLoading(true);
    setError(null);
    fetch(`/api/newsletter/metron-releases?week=${week}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }

  useEffect(() => { load(nextWed); }, []);

  return (
    <div>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "14px", flexWrap: "wrap" }}>
        <label style={{ fontFamily: "Oswald, sans-serif", fontSize: "13px" }}>Week of</label>
        <input
          type="date"
          value={weekInput}
          onChange={(e) => setWeekInput(e.target.value)}
          style={{ fontFamily: "Oswald, sans-serif", padding: "5px 8px", border: "2px solid #1a1a1a", background: "#fff", fontSize: "13px" }}
        />
        <button onClick={() => load(weekInput)} style={btn("#cc1f00")}>Load</button>
        {data && (
          <>
            <button
              onClick={() => data.issues.forEach((r) => { if (!selected.has(r.name)) onToggle(r.name); })}
              style={btn("#1a1a1a")}
            >
              Select All
            </button>
            <span style={{ fontFamily: "Oswald, sans-serif", fontSize: "13px", color: "#666" }}>
              {data.total} issues
            </span>
          </>
        )}
      </div>
      {loading && <Loading />}
      {error && <Err msg={error} />}
      {data && !loading && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Oswald, sans-serif", fontSize: "14px" }}>
            <thead>
              <tr style={{ background: "#1a1a1a", color: "#ffe066" }}>
                <th style={TH}>✓</th>
                <th style={TH}>Cover</th>
                <th style={{ ...TH, textAlign: "left", width: "30%" }}>Series</th>
                <th style={TH}>#</th>
                <th style={TH}>Publisher</th>
                <th style={TH}>Store Date</th>
                <th style={TH}>Price</th>
              </tr>
            </thead>
            <tbody>
              {data.issues.map((r, i) => {
                const isSelected = selected.has(r.name);
                return (
                  <tr
                    key={r.id}
                    onClick={() => onToggle(r.name)}
                    style={{
                      background: isSelected ? "#fff9d0" : i % 2 === 0 ? "#fffdf4" : "#f5f0e4",
                      cursor: "pointer",
                    }}
                  >
                    <td style={{ ...TD, textAlign: "center" }}>
                      <input type="checkbox" checked={isSelected} readOnly style={{ cursor: "pointer" }} />
                    </td>
                    <td style={TD}>
                      {r.image && (
                        <img src={r.image} alt="" style={{ width: "36px", height: "54px", objectFit: "cover", display: "block" }} />
                      )}
                    </td>
                    <td style={TD}>
                      <span style={{ fontWeight: "bold" }}>{r.series}</span>
                      {r.desc && (
                        <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>
                          {r.desc.slice(0, 90)}{r.desc.length > 90 ? "…" : ""}
                        </div>
                      )}
                    </td>
                    <td style={{ ...TD, textAlign: "center", fontWeight: "bold" }}>{r.number}</td>
                    <td style={{ ...TD, textAlign: "center", fontSize: "12px" }}>{r.publisher}</td>
                    <td style={{ ...TD, textAlign: "center", fontSize: "12px" }}>{r.storeDate}</td>
                    <td style={{ ...TD, textAlign: "center" }}>{r.price ? `$${r.price}` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Bleeding Cool Bestsellers tab ─────────────────────────────────────────────

function BestsellersTab({ selected, onToggle }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/newsletter/bestsellers")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <Loading />;
  if (error) return (
    <div style={{ fontFamily: "Oswald, sans-serif", padding: "16px" }}>
      <Err msg={error} />
      <a href="https://bleedingcool.com/tag/bestseller-list/" target="_blank" rel="noreferrer" style={{ color: "#cc1f00" }}>
        View Bleeding Cool directly →
      </a>
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: "12px", fontFamily: "Oswald, sans-serif", fontSize: "13px", color: "#666" }}>
        Source:{" "}
        <a href={data.articleUrl} target="_blank" rel="noreferrer" style={{ color: "#cc1f00" }}>
          {data.title || "Bleeding Cool Bestseller List"}
        </a>
        {data.pubDate && (
          <span style={{ marginLeft: "10px" }}>
            {new Date(data.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        )}
        {data.warning && (
          <span style={{ marginLeft: "10px", color: "#cc1f00" }}>{data.warning}</span>
        )}
      </div>
      {data.items.length === 0 ? (
        <Err msg="No list items parsed — open the article directly." />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Oswald, sans-serif", fontSize: "14px" }}>
            <thead>
              <tr style={{ background: "#1a1a1a", color: "#ffe066" }}>
                <th style={TH}>✓</th>
                <th style={TH}>Rank</th>
                <th style={{ ...TH, textAlign: "left" }}>Title</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => {
                const isSelected = selected.has(item);
                return (
                  <tr
                    key={i}
                    onClick={() => onToggle(item)}
                    style={{
                      background: isSelected ? "#fff9d0" : i % 2 === 0 ? "#fffdf4" : "#f5f0e4",
                      cursor: "pointer",
                    }}
                  >
                    <td style={{ ...TD, textAlign: "center" }}>
                      <input type="checkbox" checked={isSelected} readOnly style={{ cursor: "pointer" }} />
                    </td>
                    <td style={{ ...TD, textAlign: "center", fontWeight: "bold", color: i < 3 ? "#cc1f00" : "#1a1a1a" }}>
                      {i + 1}
                    </td>
                    <td style={TD}>{item}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: "releases", label: "Most Anticipated" },
  { id: "metron", label: "New Releases" },
  { id: "bestsellers", label: "Best Selling" },
  { id: "reddit", label: "Reddit Buzz" },
  { id: "news", label: "News Feed" },
];

export default function NewsletterPrep() {
  const [activeTab, setActiveTab] = useState("releases");
  const [selected, setSelected] = useState(new Set());

  function toggleItem(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function handleSearch() {
    const issues = [...selected];
    if (!issues.length) return;
    localStorage.setItem("newsletter_search_prefill", JSON.stringify(issues));
    window.open("/?prefill=newsletter", "_blank");
  }

  return (
    <>
      <Head>
        <title>Newsletter Prep — Comic Bundle Finder</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div
        style={{
          minHeight: "100vh",
          background: "#f0e6c4",
          backgroundImage: "radial-gradient(circle, #c4b49a 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        {/* ── Header ── */}
        <header
          style={{
            background: "#cc1f00",
            borderBottom: "4px solid #1a1a1a",
            padding: "12px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1
              style={{
                fontFamily: "Bangers, cursive",
                fontSize: "28px",
                color: "#ffe066",
                letterSpacing: "2px",
                margin: 0,
                textShadow: "2px 2px 0 #1a1a1a",
              }}
            >
              Newsletter Prep
            </h1>
            <div style={{ fontFamily: "Oswald, sans-serif", fontSize: "12px", marginTop: "2px" }}>
              <Link href="/" style={{ color: "#ffcccc" }}>
                ← Comic Bundle Finder
              </Link>
              <span style={{ color: "#ffaaaa", marginLeft: "12px" }}>
                · Run locally with <code style={{ background: "rgba(0,0,0,0.3)", padding: "1px 5px" }}>npm run dev</code>
              </span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                style={{ ...btn("transparent", "#ffcccc"), border: "2px solid #ffcccc", boxShadow: "none" }}
              >
                Clear ({selected.size})
              </button>
            )}
            <button
              onClick={handleSearch}
              disabled={selected.size === 0}
              style={{
                ...btn("#ffe066", "#1a1a1a"),
                fontSize: "15px",
                padding: "8px 20px",
                opacity: selected.size === 0 ? 0.5 : 1,
              }}
            >
              🔍 Search Bundles{selected.size > 0 ? ` (${selected.size})` : ""}
            </button>
          </div>
        </header>

        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "20px" }}>
          {/* ── Selected strip ── */}
          {selected.size > 0 && (
            <div
              style={{
                background: "#fff9d0",
                border: "2px solid #1a1a1a",
                padding: "10px 14px",
                marginBottom: "16px",
                fontFamily: "Oswald, sans-serif",
                fontSize: "13px",
                lineHeight: "1.8",
              }}
            >
              <strong>Selected ({selected.size}):</strong>{" "}
              {[...selected].map((name, i) => (
                <span key={name} style={{ marginRight: "6px" }}>
                  {name}
                  <button
                    onClick={() => toggleItem(name)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#cc1f00", fontWeight: "bold", padding: "0 2px" }}
                  >
                    ×
                  </button>
                  {i < selected.size - 1 ? "," : ""}
                </span>
              ))}
            </div>
          )}

          {/* ── Tab bar ── */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "0", borderBottom: "3px solid #1a1a1a" }}>
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    fontFamily: "Bangers, cursive",
                    fontSize: "18px",
                    letterSpacing: "1px",
                    padding: "8px 20px",
                    border: "3px solid #1a1a1a",
                    borderBottom: active ? "3px solid #fffdf4" : "3px solid #1a1a1a",
                    background: active ? "#fffdf4" : "#f0e6c4",
                    color: active ? "#cc1f00" : "#1a1a1a",
                    cursor: "pointer",
                    position: "relative",
                    bottom: active ? "-3px" : "0",
                    zIndex: active ? 1 : 0,
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* ── Tab panel ── */}
          <div
            style={{
              background: "#fffdf4",
              border: "3px solid #1a1a1a",
              borderTop: "none",
              boxShadow: "6px 6px 0 #1a1a1a",
              padding: "20px",
              marginBottom: "20px",
            }}
          >
            {activeTab === "releases" && <ReleasesTab selected={selected} onToggle={toggleItem} />}
            {activeTab === "metron" && <MetronReleasesTab selected={selected} onToggle={toggleItem} />}
            {activeTab === "bestsellers" && <BestsellersTab selected={selected} onToggle={toggleItem} />}
            {activeTab === "reddit" && <RedditTab />}
            {activeTab === "news" && <NewsTab />}
          </div>
        </div>
      </div>
    </>
  );
}
