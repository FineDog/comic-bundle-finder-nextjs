import { useState, useRef, useEffect } from "react";
import Head from "next/head";
import * as XLSX from "xlsx";
import SiteNav from "../components/SiteNav";
import SiteFooter from "../components/SiteFooter";
import { runEbaySearch } from "../lib/ebay-search";
import { parseCSVLine, yearFromDateString, cleanSeriesName, parseIssueNum } from "../lib/parse-utils";
import { useSession, signIn } from "next-auth/react";
import { PremiumGate, PremiumLock } from "../components/PremiumGate.js";
import { canAccess } from "../lib/features.js";

const STAGES = [
  { pct: 5,  msg: "Waking up the server…" },
  { pct: 12, msg: "Connecting to eBay…" },
  { pct: 22, msg: "Authenticating…" },
  { pct: 35, msg: "Searching eBay listings…" },
  { pct: 50, msg: "Checking seller inventories…" },
  { pct: 63, msg: "Filtering listings…" },
  { pct: 74, msg: "Verifying issue numbers…" },
  { pct: 83, msg: "Tallying bundle opportunities…" },
  { pct: 90, msg: "Sorting by seller…" },
  { pct: 94, msg: "Almost there…" },
];

// Estimated USPS Media Mail shipping range (Zone 1 → Zone 8) shown when
// geolocation is unavailable and the listing uses calculated shipping.
const SHIPPING_FALLBACK = "~$4–$6";

function esc(s) { return String(s || ""); }

// ── Search parsers ────────────────────────────────────────────────────────────

async function parseComicGeeksXLSX(file) {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  if (!rows.length) return { issues: [], format: "unknown" };
  const isCG = "Full Title" in rows[0] && "In Wish List" in rows[0];
  if (!isCG) return { issues: rows.map(r => String(Object.values(r)[0]||"").trim()).filter(Boolean), format: "plain" };
  const wl = rows.filter(r => Number(r["In Wish List"]) >= 1);
  const issues = wl.map(r => {
    const t = String(r["Full Title"]||"").trim();
    const y = yearFromDateString(String(r["Release Date"]||""));
    return y ? `${t} (${y})` : t;
  }).filter(Boolean);
  return { issues, format: "comicgeeks", count: wl.length };
}

async function parseCLZCSV(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { issues: [], format: "unknown" };
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  const si = headers.indexOf("series"), ii = headers.indexOf("issue"), di = headers.indexOf("release date");
  if (si===-1||ii===-1) return { issues: lines.slice(1).filter(Boolean), format: "plain" };
  const issues = [];
  for (let i=1;i<lines.length;i++) {
    const c=parseCSVLine(lines[i]); const s=c[si]?.trim()||"";
    const n=c[ii]?.trim()||"";
    const y=di>=0?yearFromDateString(c[di]?.trim()||""):"";
    const num = parseIssueNum(n);
    if (s && num !== null) issues.push(`${cleanSeriesName(s)} #${num}${y?` (${y})`:""}`)
  }
  return { issues, format: "clz", count: issues.length };
}

async function parsePlainText(file) {
  const text = await file.text();
  return { issues: text.split(/\r?\n/).map(l => l.trim()).filter(Boolean), format: "plain" };
}

async function parseFile(file) {
  const n = file.name.toLowerCase();
  if (n.endsWith(".xlsx")||n.endsWith(".xls")) return parseComicGeeksXLSX(file);
  if (n.endsWith(".csv")) return parseCLZCSV(file);
  return parsePlainText(file);
}

function formatLabel(r) {
  if (r.format==="comicgeeks") return `Loaded ${r.count} wish list item${r.count===1?"":"s"} from League of Comic Geeks export.`;
  if (r.format==="clz") return `Loaded ${r.count} item${r.count===1?"":"s"} from CLZ export.`;
  return `Loaded ${r.issues.length} issue${r.issues.length===1?"":"s"} from file.`;
}

// ── Result processing ─────────────────────────────────────────────────────────

