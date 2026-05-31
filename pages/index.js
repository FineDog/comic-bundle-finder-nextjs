import { useState, useRef, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import * as XLSX from "xlsx";

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

// Wave 1 returns MAX_RESULTS per issue; wave 2 fetches the remainder.
const EBAY_PAGE_SIZE = 200;

// Estimated USPS Media Mail shipping range (Zone 1 → Zone 8) shown when
// geolocation is unavailable and the listing uses calculated shipping.
const SHIPPING_FALLBACK = "~$4–$6";

// ── Utility ───────────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const fields = []; let current = ""; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQuotes && line[i+1]==='"'){current+='"';i++;}else inQuotes=!inQuotes; }
    else if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  fields.push(current.trim()); return fields;
}

function yearFromDateString(s) {
  if (!s) return "";
  const m = s.match(/^(\d{4})-/); if (m) return m[1];
  const clz = s.match(/^[A-Za-z]{3}-(\d{2})$/);
  if (clz) { const y = parseInt(clz[1], 10); return String(y < 30 ? 2000 + y : 1900 + y); }
  const d = new Date(s); return isNaN(d) ? "" : String(d.getFullYear());
}

function monthYearFromDateString(s) {
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return { year: parseInt(iso[1], 10), month: parseInt(iso[2], 10) };
  const CLZ_MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  const clz = s.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (clz) {
    const month = CLZ_MONTHS[clz[1].toLowerCase()];
    const y = parseInt(clz[2], 10);
    return month ? { year: y < 30 ? 2000 + y : 1900 + y, month } : null;
  }
  const d = new Date(s);
  return isNaN(d) ? null : { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function yearAfterMonths(date, offset) {
  if (!date) return "";
  if (!date.month) return String(date.year);
  return String(Math.floor((date.year * 12 + date.month - 1 + offset) / 12));
}

function esc(s) { return String(s || ""); }

// ── Series name helpers ───────────────────────────────────────────────────────

function cleanSeriesName(name) {
  return name
    .replace(/\s*\(Vol\.\s*\d+\)/gi, "")
    .replace(/,?\s*Vol\.\s*\d+/gi, "")
    .replace(/\s*\(\d{4}\s*[-–]\s*(?:\d{4}|[Pp]resent)\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseIssueNum(s) {
  const m = String(s).match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

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

// ── Gap analysis parsers ──────────────────────────────────────────────────────

async function parseComicGeeksForGaps(file) {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  if (!rows.length) return { items: [], format: "unknown", count: 0 };
  if (!("Full Title" in rows[0])) {
    const items = rows
      .map(r => plainLineToItem(String(Object.values(r)[0] || "").trim()))
      .filter(Boolean);
    return { items, format: "plain", count: items.length };
  }
  const items = [];
  for (const r of rows) {
    const series = String(r["Series"] || "").trim();
    const fullTitle = String(r["Full Title"] || "").trim();
    const issueDate = monthYearFromDateString(String(r["Release Date"] || ""));
    const numMatch = fullTitle.match(/#(\d+)/);
    if (!numMatch) continue;
    const rawSeries = series || fullTitle.replace(/\s*#\d+.*$/, "").trim();
    items.push({ seriesKey: rawSeries, seriesClean: cleanSeriesName(rawSeries), issueNum: parseInt(numMatch[1], 10), issueDate });
  }
  return { items, format: "comicgeeks", count: items.length };
}

function parsePlainIssueLine(line) {
  const yearMatch = line.match(/\((\d{4})\)/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  const withoutYear = line.replace(/\s*\(\d{4}\)\s*/, " ").trim();
  const hashMatch = withoutYear.match(/#(\d+)/);
  if (hashMatch) {
    const seriesRaw = withoutYear.replace(/\s*#\d+.*$/, "").trim();
    if (!seriesRaw) return null;
    return { seriesRaw, issueNum: parseInt(hashMatch[1], 10), year };
  }
  const spaceMatch = withoutYear.match(/^(.+?)\s+(\d+)\s*$/);
  if (spaceMatch) {
    const seriesRaw = spaceMatch[1].trim();
    const issueNum = parseInt(spaceMatch[2], 10);
    if (!seriesRaw || issueNum < 1) return null;
    return { seriesRaw, issueNum, year };
  }
  return null;
}

function plainLineToItem(line) {
  const parsed = parsePlainIssueLine(line);
  if (!parsed) return null;
  return { seriesKey: parsed.seriesRaw, seriesClean: parsed.seriesRaw, issueNum: parsed.issueNum, issueDate: parsed.year ? { year: parsed.year, month: null } : null };
}

async function parseCLZForGaps(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { items: [], format: "unknown", count: 0 };
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  const si = headers.indexOf("series"), ii = headers.indexOf("issue"), di = headers.indexOf("release date");
  if (si === -1 || ii === -1) {
    const items = lines.map(plainLineToItem).filter(Boolean);
    return { items, format: "plain", count: items.length };
  }
  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCSVLine(lines[i]);
    const series = c[si]?.trim() || "";
    const issueRaw = c[ii]?.trim() || "";
    const issueDate = di >= 0 ? monthYearFromDateString(c[di]?.trim() || "") : null;
    const issueNum = parseIssueNum(issueRaw);
    if (!series || issueNum === null) continue;
    items.push({ seriesKey: series, seriesClean: cleanSeriesName(series), issueNum, issueDate });
  }
  return { items, format: "clz", count: items.length };
}

async function parsePlainForGaps(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = lines.map(plainLineToItem).filter(Boolean);
  return { items, format: "plain", count: items.length };
}

async function parseFileForGaps(file) {
  const n = file.name.toLowerCase();
  if (n.endsWith(".xlsx") || n.endsWith(".xls")) return parseComicGeeksForGaps(file);
  if (n.endsWith(".csv")) return parseCLZForGaps(file);
  if (n.endsWith(".txt")) return parsePlainForGaps(file);
  return { items: [], format: "unsupported", count: 0 };
}

function formatCollectionLabel(r) {
  if (r.format === "comicgeeks") return `Loaded ${r.count} issue${r.count===1?"":"s"} from League of Comic Geeks collection.`;
  if (r.format === "clz") return `Loaded ${r.count} issue${r.count===1?"":"s"} from CLZ collection.`;
  if (r.format === "plain") return `Loaded ${r.count} issue${r.count===1?"":"s"} from plain text collection.`;
  return null;
}

// ── Gap analysis ──────────────────────────────────────────────────────────────

function analyzeGaps(items, threshold = 5) {
  const seriesMap = new Map();
  for (const item of items) {
    if (!seriesMap.has(item.seriesKey)) {
      seriesMap.set(item.seriesKey, { displayName: item.seriesClean, owned: new Map() });
    }
    const owned = seriesMap.get(item.seriesKey).owned;
    if (!owned.has(item.issueNum)) owned.set(item.issueNum, item.issueDate);
  }

  const gaps = [];
  for (const series of seriesMap.values()) {
    const ownedNums = [...series.owned.keys()].sort((a, b) => a - b);
    if (ownedNums.length === 0) continue;
    const fmt = (n, year) => `${series.displayName} #${n}${year ? ` (${year})` : ""}`;
    const min = ownedNums[0];
    if (min <= threshold && min > 1) {
      const anchor = series.owned.get(min);
      for (let n = 1; n < min; n++) gaps.push(fmt(n, yearAfterMonths(anchor, n - min)));
    }
    for (let i = 0; i < ownedNums.length - 1; i++) {
      const lo = ownedNums[i], hi = ownedNums[i + 1];
      const gapSize = hi - lo - 1;
      if (gapSize > 0 && gapSize <= threshold) {
        const loDate = series.owned.get(lo);
        for (let n = lo + 1; n < hi; n++) gaps.push(fmt(n, yearAfterMonths(loDate, n - lo)));
      }
    }
  }
  return gaps;
}

// ── Result processing ─────────────────────────────────────────────────────────

// Merge wave 2 rows into wave 1, deduplicated by URL, with bundle counts recomputed.
function mergeAndRecount(rows1, rows2) {
  const urlSet = new Set(rows1.map(r => r.url));
  const merged = [...rows1];
  for (const r of rows2) {
    if (!urlSet.has(r.url)) {
      urlSet.add(r.url);
      merged.push(r);
    }
  }
  const sellerIssues = {};
  for (const r of merged) {
    if (!sellerIssues[r.seller]) sellerIssues[r.seller] = new Set();
    sellerIssues[r.seller].add(r.issue);
  }
  return merged.map(r => ({ ...r, bundle_count: sellerIssues[r.seller].size }));
}

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
    // In single-issue mode, count total available copies (sum of quantities) so that
    // a seller with one listing at qty:3 is treated the same as three separate listings.
    data.bundle_count = issueCount === 1
      ? data.listings.reduce((sum, l) => sum + (l.quantity || 1), 0)
      : uniqueIssues.size;

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
  const [activeTab, setActiveTab] = useState("search");

  // Search tab state
  const [issueInput, setIssueInput] = useState("");
  const [status, setStatus] = useState({ msg: "", type: "" });
  const [progress, setProgress] = useState({ visible: false, pct: 0, msg: "" });
  const [results, setResults] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [wave2Loading, setWave2Loading] = useState(false);
  const [userZip, setUserZip] = useState(null);

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

  // Gap analyzer tab state
  const [collectionMsg, setCollectionMsg] = useState("");
  const [collectionItems, setCollectionItems] = useState(null);
  const [gapThreshold, setGapThreshold] = useState(5);
  const [showSlider, setShowSlider] = useState(false);
  const [gaps, setGaps] = useState(null);
  const [copyMsg, setCopyMsg] = useState("");
  const [isCollectionDragging, setIsCollectionDragging] = useState(false);
  const collectionFileInputRef = useRef(null);

  // Geolocate on mount for shipping estimates
  useEffect(() => {
    fetch("/api/geolocate")
      .then(r => r.json())
      .then(({ zip }) => setUserZip(zip || null))
      .catch(() => setUserZip(null));
  }, []);

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
      // Wave 1
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issues, zip: userZip }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Server error");

      const bundleCount = new Set(data.results.filter(r => r.bundle_count >= 2).map(r => r.seller)).size;
      track("search_completed", { issue_count: issues.length, bundle_count: bundleCount });
      finishProgress(true);
      setResults({ rows: data.results, issueCount: issues.length, issues });

      // Determine which issues need additional pages
      const wave2Tasks = [];
      for (const [issue, total] of Object.entries(data.totals || {})) {
        for (let offset = EBAY_PAGE_SIZE; offset < total; offset += EBAY_PAGE_SIZE) {
          wave2Tasks.push({ issue, offset });
        }
      }

      if (wave2Tasks.length > 0) {
        setWave2Loading(true);
        try {
          const res2 = await fetch("/api/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ issueOffsets: wave2Tasks, zip: userZip }),
          });
          const data2 = await res2.json();
          if (res2.ok && data2.results?.length) {
            setResults(prev => ({
              ...prev,
              rows: mergeAndRecount(prev.rows, data2.results),
            }));
          }
        } catch {} // wave 2 failure is non-fatal
        setWave2Loading(false);
      }
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

  // ── Gap analyzer handlers ──────────────────────────────────────────────

  async function handleCollectionFile(file) {
    setCollectionMsg("Reading file…");
    setGaps(null); setCopyMsg("");
    try {
      const result = await parseFileForGaps(file);
      if (result.format === "unsupported") { setCollectionMsg("Please upload a .xlsx (Comic Geeks) or .csv (CLZ) file."); return; }
      if (!result.items.length) { setCollectionMsg("No collection issues found in that file."); return; }
      setCollectionItems(result.items);
      const label = formatCollectionLabel(result);
      setCollectionMsg(label || `Loaded ${result.count} issues.`);
      const foundGaps = analyzeGaps(result.items, gapThreshold);
      setGaps(foundGaps);
      track("gap_analysis_run", { source: result.format, gap_count: foundGaps.length });
      if (foundGaps.length) runGapSearch(foundGaps);
    } catch { setCollectionMsg("Could not read that file."); }
  }
  function onCollectionFileSelected(e) { const f = e.target.files?.[0]; if (f) handleCollectionFile(f); e.target.value = ""; }
  function onCollectionDragOver(e) { e.preventDefault(); setIsCollectionDragging(true); }
  function onCollectionDragLeave(e) { if (!e.currentTarget.contains(e.relatedTarget)) setIsCollectionDragging(false); }
  function onCollectionDrop(e) { e.preventDefault(); setIsCollectionDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleCollectionFile(f); }

  function runGapSearch(gapList) {
    setIssueInput(gapList.join("\n"));
    setUploadMsg(`${gapList.length} gap issue${gapList.length === 1 ? "" : "s"} from Gap Analyzer.`);
    setActiveTab("search");
    track("search_started", { source: "gap_analyzer", issue_count: gapList.length });
    executeSearch(gapList);
  }

  function onThresholdChange(val) {
    setGapThreshold(val);
    if (!collectionItems) return;
    const foundGaps = analyzeGaps(collectionItems, val);
    setGaps(foundGaps);
    if (foundGaps.length) runGapSearch(foundGaps);
  }

  function copyGaps() {
    if (!gaps || !gaps.length) return;
    const text = gaps.join("\n");
    const tryExecCommand = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    };
    const finish = (ok) => {
      setCopyMsg(ok ? "Copied!" : "Copy failed — please select and copy manually.");
      setTimeout(() => setCopyMsg(""), 2500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => finish(true)).catch(() => finish(tryExecCommand()));
    } else {
      finish(tryExecCommand());
    }
  }

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
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem}
      .container{max-width:960px;margin:0 auto}
      .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.75rem}
      .title-panel{background:#cc1f00;text-align:center;padding:1.25rem 1.75rem 1rem}
      .title-panel h1{font-family:'Bangers',cursive;font-size:clamp(2.5rem,8vw,5rem);color:#fffdf4;letter-spacing:4px;text-shadow:4px 4px 0 #1a1a1a;line-height:1}
      .tagline{color:#ffe066;font-size:0.85rem;letter-spacing:2px;text-transform:uppercase;margin-top:0.4rem;font-weight:400}
      .tab-bar{display:flex;gap:0;margin-bottom:1.75rem;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a}
      .tab-btn{flex:1;font-family:'Bangers',cursive;font-size:1.3rem;letter-spacing:2px;padding:0.55rem 1rem 0.65rem;border:none;cursor:pointer;transition:background 0.1s;text-transform:uppercase}
      .tab-btn.active{background:#cc1f00;color:#fffdf4}
      .tab-btn:not(.active){background:#fffdf4;color:#1a1a1a}
      .tab-btn:not(.active):hover{background:#ffe066}
      .tab-btn:first-child{border-right:2px solid #1a1a1a}
      .caption{display:inline-block;background:#ffe066;border:2px solid #1a1a1a;padding:0.3rem 0.7rem;font-size:0.8rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:1rem}
      .label-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:0.5rem;flex-wrap:wrap}
      .label-row label{font-weight:600;font-size:0.9rem;letter-spacing:1px;text-transform:uppercase;margin:0}
      .btn-upload{background:#fffdf4;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:2px 2px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.25rem 0.75rem;cursor:pointer;white-space:nowrap}
      .btn-upload:hover{background:#ffe066}
      .drop-zone{position:relative}
      .drop-zone.dragging textarea{border-color:#003399;box-shadow:0 0 0 3px #003399;background:#f0f4ff}
      .drag-overlay{display:none;position:absolute;inset:0;background:rgba(0,51,153,0.08);border:3px dashed #003399;pointer-events:none;align-items:center;justify-content:center;font-family:'Bangers',cursive;font-size:1.4rem;letter-spacing:2px;color:#003399}
      .drop-zone.dragging .drag-overlay{display:flex}
      textarea{width:100%;height:150px;border:2px solid #1a1a1a;background:#fffdf4;font-family:'Courier New',monospace;font-size:0.9rem;padding:0.75rem;resize:vertical;color:#1a1a1a}
      textarea:focus{outline:none;border-color:#003399;box-shadow:2px 2px 0 #003399}
      .hint{font-size:0.78rem;color:#666;margin-top:0.4rem;font-weight:400;line-height:1.5}
      .upload-msg{font-size:0.8rem;font-weight:600;color:#003399;margin-top:0.5rem;letter-spacing:0.5px}
      label{display:block;font-weight:600;font-size:0.9rem;letter-spacing:1px;text-transform:uppercase;margin-bottom:0.5rem}
      .btn-search{display:inline-block;background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.6rem;letter-spacing:2px;padding:0.3rem 2.5rem 0.4rem;cursor:pointer;margin-top:1.25rem;transition:transform 0.08s,box-shadow 0.08s}
      .btn-search:hover{background:#0044cc}
      .btn-search:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #1a1a1a}
      .btn-search:disabled{background:#888;cursor:not-allowed;transform:none;box-shadow:4px 4px 0 #1a1a1a}
      .s-error{color:#cc1f00;font-weight:600;font-size:0.88rem;margin-top:0.9rem}
      .s-loading{color:#003399;font-size:0.88rem;margin-top:0.9rem}
      .progress-wrap{margin-top:1.25rem}
      .progress-msg{font-size:0.82rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-bottom:0.5rem;color:#003399}
      .progress-track{border:2px solid #1a1a1a;background:#f0e6c4;height:24px;position:relative;overflow:hidden}
      .progress-fill{height:100%;background:#cc1f00;transition:width 0.7s ease}
      .progress-pct{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;font-family:'Bangers',cursive;font-size:0.85rem;letter-spacing:1px;color:#fffdf4;text-shadow:1px 1px 0 #1a1a1a}
      .stats-row{display:flex;gap:1rem;margin-bottom:1.25rem;flex-wrap:wrap}
      .stat-box{flex:1;min-width:110px;background:#ffe066;border:2px solid #1a1a1a;padding:0.6rem 1rem;text-align:center}
      .stat-number{font-family:'Bangers',cursive;font-size:2.2rem;color:#cc1f00;line-height:1}
      .stat-label{font-size:0.68rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#1a1a1a;margin-top:2px}
      .results-title{font-family:'Bangers',cursive;font-size:2rem;letter-spacing:2px;color:#cc1f00;margin-bottom:1.25rem}
      .wave2-banner{display:inline-flex;align-items:center;gap:0.5rem;background:#ffe066;border:2px solid #1a1a1a;font-size:0.75rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.3rem 0.85rem;margin-bottom:1.25rem}
      .wave2-spinner{width:10px;height:10px;border:2px solid #1a1a1a;border-top-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite;display:inline-block;flex-shrink:0}
      @keyframes spin{to{transform:rotate(360deg)}}
      .filter-toggle-row{display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem;flex-wrap:wrap}
      .btn-filter-toggle{background:#ffe066;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:2px 2px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.3rem 0.9rem;cursor:pointer;white-space:nowrap}
      .btn-filter-toggle:hover{background:#ffd700}
      .btn-filter-toggle.active{background:#003399;color:#fffdf4}
      .btn-filter-toggle.active:hover{background:#0044cc}
      .filter-active-dot{width:8px;height:8px;background:#cc1f00;border:1.5px solid #1a1a1a;border-radius:50%;display:inline-block;margin-left:2px;vertical-align:middle}
      .btn-filter-reset{background:none;border:none;color:#cc1f00;font-family:'Oswald',sans-serif;font-size:0.75rem;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;cursor:pointer;text-decoration:underline;padding:0}
      .filter-panel{background:#f8f3e3;border:2px solid #1a1a1a;padding:1.1rem 1.25rem;margin-bottom:1.5rem}
      .filter-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem 2rem}
      @media(max-width:600px){.filter-grid{grid-template-columns:1fr}}
      .filter-section{margin-bottom:0}
      .filter-section-label{font-size:0.68rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#1a1a1a;margin-bottom:0.45rem;display:block}
      .filter-row{display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap}
      .filter-input{width:72px;border:2px solid #1a1a1a;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:0.9rem;font-weight:600;padding:0.25rem 0.4rem;text-align:center;color:#1a1a1a}
      .filter-input:focus{outline:none;border-color:#003399;box-shadow:2px 2px 0 #003399}
      .filter-radio-group{display:flex;gap:0.65rem;flex-wrap:wrap}
      .filter-radio-label{display:flex;align-items:center;gap:0.3rem;font-size:0.8rem;font-weight:400;cursor:pointer;user-select:none}
      .filter-divider{border:none;border-top:1.5px solid #d4c9a8;margin:0.9rem 0;grid-column:1/-1}
      .filter-checkboxes{display:flex;flex-wrap:wrap;gap:0.4rem;max-height:120px;overflow-y:auto}
      .filter-checkbox-label{display:flex;align-items:center;gap:0.3rem;font-size:0.75rem;font-weight:400;cursor:pointer;background:#fffdf4;border:1.5px solid #1a1a1a;padding:2px 7px;white-space:nowrap;user-select:none}
      .filter-checkbox-label.checked{background:#003399;color:#fffdf4;border-color:#003399}
      .seller-group{margin-bottom:1.75rem}
      .seller-header{background:#003399;color:#fffdf4;padding:0.5rem 0.75rem;display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;border:2px solid #1a1a1a;border-bottom:none}
      .seller-name{font-family:'Bangers',cursive;font-size:1.35rem;letter-spacing:1px}
      .bundle-badge{background:#cc1f00;color:#fffdf4;font-size:0.68rem;font-weight:600;padding:2px 8px;border:1.5px solid #1a1a1a;letter-spacing:1px;text-transform:uppercase;white-space:nowrap}
      .qty-badge{display:inline-block;background:#003399;color:#fffdf4;font-size:0.65rem;font-weight:700;padding:1px 5px;margin-left:5px;border:1.5px solid #1a1a1a;letter-spacing:0.5px;vertical-align:middle;white-space:nowrap}
      .subtotal-badge{font-size:0.73rem;font-weight:600;color:#fffdf4;background:#003399;border:1.5px solid #ffe066;padding:2px 8px;letter-spacing:0.5px;white-space:nowrap}
      .badge-est{font-size:0.73rem;font-weight:600;color:#1a1a1a;background:#ffe066;border:1.5px solid #1a1a1a;padding:2px 8px;letter-spacing:0.5px;white-space:nowrap}
      .badge-savings{font-size:0.73rem;font-weight:600;color:#fffdf4;background:#1a1a1a;border:1.5px solid #ffe066;padding:2px 8px;letter-spacing:0.5px;white-space:nowrap}
      .listings-table{width:100%;border-collapse:collapse;border:2px solid #1a1a1a;font-size:0.82rem;table-layout:fixed}
      .listings-table th{background:#1a1a1a;color:#fffdf4;padding:0.4rem 0.6rem;text-align:left;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;font-size:0.7rem;white-space:nowrap}
      .listings-table td{padding:0.45rem 0.6rem;border-bottom:1px solid #d4c9a8;vertical-align:top;font-weight:400;overflow:hidden;text-overflow:ellipsis;word-break:break-word}
      .listings-table tr:last-child td{border-bottom:none}
      .listings-table tr:nth-child(even) td{background:#f8f3e3}
      .col-issue{width:24%}.col-title{width:42%}.col-price{width:10%;text-align:right}.col-ship{width:14%;text-align:right}.col-link{width:10%;text-align:center}
      .listing-link{color:#cc1f00;font-weight:600;text-decoration:none;white-space:nowrap;font-size:0.8rem}
      .listing-link:hover{text-decoration:underline}
      .no-results{text-align:center;padding:2rem;color:#666;font-size:0.95rem;font-weight:400}
      .disclosure{font-size:0.72rem;color:#888;text-align:center;font-weight:400;margin-top:1.25rem;line-height:1.5;border-top:1px solid #d4c9a8;padding-top:0.75rem}
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
      .email-input{flex:1;min-width:200px;border:2px solid #1a1a1a;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:0.88rem;padding:0.35rem 0.6rem;color:#1a1a1a}
      .email-input:focus{outline:none;border-color:#003399;box-shadow:2px 2px 0 #003399}
      .btn-email-send{background:#cc1f00;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.2rem;letter-spacing:2px;padding:0.2rem 1.1rem 0.3rem;cursor:pointer;white-space:nowrap}
      .btn-email-send:hover{background:#a81900}
      .btn-email-send:disabled{opacity:0.6;cursor:default}
      .gap-upload-area{border:3px dashed #1a1a1a;background:#fffdf4;padding:2rem;text-align:center;margin-bottom:1.25rem;position:relative;transition:border-color 0.1s,background 0.1s}
      .gap-upload-area.dragging{border-color:#003399;background:#f0f4ff}
      .gap-upload-area p{font-size:0.88rem;font-weight:400;color:#555;margin-top:0.5rem}
      .gap-drag-overlay{display:none;position:absolute;inset:0;background:rgba(0,51,153,0.08);align-items:center;justify-content:center;font-family:'Bangers',cursive;font-size:1.4rem;letter-spacing:2px;color:#003399;pointer-events:none}
      .gap-upload-area.dragging .gap-drag-overlay{display:flex}
      .gap-upload-area.dragging .gap-upload-contents{visibility:hidden}
      .threshold-row{display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem;flex-wrap:wrap}
      .threshold-label{font-size:0.82rem;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;white-space:nowrap}
      .btn-toggle{background:none;border:none;color:#003399;font-family:'Oswald',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;cursor:pointer;text-decoration:underline;padding:0}
      .threshold-slider{flex:1;min-width:140px;max-width:260px;accent-color:#cc1f00}
      .gap-results-header{font-family:'Bangers',cursive;font-size:1.8rem;letter-spacing:2px;color:#cc1f00;margin-bottom:0.75rem}
      .gap-actions{display:flex;gap:0.75rem;margin-top:1rem;flex-wrap:wrap;align-items:center}
      .btn-gap-action{background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.3rem;letter-spacing:2px;padding:0.2rem 1.5rem 0.3rem;cursor:pointer;transition:transform 0.08s,box-shadow 0.08s;white-space:nowrap}
      .btn-gap-action:hover{background:#0044cc}
      .btn-gap-action:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #1a1a1a}
      .btn-gap-secondary{background:#fffdf4;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.82rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.35rem 1rem;cursor:pointer;white-space:nowrap}
      .btn-gap-secondary:hover{background:#ffe066}
      .copy-msg{font-size:0.8rem;font-weight:600;color:#003399;letter-spacing:0.5px}
      .gap-empty{color:#666;font-size:0.9rem;font-weight:400;padding:1rem 0}
      .search-action-row{display:flex;align-items:center;gap:1rem;margin-top:1.25rem;flex-wrap:wrap}
      .or-text{font-family:'Bangers',cursive;font-size:1.1rem;letter-spacing:2px;color:#1a1a1a;white-space:nowrap}
      .btn-guides{display:inline-block;background:#ffe066;color:#1a1a1a;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.35rem;letter-spacing:2px;padding:0.3rem 1.75rem 0.4rem;cursor:pointer;text-decoration:none;transition:transform 0.08s,box-shadow 0.08s,background 0.08s}
      .btn-guides:hover{background:#ffd700}
      .btn-guides:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #1a1a1a}
      .ship-fallback{color:#888;font-size:0.75rem}
      @media(max-width:600px){.col-title{display:none}.col-issue{width:40%}.filter-grid{grid-template-columns:1fr}}
    `}</style>
    <div className="container">
      <div className="panel title-panel">
        <h1>Comic Bundle Finder</h1>
        <div className="tagline">Find sellers with multiple issues you need &mdash; save on shipping</div>
      </div>

      <div className="tab-bar">
        <button className={`tab-btn${activeTab === "search" ? " active" : ""}`} onClick={() => setActiveTab("search")}>Search</button>
        <button className={`tab-btn${activeTab === "analyzer" ? " active" : ""}`} onClick={() => setActiveTab("analyzer")}>Gap Analyzer</button>
      </div>

      {activeTab === "search" && (<>
        <div className="panel" style={{ fontSize: "0.88rem", fontWeight: 400, lineHeight: 1.8, color: "#333" }}>
          Buying back issues on eBay? Shipping costs can turn a $2 comic into a $10 purchase. But most sellers combine shipping —
          so if you can find one seller who has several issues you need, you save big. Comic Bundle Finder searches eBay for every
          issue on your want list, then ranks sellers by how many of your issues they carry. Paste your list, hit search, and find
          your best bundle deals in seconds.
        </div>
        <div className="panel">
          <div className="caption">Enter your missing issues</div>
          <div className="label-row">
            <label htmlFor="issue-input">Paste your list — one issue per line:</label>
            <button className="btn-upload" onClick={() => fileInputRef.current?.click()}>Upload want list</button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.txt" style={{ display: "none" }} onChange={onFileSelected} />
          </div>
          <div className={`drop-zone${isDragging ? " dragging" : ""}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
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
            <span className="or-text">— or —</span>
            <Link href="/collection-guides" className="btn-guides">Get Started with Collection Guides</Link>
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
            <div className="results-title">
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
                      ? "No seller has multiple copies or listings for this issue. Try checking back later."
                      : "No single seller carries more than one of your issues. You may need to buy these separately, or try broadening your search.")
                  : "No sellers match the current filters. Try adjusting or resetting them above."}
              </div>
            ) : (<>
              <div className="share-panel">
                <div className="share-title">Save or Share These Results</div>
                <div className="share-buttons">
                  <button className="btn-share" onClick={handleSaveResults} disabled={saving || !!savedId}>
                    {saving ? "Saving…" : savedId ? "✓ Saved" : "💾 Save Results"}
                  </button>
                  <button className="btn-share-email" onClick={() => { setShowEmailForm(f => !f); setEmailMsg(""); }}>
                    ✉ Email Results
                  </button>
                </div>
                {savedId && (
                  <div className="share-url-row">
                    <input className="share-url-input" readOnly value={`https://comicbundlefinder.com/results/${savedId}`} onClick={e => e.target.select()} />
                    <button className="btn-copy" onClick={handleCopyLink}>{shareMsg === "Copied!" ? "✓ Copied" : "Copy Link"}</button>
                  </div>
                )}
                {shareMsg && shareMsg !== "Copied!" && <span className="share-feedback">{shareMsg}</span>}
                {showEmailForm && (
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
                      <span className="bundle-badge">{singleIssueMode ? `${data.bundle_count} copies available` : `${data.bundle_count} issues`} — bundle shipping!</span>
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
                            <td className="col-issue">
                              {esc(l.issue)}
                              {(l.quantity || 1) > 1 && <span className="qty-badge">×{l.quantity} avail.</span>}
                            </td>
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
      </>)}

      {activeTab === "analyzer" && (
        <div className="panel">
          <div className="caption">Gap Analyzer</div>
          <p style={{ fontSize: "0.88rem", fontWeight: 400, lineHeight: 1.8, color: "#333", marginBottom: "1.25rem" }}>
            Upload your collection export to find gaps in your runs — issues you&rsquo;re missing between ones you own.
            The analyzer groups your collection by series and finds small gaps worth filling.
          </p>

          <div
            className={`gap-upload-area${isCollectionDragging ? " dragging" : ""}`}
            onDragOver={onCollectionDragOver}
            onDragLeave={onCollectionDragLeave}
            onDrop={onCollectionDrop}
          >
            <div className="gap-upload-contents">
              <button className="btn-upload" style={{ fontSize: "0.88rem", padding: "0.4rem 1.25rem" }} onClick={() => collectionFileInputRef.current?.click()}>
                Upload Collection File
              </button>
              <p>League of Comic Geeks (.xlsx), CLZ (.csv), or plain text (.txt) — or drag and drop here</p>
            </div>
            <input ref={collectionFileInputRef} type="file" accept=".xlsx,.xls,.csv,.txt" style={{ display: "none" }} onChange={onCollectionFileSelected} />
            <div className="gap-drag-overlay">Drop file here</div>
          </div>

          {collectionMsg && <div className="upload-msg" style={{ marginBottom: "1rem" }}>✓ {collectionMsg}</div>}

          {collectionItems && (
            <>
              <div className="threshold-row">
                <span className="threshold-label">Max gap to fill: {gapThreshold} issue{gapThreshold === 1 ? "" : "s"}</span>
                <button className="btn-toggle" onClick={() => setShowSlider(s => !s)}>
                  {showSlider ? "hide" : "adjust"}
                </button>
                {showSlider && (
                  <input
                    className="threshold-slider"
                    type="range" min="1" max="20" value={gapThreshold}
                    onChange={e => onThresholdChange(parseInt(e.target.value, 10))}
                  />
                )}
              </div>

              {gaps !== null && (
                <>
                  <div className="gap-results-header">
                    {gaps.length === 0 ? "No Gaps Found" : `${gaps.length} Gap Issue${gaps.length === 1 ? "" : "s"} Found`}
                  </div>
                  {gaps.length === 0 ? (
                    <div className="gap-empty">No gaps of {gapThreshold} or fewer issues found in your collection. Try increasing the threshold.</div>
                  ) : (
                    <>
                      <textarea readOnly value={gaps.join("\n")} style={{ height: "200px" }} />
                      <div className="gap-actions">
                        <button className="btn-gap-secondary" onClick={copyGaps}>Copy to Clipboard</button>
                        {copyMsg && <span className="copy-msg">{copyMsg}</span>}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      <div className="panel" style={{ textAlign: "center", fontSize: "0.8rem", fontWeight: 400, color: "#666", padding: "0.85rem 1.75rem" }}>
        Bugs? Feature requests? Email us at <a href="mailto:hello@comicbundlefinder.com" style={{ color: "#003399", fontWeight: 600 }}>hello@comicbundlefinder.com</a>
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
  </>);
}
