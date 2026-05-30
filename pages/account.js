import { getServerSideProps as authProps } from "@/lib/auth-guard";
import { signOut, useSession } from "next-auth/react";
import { useState, useRef, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import * as XLSX from "xlsx";

export { authProps as getServerSideProps };

// ── Parsers ───────────────────────────────────────────────────────────────────

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

// League of Comic Geeks XLSX export
async function parseLOCGFile(file) {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  if (!rows.length) return { issues: [], count: 0 };
  const wl = rows.filter(r => Number(r["In Wish List"]) >= 1);
  const issues = wl.map(r => {
    const t = String(r["Full Title"] || "").trim();
    const y = yearFromDateString(String(r["Release Date"] || ""));
    return y ? `${t} (${y})` : t;
  }).filter(Boolean);
  return { issues, count: issues.length };
}

function cleanSeriesName(name) {
  return name
    .replace(/\s*\(Vol\.\s*\d+\)/gi, "")
    .replace(/,?\s*Vol\.\s*\d+/gi, "")
    .replace(/\s*\(\d{4}\s*[-–]\s*(?:\d{4}|[Pp]resent)\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// CLZ CSV export (with Collection Status column added via Manage Columns)
async function parseCLZFile(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { issues: [], count: 0 };
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  const si = headers.indexOf("series");
  const ii = headers.indexOf("issue");
  const di = headers.findIndex(h => h.includes("release date") || h === "date");
  const ci = headers.findIndex(h => h.includes("collection status") || h === "status");
  if (si === -1 || ii === -1) return { issues: [], count: 0, error: "Could not find Series or Issue columns." };
  const issues = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCSVLine(lines[i]);
    // If Collection Status column exists, only include Wish List rows
    if (ci >= 0) {
      const status = (c[ci] || "").toLowerCase();
      if (!status.includes("wish")) continue;
    }
    const s = cleanSeriesName(c[si]?.trim() || "");
    const num = c[ii]?.trim() || "";
    const y = di >= 0 ? yearFromDateString(c[di]?.trim() || "") : "";
    const parsed = String(num).match(/^(\d+)/);
    if (s && parsed) issues.push(`${s} #${parsed[1]}${y ? ` (${y})` : ""}`);
  }
  return { issues, count: issues.length };
}

// Plain file: one issue per line, passed through as-is
async function parsePlainFile(file) {
  const n = file.name.toLowerCase();
  let text = "";
  if (n.endsWith(".xlsx") || n.endsWith(".xls")) {
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
    text = rows.map(r => String(r[0] || "").trim()).filter(Boolean).join("\n");
  } else {
    text = await file.text();
  }
  const issues = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return { issues, count: issues.length };
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
}

// ── Drop zone hook ────────────────────────────────────────────────────────────

function useDropZone(onFile) {
  const [isDragging, setIsDragging] = useState(false);
  const ref = useRef(null);
  function onDrop(e) { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }
  function onDragOver(e) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave() { setIsDragging(false); }
  function onFileSelected(e) { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }
  return { isDragging, ref, onDrop, onDragOver, onDragLeave, onFileSelected };
}

// ── Saved summary ─────────────────────────────────────────────────────────────

function SavedSummary({ saved, label, onUpdate, drop, accept, uploadingMsg }) {
  const [showDrop, setShowDrop] = useState(false);
  if (!saved?.items?.length && !uploadingMsg) return null;
  if (uploadingMsg) return <div className="upload-msg">{uploadingMsg}</div>;
  return (
    <div>
      <div className="saved-summary">
        <span>✓ {saved.items.length} {label} item{saved.items.length === 1 ? "" : "s"} saved · Last updated {formatDate(saved.updatedAt)}</span>
        <button className="btn-edit" onClick={() => setShowDrop(v => !v)}>Update</button>
      </div>
      {showDrop && (
        <div>
          <div
            className={`drop-zone${drop.isDragging ? " dragging" : ""}`}
            onDragOver={drop.onDragOver} onDragLeave={drop.onDragLeave} onDrop={e => { drop.onDrop(e); setShowDrop(false); }}
            onClick={() => drop.ref.current?.click()}
          >
            <div className="drop-zone-label">Drop new file here, or click to browse</div>
            <input ref={drop.ref} type="file" accept={accept} style={{display:"none"}} onChange={e => { drop.onFileSelected(e); setShowDrop(false); }} />
          </div>
        </div>
      )}
      <Link href={`/?wishlist=${encodeURIComponent(saved.items.join("\n"))}`} className="btn-search">
        Search eBay for Bundles →
      </Link>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Account() {
  const { data: session } = useSession();

  // Digest preferences
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestLastSent, setDigestLastSent] = useState(null);

  // LOCG state — { items, updatedAt, username } or null
  const [locgSaved, setLocgSaved] = useState(null);
  const [locgUsername, setLocgUsername] = useState("");
  const [savedUsername, setSavedUsername] = useState("");
  const [editingUsername, setEditingUsername] = useState(false);
  const [locgUploading, setLocgUploading] = useState("");

  // CLZ state — { items, updatedAt } or null
  const [clzSaved, setClzSaved] = useState(null);
  const [clzUploading, setClzUploading] = useState("");

  // Plain upload state — { items, updatedAt } or null
  const [plainSaved, setPlainSaved] = useState(null);
  const [plainUploading, setPlainUploading] = useState("");

  // Load saved lists on mount
  useEffect(() => {
    fetch("/api/user/lists")
      .then(r => r.json())
      .then(data => {
        if (data.locg?.items?.length) {
          setLocgSaved(data.locg);
          if (data.locg.username) setSavedUsername(data.locg.username);
        }
        if (data.clz?.items?.length)    setClzSaved(data.clz);
        if (data.manual?.items?.length) setPlainSaved(data.manual);
        setDigestEnabled(data.digest_enabled ?? false);
        setDigestLastSent(data.digest_last_sent ?? null);
      })
      .catch(() => {});
  }, []);

  async function toggleDigest(enabled) {
    setDigestEnabled(enabled);
    try {
      await fetch("/api/user/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digest_enabled: enabled }),
      });
    } catch {}
  }

  async function saveList(source, items, extra = {}) {
    try {
      await fetch("/api/user/lists", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, items, ...extra }),
      });
    } catch {}
  }

  async function handleLOCGFile(file) {
    setLocgUploading("Reading file…");
    try {
      const r = await parseLOCGFile(file);
      if (!r.count) { setLocgUploading("No wish list items found. Make sure this is your LOCG export."); return; }
      const updatedAt = new Date().toISOString();
      setLocgSaved({ items: r.issues, updatedAt, username: savedUsername });
      setLocgUploading("");
      saveList("locg", r.issues, { username: savedUsername });
    } catch { setLocgUploading("Could not read that file."); }
  }

  async function handleCLZFile(file) {
    setClzUploading("Reading file…");
    try {
      const r = await parseCLZFile(file);
      if (r.error) { setClzUploading(r.error); return; }
      if (!r.count) { setClzUploading("No wish list items found. Make sure you added the Collection Status column (Step 3 above)."); return; }
      const updatedAt = new Date().toISOString();
      setClzSaved({ items: r.issues, updatedAt });
      setClzUploading("");
      saveList("clz", r.issues);
    } catch { setClzUploading("Could not read that file."); }
  }

  async function handlePlainFile(file) {
    setPlainUploading("Reading file…");
    try {
      const r = await parsePlainFile(file);
      if (!r.count) { setPlainUploading("No items found in that file."); return; }
      const updatedAt = new Date().toISOString();
      setPlainSaved({ items: r.issues, updatedAt });
      setPlainUploading("");
      saveList("manual", r.issues);
    } catch { setPlainUploading("Could not read that file."); }
  }

  const locgDrop = useDropZone(handleLOCGFile);
  const clzDrop = useDropZone(handleCLZFile);
  const plainDrop = useDropZone(handlePlainFile);

  return (
    <>
      <Head>
        <title>Account — Comic Bundle Finder</title>
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem}
        .container{max-width:720px;margin:0 auto}
        .title-panel{background:#cc1f00;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;text-align:center;padding:1.25rem 1.75rem 1rem;margin-bottom:1.75rem}
        .title-panel h1{font-family:'Bangers',cursive;font-size:2.5rem;color:#fffdf4;letter-spacing:4px;text-shadow:4px 4px 0 #1a1a1a;line-height:1}
        .tagline{color:#ffe066;font-size:0.8rem;letter-spacing:2px;text-transform:uppercase;margin-top:0.4rem}
        .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.75rem}
        .caption{display:inline-block;background:#ffe066;border:2px solid #1a1a1a;padding:0.3rem 0.7rem;font-size:0.8rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:1rem}
        .user-info{display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem}
        .avatar{width:52px;height:52px;border:2px solid #1a1a1a;border-radius:50%;object-fit:cover}
        .avatar-placeholder{width:52px;height:52px;border:2px solid #1a1a1a;background:#ffe066;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bangers',cursive;font-size:1.4rem;color:#1a1a1a}
        .user-name{font-size:1.1rem;font-weight:600;letter-spacing:1px}
        .user-email{font-size:0.85rem;color:#555;font-weight:400}
        .tier-badge{display:inline-block;background:#003399;color:#fffdf4;border:2px solid #1a1a1a;padding:0.2rem 0.65rem;font-size:0.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-left:0.5rem}
        .btn-signout{background:#fffdf4;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.85rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.4rem 1rem;cursor:pointer}
        .btn-signout:hover{background:#ffe066}
        .back{display:inline-block;color:#003399;text-decoration:none;font-size:0.85rem;font-weight:600;margin-bottom:1.5rem}
        .back:hover{text-decoration:underline}
        .placeholder-msg{color:#888;font-size:0.88rem;font-weight:400;line-height:1.7}
        .input-row{display:flex;align-items:center;gap:0.6rem;margin-bottom:1rem;flex-wrap:wrap}
        .input-row input{border:2px solid #1a1a1a;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:0.95rem;padding:0.45rem 0.65rem;color:#1a1a1a;flex:1;min-width:0}
        .input-row input:focus{outline:none;border-color:#003399;box-shadow:2px 2px 0 #003399}
        .btn-save{background:#003399;color:#fffdf4;border:2px solid #1a1a1a;box-shadow:2px 2px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.82rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.45rem 0.9rem;cursor:pointer;white-space:nowrap}
        .btn-save:hover{background:#0044cc}
        .btn-edit{background:#fffdf4;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:2px 2px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.3rem 0.7rem;cursor:pointer}
        .btn-edit:hover{background:#ffe066}
        .username-display{font-size:1rem;font-weight:600;letter-spacing:0.5px}
        .steps{margin:1rem 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:0.75rem}
        .steps li{display:flex;align-items:flex-start;gap:0.65rem;font-size:0.88rem;line-height:1.55}
        .step-num{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;background:#1a1a1a;color:#ffe066;font-family:'Bangers',cursive;font-size:0.95rem;letter-spacing:1px;flex-shrink:0;margin-top:1px}
        .step-note{display:block;margin-top:0.3rem;background:#fffbe6;border:1px solid #e0c840;padding:0.35rem 0.6rem;font-size:0.8rem;color:#555;line-height:1.5}
        .btn-external{display:inline-block;background:#ffe066;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.82rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.35rem 0.85rem;text-decoration:none;cursor:pointer}
        .btn-external:hover{background:#ffd700}
        .drop-zone{border:2px dashed #1a1a1a;padding:1.25rem;text-align:center;cursor:pointer;transition:background 0.15s;margin-top:0.75rem;background:#fffdf4}
        .drop-zone.dragging,.drop-zone:hover{background:#f0f4ff;border-color:#003399}
        .drop-zone-label{font-size:0.85rem;color:#555;font-weight:400}
        .upload-msg{font-size:0.82rem;font-weight:600;color:#003399;margin-top:0.6rem;letter-spacing:0.5px}
        .wishlist-preview{margin-top:1rem}
        .wishlist-preview-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem}
        .wishlist-preview textarea{width:100%;height:140px;border:2px solid #1a1a1a;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:0.82rem;padding:0.5rem;resize:vertical;color:#1a1a1a}
        .btn-search{display:inline-block;background:#cc1f00;color:#fffdf4;border:2px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.2rem;letter-spacing:2px;padding:0.4rem 1.2rem 0.5rem;text-decoration:none;margin-top:0.6rem}
        .btn-search:hover{background:#e02200}
        .plain-hint{font-size:0.82rem;color:#888;margin-bottom:0.75rem;line-height:1.6}
        code{background:#f0e6c4;border:1px solid #c8b98a;padding:0.1rem 0.35rem;font-size:0.8rem}
        .saved-summary{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:0.85rem;font-size:0.88rem;font-weight:600;color:#1a1a1a}
        .digest-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-top:1.1rem;padding-top:1.1rem;border-top:1px solid #e0d8c0}
        .digest-label{font-size:0.88rem;font-weight:600;letter-spacing:0.3px}
        .digest-meta{font-size:0.78rem;color:#888;font-weight:400;margin-top:0.15rem}
        .toggle{position:relative;display:inline-block;width:42px;height:24px;flex-shrink:0}
        .toggle input{opacity:0;width:0;height:0}
        .toggle-slider{position:absolute;inset:0;background:#ccc;border:2px solid #1a1a1a;cursor:pointer;transition:background 0.2s}
        .toggle-slider::before{content:'';position:absolute;width:14px;height:14px;left:3px;top:3px;background:#fffdf4;border:1px solid #1a1a1a;transition:transform 0.2s}
        .toggle input:checked + .toggle-slider{background:#003399}
        .toggle input:checked + .toggle-slider::before{transform:translateX(18px)}
      `}</style>

      <div className="container">
        <Link href="/" className="back">← Back to Comic Bundle Finder</Link>

        <div className="title-panel">
          <h1>My Account</h1>
          <div className="tagline">Manage your profile &amp; saved data</div>
        </div>

        {/* ── Profile ── */}
        <div className="panel">
          <div className="caption">Profile</div>
          <div className="user-info">
            {session?.user?.image ? (
              <img className="avatar" src={session.user.image} alt="" />
            ) : (
              <div className="avatar-placeholder">
                {(session?.user?.name || session?.user?.email || "?")[0].toUpperCase()}
              </div>
            )}
            <div>
              <div className="user-name">
                {session?.user?.name || session?.user?.email}
                <span className="tier-badge">{session?.user?.tier ?? "free"}</span>
              </div>
              {session?.user?.name && <div className="user-email">{session?.user?.email}</div>}
            </div>
          </div>
          <button className="btn-signout" onClick={() => signOut({ callbackUrl: "/" })}>Sign Out</button>

          <div className="digest-row">
            <div>
              <div className="digest-label">Daily bundle digest emails</div>
              <div className="digest-meta">
                {digestEnabled
                  ? digestLastSent
                    ? `Last sent ${formatDate(digestLastSent)}`
                    : "Will send tomorrow morning"
                  : "Get a daily email with eBay bundle opportunities from your saved lists"}
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={digestEnabled} onChange={e => toggleDigest(e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>

        {/* ── Saved Searches ── */}
        <div className="panel">
          <div className="caption">Saved Searches</div>
          <p className="placeholder-msg">Your saved searches will appear here. Coming soon.</p>
        </div>

        {/* ── League of Comic Geeks ── */}
        <div className="panel">
          <div className="caption">League of Comic Geeks</div>

          {locgSaved?.items?.length ? (
            <SavedSummary saved={locgSaved} label="wish list" onUpdate={() => {}} drop={locgDrop} accept=".xlsx,.xls,.csv" uploadingMsg={locgUploading} />
          ) : !savedUsername && !editingUsername ? (
            <>
              <p className="placeholder-msg" style={{marginBottom:"0.85rem"}}>Enter your LOCG username to quickly import your wish list into the bundle search.</p>
              <button className="btn-save" onClick={() => setEditingUsername(true)}>Connect Account</button>
            </>
          ) : editingUsername ? (
            <div className="input-row">
              <input
                type="text"
                placeholder="LOCG username"
                value={locgUsername}
                onChange={e => setLocgUsername(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && locgUsername.trim()) { setSavedUsername(locgUsername.trim()); setEditingUsername(false); }}}
                autoFocus
              />
              <button className="btn-save" onClick={() => { if (locgUsername.trim()) { setSavedUsername(locgUsername.trim()); setEditingUsername(false); }}}>Save</button>
              {savedUsername && <button className="btn-edit" onClick={() => setEditingUsername(false)}>Cancel</button>}
            </div>
          ) : (
            <>
              <div style={{display:"flex",alignItems:"center",gap:"0.75rem",marginBottom:"1rem",flexWrap:"wrap"}}>
                <span className="username-display">@{savedUsername}</span>
                <button className="btn-edit" onClick={() => { setLocgUsername(savedUsername); setEditingUsername(true); }}>Edit</button>
              </div>
              <ul className="steps">
                <li>
                  <span className="step-num">1</span>
                  <span>
                    <a className="btn-external" href={`https://leagueofcomicgeeks.com/profile/${savedUsername}/import-comics`} target="_blank" rel="noopener noreferrer">
                      Open my LOCG Wish List ↗
                    </a>
                  </span>
                </li>
                <li><span className="step-num">2</span><span>Click <strong>Export</strong> and download the file.</span></li>
                <li><span className="step-num">3</span><span>Drop the file below.</span></li>
              </ul>
              <div
                className={`drop-zone${locgDrop.isDragging ? " dragging" : ""}`}
                onDragOver={locgDrop.onDragOver} onDragLeave={locgDrop.onDragLeave} onDrop={locgDrop.onDrop}
                onClick={() => locgDrop.ref.current?.click()}
              >
                <div className="drop-zone-label">Drop your LOCG export here, or click to browse</div>
                <input ref={locgDrop.ref} type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={locgDrop.onFileSelected} />
              </div>
              {locgUploading && <div className="upload-msg">{locgUploading}</div>}
            </>
          )}
        </div>

        {/* ── CLZ ── */}
        <div className="panel">
          <div className="caption">CLZ Comics</div>
          {clzSaved?.items?.length ? (
            <SavedSummary saved={clzSaved} label="wish list" drop={clzDrop} accept=".csv" uploadingMsg={clzUploading} />
          ) : (
            <>
              <ul className="steps">
                <li><span className="step-num">1</span><span><a className="btn-external" href="https://app.clz.com/comics/login" target="_blank" rel="noopener noreferrer">Log in to CLZ ↗</a></span></li>
                <li><span className="step-num">2</span><span><a className="btn-external" href="https://app.clz.com/comics/export" target="_blank" rel="noopener noreferrer">Go to Export ↗</a></span></li>
                <li>
                  <span className="step-num">3</span>
                  <span>
                    Under <strong>Visible Columns</strong>, click <strong>Manage</strong> → <strong>Edit</strong> on the default "My List View columns" option. Scroll down, check <strong>Collection Status</strong> under the Personal section, then click Save.
                    <span className="step-note">⚠ This step is required so we can tell which items are on your wish list.</span>
                  </span>
                </li>
                <li><span className="step-num">4</span><span>Click <strong>Generate</strong> and download the file.</span></li>
                <li><span className="step-num">5</span><span>Drop the file below.</span></li>
              </ul>
              <div
                className={`drop-zone${clzDrop.isDragging ? " dragging" : ""}`}
                onDragOver={clzDrop.onDragOver} onDragLeave={clzDrop.onDragLeave} onDrop={clzDrop.onDrop}
                onClick={() => clzDrop.ref.current?.click()}
              >
                <div className="drop-zone-label">Drop your CLZ export here, or click to browse</div>
                <input ref={clzDrop.ref} type="file" accept=".csv" style={{display:"none"}} onChange={clzDrop.onFileSelected} />
              </div>
              {clzUploading && <div className="upload-msg">{clzUploading}</div>}
            </>
          )}
        </div>

        {/* ── Plain file upload ── */}
        <div className="panel">
          <div className="caption">Upload a List</div>
          {plainSaved?.items?.length ? (
            <SavedSummary saved={plainSaved} label="" drop={plainDrop} accept=".xlsx,.xls,.csv,.txt" uploadingMsg={plainUploading} />
          ) : (
            <>
              <p className="plain-hint">
                Upload any <code>.xlsx</code>, <code>.csv</code>, or <code>.txt</code> file with one issue per line.<br />
                Expected format: <code>Amazing Spider-Man #1 (1963)</code>
              </p>
              <div
                className={`drop-zone${plainDrop.isDragging ? " dragging" : ""}`}
                onDragOver={plainDrop.onDragOver} onDragLeave={plainDrop.onDragLeave} onDrop={plainDrop.onDrop}
                onClick={() => plainDrop.ref.current?.click()}
              >
                <div className="drop-zone-label">Drop your file here, or click to browse</div>
                <input ref={plainDrop.ref} type="file" accept=".xlsx,.xls,.csv,.txt" style={{display:"none"}} onChange={plainDrop.onFileSelected} />
              </div>
              {plainUploading && <div className="upload-msg">{plainUploading}</div>}
            </>
          )}
        </div>

      </div>
    </>
  );
}