// Apply filters and sort to raw rows. Returns sorted array of [sellerName, sellerData].
function getFilteredSellers(rows, issueCount, filters, sortBy) {
  // 1. Row-level price filter
  const minP = parseFloat(filters.minPrice);
  const maxP = parseFloat(filters.maxPrice);
  let filtered = rows;
  if (!isNaN(minP) && minP > 0) filtered = filtered.filter(r => parseFloat(r.price) >= minP);
  if (!isNaN(maxP) && maxP > 0) filtered = filtered.filter(r => parseFloat(r.price) <= maxP);

  // 2. Row-level shipping filter
  if (filters.shipping === "required") {
    filtered = filtered.filter(r => r.shipping === "0.00");
  } else if (filters.shipping === "excluded") {
    filtered = filtered.filter(r => r.shipping !== "0.00");
  }

  // 3. Group by seller
  const sellerMap = {};
  for (const r of filtered) {
    if (!sellerMap[r.seller]) sellerMap[r.seller] = { listings: [] };
    sellerMap[r.seller].listings.push(r);
  }

  // 4. Compute per-seller metrics
  for (const data of Object.values(sellerMap)) {
    const uniqueIssues = new Set(data.listings.map(l => l.issue));
    data.bundle_count = issueCount === 1 ? data.listings.length : uniqueIssues.size;

    // Cheapest listing per unique issue
    const cheapestPerIssue = {};
    for (const l of data.listings) {
      const p = parseFloat(l.price) || 0;
      if (!(l.issue in cheapestPerIssue) || p < parseFloat(cheapestPerIssue[l.issue].price)) {
        cheapestPerIssue[l.issue] = l;
      }
    }

    // Shipping metrics across cheapest-per-issue listings
    let totalIndividualShipping = 0;
    let maxShipping = 0;
    let hasUnknownShipping = false;
    for (const l of Object.values(cheapestPerIssue)) {
      const ship = parseFloat(l.shipping);
      if (!isFinite(ship) || l.shipping === "unknown") {
        hasUnknownShipping = true;
      } else {
        totalIndividualShipping += ship;
        if (ship > maxShipping) maxShipping = ship;
      }
    }

    const sumCheapest = Object.values(cheapestPerIssue).reduce((a, l) => a + (parseFloat(l.price) || 0), 0);
    const numUnique = Object.keys(cheapestPerIssue).length;

    data.cheapestPerIssue = cheapestPerIssue;
    data.maxShipping = maxShipping;
    data.hasUnknownShipping = hasUnknownShipping;
    // Sum of cheapest prices (not including shipping)
    data.subtotal = sumCheapest;
    // Est. total = cheapest prices + one shipping charge
    data.estTotal = sumCheapest + maxShipping;
    data.estPerIssue = numUnique > 0 ? data.estTotal / numUnique : 0;
    // How much you'd save vs buying each item separately from this seller
    data.shippingSavings = hasUnknownShipping ? null : Math.max(0, totalIndividualShipping - maxShipping);
  }

  // 5. Seller-level filters
  const minBundle = Math.max(2, parseInt(filters.minBundle) || 2);
  const entries = Object.entries(sellerMap).filter(([, data]) => {
    if (data.bundle_count < minBundle) return false;
    if (filters.requiredIssues.length > 0) {
      const sellerIssueSet = new Set(data.listings.map(l => l.issue));
      if (!filters.requiredIssues.every(ri => sellerIssueSet.has(ri))) return false;
    }
    return true;
  });

  // 6. Sort
  entries.sort(([, a], [, b]) => {
    if (sortBy === "est_price_per_issue") return a.estPerIssue - b.estPerIssue;
    if (sortBy === "est_shipping") return a.maxShipping - b.maxShipping;
    return b.bundle_count - a.bundle_count;
  });

  return entries;
}

// ── Analytics ─────────────────────────────────────────────────────────────────

