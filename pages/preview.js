import { useState, useRef } from "react";
import Head from "next/head";
import * as XLSX from "xlsx";

const STAGES = [
  { pct: 5,  msg: "Waking up the server…" },
  { pct: 12, msg: "Connecting to eBay…" },
  { pct: 22, msg: "Authenticating…" },
  { pct: 35, msg: "Searching eBay listings…" },
  { pct: 50, msg: "Checking seller inventories…" },
  { pct: 63, msg: "Filtering by price…" },
  { pct: 74, msg: "Verifying issue numbers…" },
  { pct: 83, msg: "Tallying bundle opportunities…" },
  { pct: 90, msg: "Sorting by seller…" },
  { pct: 94, msg: "Almost there…" },
];

// file parsing
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
  const d = new Date(s); return isNaN(d) ? "" : String(d.getFullYear());
}
async function parseComicGeeksXLSX(file) {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  if (!rows.length) return { issues: [], format: "unknown" };
  const isCG = "Full Title" in rows[0] && "In Wish List" in rows[0];
  if (!isCG) return { issues: rows.map(r => String(Object.values(r)[0]||"").trim()).filter(Boolean), format: "plain" };
  const wl = rows.filter(r => Number(r["In Wish List"]) >= 1);
  const issues = wl.map(r => { const t=String(r["Full Title"]||"").trim(); const y=yearFromDateString(String(r["Release Date"]||"")); return y?`${t} (${y})`:t; }).filter(Boolean);
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
    const c=parseCSVLine(lines[i]); const s=c[si]?.trim()||""
    const n=c[ii]?.trim()||""
    const y=di>=0?yearFromDateString(c[di]?.trim()||""): ""
    if (s&&n) issues.push(`${s} #${n}${y?` (${y})`:""}`)
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
function esc(s) { return String(s||""); }

export default function Preview() {
  const [issueInput,setIssueInput] = useState("");
  const [maxPrice,setMaxPrice] = useState("10");
  const [status,setStatus] = useState({msg:"",type:""});
  const [progress,setProgress] = useState({visible:false,pct:0,msg:""});
  const [dym,setDym] = useState(null);
  const [results,setResults] = useState(null);
  const [isDragging,setIsDragging] = useState(false);
  const [uploadMsg,setUploadMsg] = useState("");
  const timerRef = useRef(null);
  const pendingMaxPrice = useRef(10);
  const fileInputRef = useRef(null);

  async function handleFile(file) {
    setUploadMsg("Reading file…");
    try {
      const result = await parseFile(file);
      if (!result.issues.length) { setUploadMsg("No issues found in that file."); return; }
      setIssueInput(result.issues.join("\n")); setUploadMsg(formatLabel(result));
    } catch { setUploadMsg("Could not read that file. Make sure it is a valid xlsx, csv, or txt."); }
  }
  function onFileSelected(e) { const f=e.target.files?.[0]; if(f) handleFile(f); e.target.value=""; }
  function onDragOver(e) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave(e) { if(!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false); }
  function onDrop(e) { e.preventDefault(); setIsDragging(false); const f=e.dataTransfer.files?.[0]; if(f) handleFile(f); }

  function startProgress() {
    setProgress({visible:true,pct:0,msg:STAGES[0].msg}); let i=0;
    timerRef.current=setInterval(()=>{ i++; if(i<STAGES.length) setProgress({visible:true,pct:STAGES[i].pct,msg:STAGES[i].msg}); else clearInterval(timerRef.current); },6000);
  }
  function finishProgress(success) {
    clearInterval(timerRef.current);
    if(success){setProgress({visible:true,pct:100,msg:"Done!"});setTimeout(()=>setProgress(p=>({...p,visible:false})),800);}
    else setProgress(p=>({...p,visible:false}));
  }
  async function handleSearch() {
    const issues=issueInput.split("\n").map(l=>l.trim()).filter(Boolean);
    if(!issues.length){setStatus({msg:"Please enter at least one issue.",type:"error"});return;}
    pendingMaxPrice.current=parseFloat(maxPrice)||10;
    setStatus({msg:"",type:""}); setResults(null); setDym(null); setUploadMsg("");
    setStatus({msg:"Checking for typos…",type:"loading"});
    try {
      const vRes=await fetch("/api/validate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({issues})});
      const vData=await vRes.json(); setStatus({msg:"",type:""});
      if(vData.any_changed) setDym({corrections:vData.corrections,edits:vData.corrections.map(c=>c.suggested)});
      else executeSearch(issues);
    } catch { setStatus({msg:"",type:""}); executeSearch(issues); }
  }
  async function executeSearch(issues) {
    setDym(null); setResults(null); startProgress();
    try {
      const res=await fetch("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({issues,max_price:pendingMaxPrice.current})});
      const data=await res.json(); if(!res.ok) throw new Error(data.error||"Server error");
      finishProgress(true); setResults({rows:data.results,issueCount:issues.length});
    } catch(err){finishProgress(false);setStatus({msg:`Error: ${err.message}. Try again in a moment.`,type:"error"});}
  }
  function searchWithCorrections(){executeSearch(dym.edits.map(e=>e.trim()).filter(Boolean));}
  function searchWithOriginal(){executeSearch(issueInput.split("\n").map(l=>l.trim()).filter(Boolean));}
  function groupResults(rows){
    const s={};
    for(const r of rows){if(!s[r.seller])s[r.seller]={bundle_count:r.bundle_count,listings:[]};s[r.seller].listings.push(r);}
    for(const n of Object.keys(s)){if(s[n].bundle_count<2)delete s[n];}
    return s;
  }
  const sellers=results?groupResults(results.rows):{};
  const sellerCount=results?Object.keys(groupResults(results.rows)).length:0;
  const totalSellers=results?new Set(results.rows.map(r=>r.seller)).size:0;

  return (<>
    <Head>
      <title>Comic Bundle Finder — Find eBay Sellers With Multiple Issues You Need</title>
      <meta name="description" content="Search eBay for comic book bundle deals. Paste your want list and find sellers who carry multiple issues — save money on combined shipping instead of paying separately for each book." />
      <meta name="keywords" content="comic books, eBay comics, comic bundle, combined shipping, comic want list, back issues, comic collecting" />
      <meta property="og:title" content="Comic Bundle Finder" />
      <meta property="og:description" content="Find eBay sellers who carry multiple issues from your comic want list. Save on combined shipping." />
      <meta property="og:type" content="website" />
      <meta property="og:url" content="https://www.comicbundlefinder.com" />
      <meta name="robots" content="index, follow" />
      <meta name="google-site-verification" content="gk8gi9ve5gW7xgq_LqiuiLSwhH4I8k8JUbsYKYRK8V4" />
      <link rel="canonical" href="https://www.comicbundlefinder.com" />
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
      .price-row{display:flex;align-items:center;gap:0.75rem;margin-top:1rem;flex-wrap:wrap}
      .price-row label{margin:0;font-size:0.82rem;white-space:nowrap}
      .price-input{width:90px;border:2px solid #1a1a1a;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:0.95rem;font-weight:600;padding:0.3rem 0.5rem;color:#1a1a1a;text-align:center}
      .price-input:focus{outline:none;border-color:#003399;box-shadow:2px 2px 0 #003399}
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
      .dym-panel{background:#fffdf4;border:3px solid #003399;box-shadow:6px 6px 0 #003399;padding:1.25rem 1.5rem;margin-bottom:1.75rem}
      .dym-title{font-family:'Bangers',cursive;font-size:1.6rem;color:#003399;letter-spacing:2px;margin-bottom:0.5rem}
      .dym-subtitle{font-size:0.8rem;font-weight:400;color:#444;margin-bottom:1rem;line-height:1.5}
      .dym-row{display:flex;align-items:center;gap:0.6rem;margin-bottom:0.6rem;flex-wrap:wrap}
      .dym-original{font-size:0.85rem;color:#888;text-decoration:line-through;min-width:180px;font-weight:400}
      .dym-arrow{font-size:0.85rem;color:#003399;font-weight:600}
      .dym-edit{border:2px solid #003399;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:0.85rem;font-weight:600;padding:0.2rem 0.5rem;color:#1a1a1a;flex:1;min-width:160px}
      .dym-edit:focus{outline:none;box-shadow:2px 2px 0 #003399}
      .dym-unchanged{font-size:0.85rem;color:#666;font-weight:400;font-style:italic}
      .dym-buttons{display:flex;gap:0.75rem;margin-top:1.1rem;flex-wrap:wrap}
      .btn-accept{background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.3rem;letter-spacing:2px;padding:0.2rem 1.5rem 0.3rem;cursor:pointer;transition:transform 0.08s,box-shadow 0.08s}
      .btn-accept:hover{background:#0044cc}
      .btn-accept:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #1a1a1a}
      .btn-skip{background:#fffdf4;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.82rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.35rem 1rem;cursor:pointer}
      .btn-skip:hover{background:#f0e6c4}
      .stats-row{display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap}
      .stat-box{flex:1;min-width:110px;background:#ffe066;border:2px solid #1a1a1a;padding:0.6rem 1rem;text-align:center}
      .stat-number{font-family:'Bangers',cursive;font-size:2.2rem;color:#cc1f00;line-height:1}
      .stat-label{font-size:0.68rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#1a1a1a;margin-top:2px}
      .results-title{font-family:'Bangers',cursive;font-size:2rem;letter-spacing:2px;color:#cc1f00;margin-bottom:1.25rem}
      .seller-group{margin-bottom:1.75rem}
      .seller-header{background:#003399;color:#fffdf4;padding:0.5rem 0.75rem;display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;border:2px solid #1a1a1a;border-bottom:none}
      .seller-name{font-family:'Bangers',cursive;font-size:1.35rem;letter-spacing:1px}
      .bundle-badge{background:#cc1f00;color:#fffdf4;font-size:0.68rem;font-weight:600;padding:2px 8px;border:1.5px solid #1a1a1a;letter-spacing:1px;text-transform:uppercase;white-space:nowrap}
      .subtotal-badge{font-size:0.78rem;font-weight:600;color:#fffdf4;background:#003399;border:1.5px solid #ffe066;padding:2px 8px;letter-spacing:0.5px;white-space:nowrap}
      .listings-table{width:100%;border-collapse:collapse;border:2px solid #1a1a1a;font-size:0.82rem;table-layout:fixed}
      .listings-table th{background:#1a1a1a;color:#fffdf4;padding:0.4rem 0.6rem;text-align:left;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;font-size:0.7rem;white-space:nowrap}
      .listings-table td{padding:0.45rem 0.6rem;border-bottom:1px solid #d4c9a8;vertical-align:top;font-weight:400;overflow:hidden;text-overflow:ellipsis;word-break:break-word}
      .listings-table tr:last-child td{border-bottom:none}
      .listings-table tr:nth-child(even) td{background:#f8f3e3}
      .col-issue{width:22%}.col-title{width:38%}.col-price{width:9%;text-align:right}.col-ship{width:11%;text-align:right}.col-promo{width:11%}.col-link{width:9%;text-align:center}
      .listing-link{color:#cc1f00;font-weight:600;text-decoration:none;white-space:nowrap;font-size:0.8rem}
      .listing-link:hover{text-decoration:underline}
      .promo-pill{display:inline-block;background:#cc1f00;color:#fffdf4;font-size:0.65rem;font-weight:600;padding:1px 5px;letter-spacing:0.5px;text-transform:uppercase;line-height:1.6}
      .no-results{text-align:center;padding:2rem;color:#666;font-size:0.95rem;font-weight:400}
      .disclosure{font-size:0.72rem;color:#888;text-align:center;font-weight:400;margin-top:1.25rem;line-height:1.5;border-top:1px solid #d4c9a8;padding-top:0.75rem}
      @media(max-width:600px){.col-title{display:none}.col-issue{width:40%}}
    `}</style>
    <div className="container">
      <div className="panel title-panel">
        <h1>Comic Bundle Finder</h1>
        <div className="tagline">Find sellers with multiple issues you need &mdash; save on shipping</div>
      </div>
      <div className="panel" style={{fontSize:"0.88rem",fontWeight:400,lineHeight:1.8,color:"#333"}}>
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
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.txt" style={{display:"none"}} onChange={onFileSelected} />
        </div>
        <div className={`drop-zone${isDragging ? " dragging" : ""}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
          <textarea id="issue-input" value={issueInput} onChange={e=>{setIssueInput(e.target.value);setUploadMsg("");}} placeholder={"Batgirl: Year One #2
Black Widow #10
Black Widow #11 (2014)"} />
          <div className="drag-overlay">Drop file here</div>
        </div>
        {uploadMsg && <div className="upload-msg">✓ {uploadMsg}</div>}
        <div className="hint">
          Type issues manually, or upload a .xlsx / .csv / .txt want list from League of Comic Geeks or CLZ.<br />
          Format: Series Name #Number — e.g. &ldquo;Amazing Spider-Man #300&rdquo; or &ldquo;Black Widow #10 (2014)&rdquo;
        </div>
        <div className="price-row">
          <label htmlFor="max-price">Max price per issue:</label>
          <span style={{fontWeight:600,fontSize:"0.95rem"}}>$</span>
          <input className="price-input" type="number" id="max-price" value={maxPrice} onChange={e=>setMaxPrice(e.target.value)} min="0.01" max="999" step="0.50" />
          <span className="hint" style={{margin:0}}>(listings above this price are excluded)</span>
        </div>
        <button className="btn-search" onClick={handleSearch} disabled={progress.visible}>Find Bundles!</button>
        {status.msg && <div className={status.type==="error"?"s-error":"s-loading"}>{status.msg}</div>}
        {progress.visible && (
          <div className="progress-wrap">
            <div className="progress-msg">{progress.msg}</div>
            <div className="progress-track">
              <div className="progress-fill" style={{width:`${progress.pct}%`}} />
              <div className="progress-pct">{progress.pct}%</div>
            </div>
          </div>
        )}
      </div>
      {dym && (
        <div className="dym-panel">
          <div className="dym-title">Did You Mean...?</div>
          <div className="dym-subtitle">We found some possible typos in your list. Review the suggestions below — edit any you disagree with — then click &ldquo;Search with corrections&rdquo; to proceed.</div>
          {dym.corrections.map((c,i) => (
            <div className="dym-row" key={i}>
              {c.changed ? (<>
                <span className="dym-original">{c.original}</span>
                <span className="dym-arrow">→</span>
                <input className="dym-edit" type="text" value={dym.edits[i]} onChange={e=>{const edits=[...dym.edits];edits[i]=e.target.value;setDym({...dym,edits});}} />
              </>) : (<span className="dym-unchanged">{c.original} — looks good</span>)}
            </div>
          ))}
          <div className="dym-buttons">
            <button className="btn-accept" onClick={searchWithCorrections}>Search with corrections</button>
            <button className="btn-skip" onClick={searchWithOriginal}>Search as originally entered</button>
          </div>
        </div>
      )}
      {results && (
        <div className="panel">
          <div className="results-title">{Object.keys(sellers).length===0?"No Bundle Opportunities Found":"Results — Sellers Ranked by Bundle Count"}</div>
          {Object.keys(sellers).length===0 ? (
            <div className="no-results">No single seller carries more than one of your issues. You may need to buy these separately, or try broadening your search.</div>
          ) : (<>
            <div className="stats-row">
              <div className="stat-box"><div className="stat-number">{results.issueCount}</div><div className="stat-label">Issues Searched</div></div>
              <div className="stat-box"><div className="stat-number">{totalSellers}</div><div className="stat-label">Total Sellers Found</div></div>
              <div className="stat-box"><div className="stat-number">{sellerCount}</div><div className="stat-label">Bundle Opportunities</div></div>
            </div>
            {Object.entries(sellers).map(([name,data]) => {
              const cpi={};
              for(const l of data.listings){const p=parseFloat(l.price)||0;if(!(l.issue in cpi)||p<cpi[l.issue])cpi[l.issue]=p;}
              const subtotal=Object.values(cpi).reduce((a,b)=>a+b,0);
              return (
                <div className="seller-group" key={name}>
                  <div className="seller-header">
                    <span className="seller-name">{esc(name)}</span>
                    <span className="bundle-badge">{data.bundle_count} issues — bundle shipping!</span>
                    <span className="subtotal-badge">from ${subtotal.toFixed(2)} in items</span>
                  </div>
                  <table className="listings-table">
                    <thead><tr>
                      <th className="col-issue">Issue You Need</th>
                      <th className="col-title">Listing Title</th>
                      <th className="col-price">Price</th>
                      <th className="col-ship">Shipping</th>
                      <th className="col-promo">Promo</th>
                      <th className="col-link">Link</th>
                    </tr></thead>
                    <tbody>
                      {data.listings.map((l,i)=>{
                        const ship=l.shipping==="0.00"?"FREE":l.shipping==="unknown"?"—":`$${parseFloat(l.shipping).toFixed(2)}`;
                        return (<tr key={i}>
                          <td className="col-issue">{esc(l.issue)}</td>
                          <td className="col-title">{esc(l.title)}</td>
                          <td className="col-price">${parseFloat(l.price).toFixed(2)}</td>
                          <td className="col-ship">{ship}</td>
                          <td className="col-promo">{l.promotions?<span className="promo-pill">{l.promotions.split("|")[0].trim()}</span>:""}</td>
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
    </div>
  </>);
}
