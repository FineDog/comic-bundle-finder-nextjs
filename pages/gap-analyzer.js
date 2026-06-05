import { useState, useRef } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import * as XLSX from "xlsx";
import SiteNav from "../components/SiteNav";
import SiteFooter from "../components/SiteFooter";
import { parseCSVLine, monthYearFromDateString, yearAfterMonths, cleanSeriesName, parseIssueNum } from "../lib/parse-utils";
import { PremiumGate } from "../components/PremiumGate.js";

// ── Gap analysis parsers ──────────────────────────────────────────────────────

async function parseComicGeeksForGaps(file) {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  if (!rows.length) return { items: [], format: "unknown", count: 0 };
  if (!("Full Title" in rows[0])) {
    const items = rows.map(r => plainLineToItem(String(Object.values(r)[0] || "").trim())).filter(Boolean);
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

function track(event, data) {
  try { window?.umami?.track(event, data); } catch {}
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GapAnalyzer() {
  const router = useRouter();

  const [collectionMsg, setCollectionMsg] = useState("");
  const [collectionItems, setCollectionItems] = useState(null);
  const [gapThreshold, setGapThreshold] = useState(5);
  const [showSlider, setShowSlider] = useState(false);
  const [gaps, setGaps] = useState(null);
  const [copyMsg, setCopyMsg] = useState("");
  const [isCollectionDragging, setIsCollectionDragging] = useState(false);
  const collectionFileInputRef = useRef(null);

  async function handleCollectionFile(file) {
    setCollectionMsg("Reading file…");
    setGaps(null); setCopyMsg("");
    try {
      const result = await parseFileForGaps(file);
      if (result.format === "unsupported") { setCollectionMsg("Please upload a .xlsx (Comic Geeks), .csv (CLZ), or .txt file."); return; }
      if (!result.items.length) { setCollectionMsg("No collection issues found in that file."); return; }
      setCollectionItems(result.items);
      const label = formatCollectionLabel(result);
      setCollectionMsg(label || `Loaded ${result.count} issues.`);
      const foundGaps = analyzeGaps(result.items, gapThreshold);
      setGaps(foundGaps);
      track("gap_analysis_run", { source: result.format, gap_count: foundGaps.length });
    } catch { setCollectionMsg("Could not read that file."); }
  }

  function onCollectionFileSelected(e) { const f = e.target.files?.[0]; if (f) handleCollectionFile(f); e.target.value = ""; }
  function onCollectionDragOver(e) { e.preventDefault(); setIsCollectionDragging(true); }
  function onCollectionDragLeave(e) { if (!e.currentTarget.contains(e.relatedTarget)) setIsCollectionDragging(false); }
  function onCollectionDrop(e) { e.preventDefault(); setIsCollectionDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleCollectionFile(f); }

  function runGapSearch(gapList) {
    sessionStorage.setItem("gap_search", JSON.stringify(gapList));
    track("search_started", { source: "gap_analyzer", issue_count: gapList.length });
    router.push("/");
  }

  function onThresholdChange(val) {
    setGapThreshold(val);
    if (!collectionItems) return;
    const foundGaps = analyzeGaps(collectionItems, val);
    setGaps(foundGaps);
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

  return (<>
    <Head>
      <title>Gap Analyzer — Comic Bundle Finder</title>
      <meta name="description" content="Upload your comic collection and find the gaps — missing issues between ones you already own. Then search eBay for bundle deals to fill them." />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
    </Head>
    <style>{`
      /* ── Page-specific: upload drop zone ───────────────────────── */
      .btn-upload{background:#fffdf4;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:2px 2px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.25rem 0.75rem;cursor:pointer;white-space:nowrap}
      .btn-upload:hover{background:#ffe066}
      .upload-msg{font-size:0.8rem;font-weight:600;color:#003399;margin-bottom:1rem;letter-spacing:0.5px}
      textarea{width:100%;height:200px;border:2px solid #1a1a1a;background:#fffdf4;font-family:'Courier New',monospace;font-size:1rem;padding:0.75rem;resize:vertical;color:#1a1a1a}
      textarea:focus{outline:none;border-color:#003399;box-shadow:2px 2px 0 #003399}
      .gap-upload-area{border:3px dashed #1a1a1a;background:#fffdf4;padding:2rem;text-align:center;margin-bottom:1.25rem;position:relative;transition:border-color 0.1s,background 0.1s}
      .gap-upload-area.dragging{border-color:#003399;background:#f0f4ff}
      .gap-upload-area p{font-size:1rem;font-weight:400;color:#555;margin-top:0.5rem}
      .gap-drag-overlay{display:none;position:absolute;inset:0;background:rgba(0,51,153,0.08);align-items:center;justify-content:center;font-family:'Bangers',cursive;font-size:1.4rem;letter-spacing:2px;color:#003399;pointer-events:none}
      .gap-upload-area.dragging .gap-drag-overlay{display:flex}
      .gap-upload-area.dragging .gap-upload-contents{visibility:hidden}

      /* ── Page-specific: threshold slider & results ─────────────── */
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
      .gap-empty{color:#666;font-size:1rem;font-weight:400;padding:1rem 0}
    `}</style>
    <div className="page-wrap">
      <SiteNav />
      <PremiumGate feature="gap-analyzer">
      <div className="panel">
        <div className="caption">Gap Analyzer</div>
        <p style={{ fontSize:"1rem", fontWeight: 400, lineHeight: 1.8, color: "#333", marginBottom: "1.25rem" }}>
          Upload your collection export to find gaps in your runs — issues you&rsquo;re missing between ones you own.
          The analyzer groups your collection by series and finds small gaps worth filling, then lets you search eBay for bundle deals to fill them.
        </p>

        <div
          className={`gap-upload-area${isCollectionDragging ? " dragging" : ""}`}
          onDragOver={onCollectionDragOver}
          onDragLeave={onCollectionDragLeave}
          onDrop={onCollectionDrop}
        >
          <div className="gap-upload-contents">
            <button className="btn-upload" style={{ fontSize:"1rem", padding: "0.4rem 1.25rem" }} onClick={() => collectionFileInputRef.current?.click()}>
              Upload Collection File
            </button>
            <p>League of Comic Geeks (.xlsx), CLZ (.csv), or plain text (.txt) — or drag and drop here</p>
          </div>
          <input ref={collectionFileInputRef} type="file" accept=".xlsx,.xls,.csv,.txt" style={{ display: "none" }} onChange={onCollectionFileSelected} />
          <div className="gap-drag-overlay">Drop file here</div>
        </div>

        {collectionMsg && <div className="upload-msg">✓ {collectionMsg}</div>}

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
                    <textarea readOnly value={gaps.join("\n")} />
                    <div className="gap-actions">
                      <button className="btn-gap-action" onClick={() => runGapSearch(gaps)}>Search eBay for These Gaps</button>
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
      </PremiumGate>
      <SiteFooter />
    </div>
  </>);
}