function track(event, data) {
  try { window?.umami?.track(event, data); } catch {}
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Preview() {
  const { data: session } = useSession();
  const userPlan = session?.user?.plan ?? 'free';
  const canUpload       = canAccess(userPlan, 'file-upload');
  const canSaveResults  = canAccess(userPlan, 'save-results');
  const canEmailResults = canAccess(userPlan, 'email-results');


  // Search tab state
  const [issueInput, setIssueInput] = useState("");
  const [status, setStatus] = useState({ msg: "", type: "" });
  const [progress, setProgress] = useState({ visible: false, pct: 0, msg: "" });
  const [results, setResults] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [wave2Loading, setWave2Loading] = useState(false);
  const [userZip, setUserZip] = useState(null);
  const [userCountry, setUserCountry] = useState(null);

  // Filter + sort state
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    minPrice: "",
    maxPrice: "",
    shipping: "included", // "included" | "required" | "excluded"
    minBundle: 2,
    requiredIssues: [],
  });
  const [sortBy, setSortBy] = useState("bundle_size"); // "bundle_size" | "est_price_per_issue" | "est_shipping"

  const timerRef = useRef(null);
  const fileInputRef = useRef(null);
  const searchSource = useRef(null);

  // Save / email state
  const [savedId, setSavedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [shareMsg, setShareMsg] = useState("");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [emailing, setEmailing] = useState(false);

  // Geolocate on mount for shipping estimates.
  // US visitors get zip (accurate domestic rates); non-US get country code only
  // (enough for eBay to return zone-based international estimates).
  useEffect(() => {
    fetch("/api/geolocate")
      .then(r => r.json())
      .then(({ zip, country }) => { setUserZip(zip || null); setUserCountry(country || null); })
      .catch(() => { setUserZip(null); setUserCountry(null); });
  }, []);

  // Pre-fill search from LOCG wishlist (account page → ?wishlist=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wishlist = params.get("wishlist");
    if (!wishlist) return;
    const items = wishlist.split("\n").map(s => s.trim()).filter(Boolean);
    if (!items.length) return;
    setIssueInput(items.join("\n"));
    setUploadMsg(`${items.length} wish list item${items.length === 1 ? "" : "s"} from League of Comic Geeks.`);
    // Clean the URL so it doesn't re-trigger on refresh
    window.history.replaceState({}, "", "/");
  }, []);

  // Pre-fill search from Gap Analyzer
  useEffect(() => {
    const pending = sessionStorage.getItem("gap_search");
    if (!pending) return;
    sessionStorage.removeItem("gap_search");
    try {
      const gapList = JSON.parse(pending);
      if (!Array.isArray(gapList) || !gapList.length) return;
      setIssueInput(gapList.join("\n"));
      setUploadMsg(`${gapList.length} gap issue${gapList.length === 1 ? "" : "s"} from Gap Analyzer.`);
      executeSearch(gapList);
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived state ──────────────────────────────────────────────────────

  const singleIssueMode = results?.issueCount === 1;
  const sellerEntries = results
    ? getFilteredSellers(results.rows, results.issueCount, filters, sortBy)
    : [];
  const sellerCount = sellerEntries.length;
  const totalSellers = results ? new Set(results.rows.map(r => r.seller)).size : 0;

  // ── Search tab handlers ────────────────────────────────────────────────

  async function handleFile(file) {
    setUploadMsg("Reading file…");
    try {
      const result = await parseFile(file);
      if (!result.issues.length) { setUploadMsg("No issues found in that file."); return; }
      searchSource.current = result.format === "plain" ? "txt" : result.format;
      setIssueInput(result.issues.join("\n")); setUploadMsg(formatLabel(result));
    } catch { setUploadMsg("Could not read that file. Make sure it is a valid xlsx, csv, or txt."); }
  }
  function onFileSelected(e) { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }
  function onDragOver(e) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave(e) { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false); }
  function onDrop(e) { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }

  function startProgress() {
    setProgress({ visible: true, pct: 0, msg: STAGES[0].msg }); let i = 0;
    timerRef.current = setInterval(() => { i++; if (i < STAGES.length) setProgress({ visible: true, pct: STAGES[i].pct, msg: STAGES[i].msg }); else clearInterval(timerRef.current); }, 6000);
  }
  function finishProgress(success) {
    clearInterval(timerRef.current);
    if (success) { setProgress({ visible: true, pct: 100, msg: "Done!" }); setTimeout(() => setProgress(p => ({ ...p, visible: false })), 800); }
    else setProgress(p => ({ ...p, visible: false }));
  }

  function handleSearch() {
    const issues = issueInput.split("\n").map(l => l.trim()).filter(Boolean);
    if (!issues.length) { setStatus({ msg: "Please enter at least one issue.", type: "error" }); return; }
    setStatus({ msg: "", type: "" }); setResults(null); setUploadMsg("");
    setSavedId(null); setShareMsg(""); setShowEmailForm(false); setEmailMsg("");
    setFilters(f => ({ ...f, requiredIssues: [] }));
    const source = searchSource.current || "manual";
    track("search_started", { source, issue_count: issues.length });
    searchSource.current = null;
    executeSearch(issues);
  }

  async function executeSearch(issues) {
    setResults(null); setWave2Loading(false); startProgress();
    try {
      await runEbaySearch(issues, userZip, {
        onWave1(rows) {
          const bundleCount = new Set(rows.filter(r => r.bundle_count >= 2).map(r => r.seller)).size;
          track("search_completed", { issue_count: issues.length, bundle_count: bundleCount });
          finishProgress(true);
          setResults({ rows, issueCount: issues.length, issues });
        },
        onWave2Start() { setWave2Loading(true); },
        onWave2(merged) { setResults(prev => ({ ...prev, rows: merged })); },
        onWave2End() { setWave2Loading(false); },
      }, userCountry);
    } catch (err) {
      finishProgress(false);
      setStatus({ msg: `Error: ${err.message}. Try again in a moment.`, type: "error" });
    }
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => copyTextFallback(text));
    } else {
      copyTextFallback(text);
    }
  }
  function copyTextFallback(text) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  async function handleSaveResults() {
    setSaving(true); setShareMsg("");
    try {
      const res = await fetch("/api/save-results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: results.rows, issueCount: results.issueCount }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSavedId(data.id);
      const url = `https://comicbundlefinder.com/results/${data.id}`;
      copyText(url);
      setShareMsg("Link copied to clipboard!");
      setTimeout(() => setShareMsg(""), 3000);
    } catch (e) { setShareMsg(`Error: ${e.message}`); }
    setSaving(false);
  }
  function handleCopyLink() {
    copyText(`https://comicbundlefinder.com/results/${savedId}`);
    setShareMsg("Copied!"); setTimeout(() => setShareMsg(""), 2000);
  }
  async function handleEmailResults(e) {
    e.preventDefault();
    if (!emailInput.trim()) return;
    setEmailing(true); setEmailMsg("");
    try {
      const res = await fetch("/api/email-results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: emailInput, rows: results.rows, issueCount: results.issueCount, savedId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.id && !savedId) setSavedId(data.id);
      setEmailMsg("Sent! Check your inbox.");
      setShowEmailForm(false);
    } catch (e) { setEmailMsg(`Error: ${e.message}`); }
    setEmailing(false);
  }

  // ── Filter helpers ─────────────────────────────────────────────────────

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value }));
  }
  function toggleRequiredIssue(issue) {
    setFilters(f => {
      const current = f.requiredIssues;
      return {
        ...f,
        requiredIssues: current.includes(issue)
          ? current.filter(i => i !== issue)
          : [...current, issue],
      };
    });
  }
  function resetFilters() {
    setFilters({ minPrice: "", maxPrice: "", shipping: "included", minBundle: 2, requiredIssues: [] });
    setSortBy("bundle_size");
  }
  const filtersActive =
    filters.minPrice !== "" ||
    filters.maxPrice !== "" ||
    filters.shipping !== "included" ||
    filters.minBundle > 2 ||
    filters.requiredIssues.length > 0 ||
    sortBy !== "bundle_size";

  // ── Render ─────────────────────────────────────────────────────────────

  return (<>
    <Head>
      <title>Comic Bundle Finder — Find eBay Sellers With Multiple Issues You Need</title>
      <meta name="description" content="Search eBay for comic book bundle deals. Paste your want list and find sellers who carry multiple issues — save money on combined shipping instead of paying separately for each book." />
      <meta name="keywords" content="comic books, eBay comics, comic bundle, combined shipping, comic want list, back issues, comic collecting" />
      <meta property="og:title" content="Comic Bundle Finder" />
      <meta property="og:description" content="Find eBay sellers who carry multiple issues from your comic want list. Save on combined shipping." />
      <meta property="og:type" content="website" />
      <meta property="og:url" content="https://www.comicbundlefinder.com" />
      <meta property="og:image" content="https://www.comicbundlefinder.com/preview.png" />
      <meta name="robots" content="index, follow" />
      <meta name="google-site-verification" content="gk8gi9ve5gW7xgq_LqiuiLSwhH4I8k8JUbsYKYRK8V4" />
      <link rel="canonical" href="https://www.comicbundlefinder.com" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebApplication",
            "name": "Comic Bundle Finder",
            "description": "Search eBay for comic book bundle deals. Paste your want list and find sellers who carry multiple issues — save money on combined shipping.",
            "url": "https://www.comicbundlefinder.com",
            "applicationCategory": "UtilitiesApplication",
            "operatingSystem": "Web",
            "offers": {
              "@type": "Offer",
              "price": "0",
              "priceCurrency": "USD",
            },
          }),
        }}
      />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
    </Head>
    <style>{`
      /* ── Page-specific: input form ─────────────────────────────────── */
      label{display:block;font-weight:600;font-size:1rem;letter-spacing:1px;text-transform:uppercase;margin-bottom:0.5rem}
      .label-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:0.5rem;flex-wrap:wrap}
      .label-row label{margin:0}
      .btn-upload{background:#fffdf4;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:2px 2px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.25rem 0.75rem;cursor:pointer;white-space:nowrap}
      .btn-upload:hover{background:#ffe066}
      .drop-zone{position:relative}
      .drop-zone.dragging textarea{border-color:#003399;box-shadow:0 0 0 3px #003399;background:#f0f4ff}
      .drag-overlay{display:none;position:absolute;inset:0;background:rgba(0,51,153,0.08);border:3px dashed #003399;pointer-events:none;align-items:center;justify-content:center;font-family:'Bangers',cursive;font-size:1.4rem;letter-spacing:2px;color:#003399}
      .drop-zone.dragging .drag-overlay{display:flex}
      textarea{width:100%;height:150px;border:2px solid #1a1a1a;background:#fffdf4;font-family:'Courier New',monospace;font-size:1rem;padding:0.75rem;resize:vertical;color:#1a1a1a}
      textarea:focus{outline:none;border-color:#003399;box-shadow:2px 2px 0 #003399}
      .upload-msg{font-size:0.8rem;font-weight:600;color:#003399;margin-top:0.5rem;letter-spacing:0.5px}
      .search-action-row{display:flex;align-items:center;gap:1rem;margin-top:1.25rem;flex-wrap:wrap}
      .btn-search{display:inline-block;background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.6rem;letter-spacing:2px;padding:0.3rem 2.5rem 0.4rem;cursor:pointer;transition:transform 0.08s,box-shadow 0.08s}
      .btn-search:hover{background:#0044cc}
      .btn-search:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #1a1a1a}
      .btn-search:disabled{background:#888;cursor:not-allowed;transform:none;box-shadow:4px 4px 0 #1a1a1a}
      .s-error{color:#cc1f00;font-weight:600;font-size:1rem;margin-top:0.9rem}
      .s-loading{color:#003399;font-size:1rem;margin-top:0.9rem}

      /* ── Page-specific: progress bar ───────────────────────────────── */
      .progress-wrap{margin-top:1.25rem}
      .progress-msg{font-size:0.82rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-bottom:0.5rem;color:#003399}
      .progress-track{border:2px solid #1a1a1a;background:#f0e6c4;height:24px;position:relative;overflow:hidden}
      .progress-fill{height:100%;background:#cc1f00;transition:width 0.7s ease}
      .progress-pct{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;font-family:'Bangers',cursive;font-size:1rem;letter-spacing:1px;color:#fffdf4;text-shadow:1px 1px 0 #1a1a1a}

      /* ── Page-specific: share / email panel ────────────────────────── */
      .share-panel{border-bottom:2px solid #d4c9a8;margin-bottom:1.5rem;padding-bottom:1.25rem}
      .share-title{font-family:'Bangers',cursive;font-size:1.4rem;letter-spacing:2px;color:#1a1a1a;margin-bottom:0.75rem}
      .share-buttons{display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.75rem}
      .btn-share{background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.25rem;letter-spacing:2px;padding:0.2rem 1.25rem 0.3rem;cursor:pointer;transition:transform 0.08s,box-shadow 0.08s;white-space:nowrap}
      .btn-share:hover{background:#0044cc}
      .btn-share:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #1a1a1a}
      .btn-share:disabled{opacity:0.6;cursor:default;transform:none;box-shadow:4px 4px 0 #1a1a1a}
      .btn-share-email{background:#fffdf4;color:#1a1a1a;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.25rem;letter-spacing:2px;padding:0.2rem 1.25rem 0.3rem;cursor:pointer;transition:transform 0.08s,box-shadow 0.08s;white-space:nowrap}
      .btn-share-email:hover{background:#ffe066}
      .btn-share-email:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #1a1a1a}
      .share-url-row{display:flex;gap:0.5rem;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap}
      .share-url-input{flex:1;min-width:220px;border:2px solid #003399;background:#f0f4ff;font-family:'Oswald',sans-serif;font-size:0.82rem;padding:0.3rem 0.6rem;color:#003399;font-weight:600;cursor:text}
      .btn-copy{background:#ffe066;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.3rem 0.9rem;cursor:pointer;white-space:nowrap}
      .btn-copy:hover{background:#ffd700}
      .share-feedback{font-size:0.8rem;font-weight:600;color:#003399;letter-spacing:0.5px;display:block;margin-bottom:0.5rem}
      .email-form{display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-top:0.5rem}
      .email-input{flex:1;min-width:200px;border:2px solid #1a1a1a;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:1rem;padding:0.35rem 0.6rem;color:#1a1a1a}
      .email-input:focus{outline:none;border-color:#003399;box-shadow:2px 2px 0 #003399}
      .btn-email-send{background:#cc1f00;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.2rem;letter-spacing:2px;padding:0.2rem 1.1rem 0.3rem;cursor:pointer;white-space:nowrap}
      .btn-email-send:hover{background:#a81900}
      .btn-email-send:disabled{opacity:0.6;cursor:default}

      /* ── Page-specific: misc ───────────────────────────────────────── */
      .ship-fallback{color:#888;font-size:0.75rem}
    `}</style>
    <div className="page-wrap">
      <SiteNav />

      <div className="panel" style={{ fontSize: "1rem", fontWeight: 400, lineHeight: 1.8, color: "#333" }}>
          Buying back issues on eBay? Shipping costs can turn a $2 comic into a $10 purchase. But most sellers combine shipping —
          so if you can find one seller who has several issues you need, you save big. Comic Bundle Finder searches eBay for every
          issue on your want list, then ranks sellers by how many of your issues they carry. Paste your list, hit search, and find
          your best bundle deals in seconds.
        </div>
        <div className="panel">
          <div className="caption">Enter your missing issues</div>
          <div className="label-row">
            <label htmlFor="issue-input">Paste your list — one issue per line:</label>
            {canUpload ? (
              <>
                <button className="btn-upload" onClick={() => fileInputRef.current?.click()}>Upload want list</button>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.txt" style={{ display: "none" }} onChange={onFileSelected} />
              </>
            ) : (
              <PremiumLock feature="file-upload" label="Upload want list" />
            )}
          </div>
          <div className={`drop-zone${isDragging && canUpload ? " dragging" : ""}`} onDragOver={canUpload ? onDragOver : undefined} onDragLeave={canUpload ? onDragLeave : undefined} onDrop={canUpload ? onDrop : undefined}>
            <textarea id="issue-input" value={issueInput} onChange={e => { setIssueInput(e.target.value); setUploadMsg(""); searchSource.current = null; }} placeholder={"Batgirl: Year One #2\nBlack Widow #10\nBlack Widow #11 (2014)"} />
            <div className="drag-overlay">Drop file here</div>
          </div>
          {uploadMsg && <div className="upload-msg">✓ {uploadMsg}</div>}
          <div className="hint">
            Type issues manually, or upload a .xlsx / .csv / .txt want list from League of Comic Geeks or CLZ.<br />
            Format: Series Name #Number — e.g. &ldquo;Amazing Spider-Man #300&rdquo; or &ldquo;Black Widow #10 (2014)&rdquo;
          </div>
          <div className="search-action-row">
            <button className="btn-search" style={{ marginTop: 0 }} onClick={handleSearch} disabled={progress.visible}>Find Bundles!</button>
          </div>
          {status.msg && <div className={status.type === "error" ? "s-error" : "s-loading"}>{status.msg}</div>}
          {progress.visible && (
            <div className="progress-wrap">
              <div className="progress-msg">{progress.msg}</div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress.pct}%` }} />
                <div className="progress-pct">{progress.pct}%</div>
              </div>
            </div>
          )}
        </div>

        {results && (
          <div className="panel">
            <div className="section-title">
              {totalSellers === 0
                ? "No Bundle Opportunities Found"
                : sellerCount === 0
                ? "No Results Match Current Filters"
                : "Results — Sellers Ranked by Bundle Count"}
            </div>

            {wave2Loading && (
              <div className="wave2-banner">
                <span className="wave2-spinner" />
                Loading additional results…
              </div>
            )}

            <div className="stats-row">
              <div className="stat-box"><div className="stat-number">{results.issueCount}</div><div className="stat-label">{singleIssueMode ? "Issue Searched" : "Issues Searched"}</div></div>
              <div className="stat-box"><div className="stat-number">{totalSellers}</div><div className="stat-label">Total Sellers Found</div></div>
              <div className="stat-box"><div className="stat-number">{sellerCount}</div><div className="stat-label">{singleIssueMode ? "Multi-Copy Sellers" : "Bundle Opportunities"}</div></div>
            </div>

            {/* Filter & Sort — always visible so users can adjust when filtered to zero */}
            <div className="filter-toggle-row">
              <button
                className={`btn-filter-toggle${filtersOpen ? " active" : ""}`}
                onClick={() => setFiltersOpen(o => !o)}
              >
                Filter &amp; Sort {filtersOpen ? "▲" : "▼"}
                {filtersActive && !filtersOpen && <span className="filter-active-dot" />}
              </button>
              {filtersActive && (
                <button className="btn-filter-reset" onClick={resetFilters}>Reset</button>
              )}
            </div>

            {filtersOpen && (
              <div className="filter-panel">
                <div className="filter-grid">
                  {/* Price range */}
                  <div className="filter-section">
                    <span className="filter-section-label">Price per issue</span>
                    <div className="filter-row">
                      <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>From</span>
                      <span style={{ fontWeight: 600 }}>$</span>
                      <input
                        className="filter-input"
                        type="number"
                        placeholder="0"
                        value={filters.minPrice}
                        onChange={e => setFilter("minPrice", e.target.value)}
                        min="0" step="0.50"
                      />
                      <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>to</span>
                      <span style={{ fontWeight: 600 }}>$</span>
                      <input
                        className="filter-input"
                        type="number"
                        placeholder="any"
                        value={filters.maxPrice}
                        onChange={e => setFilter("maxPrice", e.target.value)}
                        min="0" step="0.50"
                      />
                    </div>
                  </div>

                  {/* Min bundle size */}
                  <div className="filter-section">
                    <span className="filter-section-label">Min issues per bundle</span>
                    <div className="filter-row">
                      <input
                        className="filter-input"
                        type="number"
                        value={filters.minBundle}
                        onChange={e => setFilter("minBundle", Math.max(2, parseInt(e.target.value) || 2))}
                        min="2" step="1"
                        style={{ width: "60px" }}
                      />
                      <span style={{ fontSize: "0.8rem", fontWeight: 400 }}>issues minimum</span>
                    </div>
                  </div>

                  {/* Shipping filter */}
                  <div className="filter-section">
                    <span className="filter-section-label">Free shipping</span>
                    <div className="filter-radio-group">
                      {[["included", "Any"], ["required", "Free only"], ["excluded", "No free"]].map(([val, label]) => (
                        <label key={val} className="filter-radio-label">
                          <input
                            type="radio"
                            name="shipping-filter"
                            value={val}
                            checked={filters.shipping === val}
                            onChange={() => setFilter("shipping", val)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Sort */}
                  <div className="filter-section">
                    <span className="filter-section-label">Sort by</span>
                    <div className="filter-radio-group" style={{ flexDirection: "column", gap: "0.3rem" }}>
                      {[
                        ["bundle_size", "Bundle size (most issues first)"],
                        ["est_price_per_issue", "Lowest est. price per issue"],
                        ["est_shipping", "Lowest est. shipping"],
                      ].map(([val, label]) => (
                        <label key={val} className="filter-radio-label">
                          <input
                            type="radio"
                            name="sort-by"
                            value={val}
                            checked={sortBy === val}
                            onChange={() => setSortBy(val)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Required issues — only shown for multi-issue searches */}
                  {!singleIssueMode && results.issues?.length > 1 && (() => {
                    const allSelected = results.issues.every(i => filters.requiredIssues.includes(i));
                    return (
                      <div className="filter-section" style={{ gridColumn: "1 / -1" }}>
                        <hr className="filter-divider" style={{ marginTop: 0, marginBottom: "0.75rem" }} />
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                          <span className="filter-section-label" style={{ margin: 0 }}>Required issues (only show sellers who have these)</span>
                          <button
                            className="btn-filter-reset"
                            style={{ textDecoration: "none", background: "#ffe066", border: "1.5px solid #1a1a1a", padding: "1px 8px", fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.5px", cursor: "pointer" }}
                            onClick={() => setFilter("requiredIssues", allSelected ? [] : [...results.issues])}
                          >
                            {allSelected ? "Deselect All" : "Select All"}
                          </button>
                        </div>
                        <div className="filter-checkboxes">
                          {results.issues.map(issue => (
                            <label
                              key={issue}
                              className={`filter-checkbox-label${filters.requiredIssues.includes(issue) ? " checked" : ""}`}
                            >
                              <input
                                type="checkbox"
                                style={{ display: "none" }}
                                checked={filters.requiredIssues.includes(issue)}
                                onChange={() => toggleRequiredIssue(issue)}
                              />
                              {issue}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {sellerCount === 0 ? (
              <div className="no-results">
                {totalSellers === 0
                  ? (singleIssueMode
                      ? "No seller has more than one listing for this issue. Try checking back later."
                      : "No single seller carries more than one of your issues. You may need to buy these separately, or try broadening your search.")
                  : "No sellers match the current filters. Try adjusting or resetting them above."}
              </div>
            ) : (<>
              <div className="share-panel">
                <div className="share-title">Save or Share These Results</div>
                <div className="share-buttons">
                  {canSaveResults ? (
                    <button className="btn-share" onClick={handleSaveResults} disabled={saving || !!savedId}>
                      {saving ? "Saving…" : savedId ? "✓ Saved" : "💾 Save Results"}
                    </button>
                  ) : (
                    <button className="btn-share" style={{ opacity: 0.5, cursor: "not-allowed", filter: "grayscale(0.4)" }} onClick={() => signIn()} title="Premium feature — sign in to upgrade">
                      Save Results
                    </button>
                  )}
                  {canEmailResults ? (
                    <button className="btn-share-email" onClick={() => { setShowEmailForm(f => !f); setEmailMsg(""); }}>
                      ✉ Email Results
                    </button>
                  ) : (
                    <button className="btn-share-email" style={{ opacity: 0.5, cursor: "not-allowed", filter: "grayscale(0.4)" }} onClick={() => signIn()} title="Premium feature — sign in to upgrade">
                      Email Results
                    </button>
                  )}
                </div>
                {!canSaveResults && !canEmailResults && (
                  <p style={{ fontSize: "0.78rem", color: "#888", fontWeight: 400, marginTop: "0.5rem" }}>
                    <button onClick={() => signIn()} style={{ background: "none", border: "none", color: "#003399", fontWeight: 600, cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: "inherit" }}>Sign in</button>{" "}
                    to unlock Save &amp; Email Results with a Premium account.
                  </p>
                )}
                {canSaveResults && savedId && (
                  <div className="share-url-row">
                    <input className="share-url-input" readOnly value={`https://comicbundlefinder.com/results/${savedId}`} onClick={e => e.target.select()} />
                    <button className="btn-copy" onClick={handleCopyLink}>{shareMsg === "Copied!" ? "✓ Copied" : "Copy Link"}</button>
                  </div>
                )}
                {shareMsg && shareMsg !== "Copied!" && <span className="share-feedback">{shareMsg}</span>}
                {canEmailResults && showEmailForm && (
                  <form className="email-form" onSubmit={handleEmailResults}>
                    <input className="email-input" type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)} placeholder="your@email.com" required autoFocus />
                    <button className="btn-email-send" type="submit" disabled={emailing}>{emailing ? "Sending…" : "Send"}</button>
                    <span style={{ width: "100%", fontSize: "0.72rem", color: "#888", fontWeight: 400, marginTop: "0.25rem" }}>Your email is used only to send your results and is not stored or used for marketing.</span>
                  </form>
                )}
                {emailMsg && <span className="share-feedback" style={{ color: emailMsg.startsWith("Error") ? "#cc1f00" : "#003399" }}>{emailMsg}</span>}
              </div>

              {sellerEntries.map(([name, data]) => {
                const estPerIssueStr = `~$${data.estPerIssue.toFixed(2)}/issue`;
                const savingsStr = data.shippingSavings !== null && data.shippingSavings > 0.01
                  ? `save ~$${data.shippingSavings.toFixed(2)} shipping`
                  : null;

                return (
                  <div className="seller-group" key={name}>
                    <div className="seller-header">
                      <span className="seller-name">{esc(name)}</span>
                      <span className="bundle-badge">{singleIssueMode ? `${data.bundle_count} listings` : `${data.bundle_count} issues`} — bundle shipping!</span>
                      <span className="subtotal-badge">from ${data.subtotal.toFixed(2)} in items</span>
                      <span className="badge-est">{estPerIssueStr}</span>
                      {savingsStr && <span className="badge-savings">{savingsStr}</span>}
                    </div>
                    <table className="listings-table">
                      <thead><tr>
                        <th className="col-issue">Issue You Need</th>
                        <th className="col-title">Listing Title</th>
                        <th className="col-price">Price</th>
                        <th className="col-ship">Est. Shipping</th>
                        <th className="col-link">Link</th>
                      </tr></thead>
                      <tbody>
                        {data.listings.map((l, i) => {
                          let shipDisplay;
                          if (l.shipping === "0.00") {
                            shipDisplay = "FREE";
                          } else if (l.shipping === "unknown") {
                            shipDisplay = userZip
                              ? <span className="ship-fallback">calc.</span>
                              : <span className="ship-fallback">{SHIPPING_FALLBACK}</span>;
                          } else {
                            shipDisplay = `$${parseFloat(l.shipping).toFixed(2)}`;
                          }
                          return (<tr key={i}>
                            <td className="col-issue">{esc(l.issue)}</td>
                            <td className="col-title">{esc(l.title)}</td>
                            <td className="col-price">${parseFloat(l.price).toFixed(2)}</td>
                            <td className="col-ship">{shipDisplay}</td>
                            <td className="col-link"><a className="listing-link" href={l.url} target="_blank" rel="noopener noreferrer">View →</a></td>
                          </tr>);
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
              <div className="disclosure">Some links on this page may be affiliate links. A small commission may be earned if you purchase through these links, at no extra cost to you.</div>
            </>)}
          </div>
        )}

      <SiteFooter />
    </div>
  </>);
}
