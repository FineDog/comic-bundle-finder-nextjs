import { getServerSideProps as authProps } from "@/lib/auth-guard";
import { signOut, useSession } from "next-auth/react";
import { useState, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import * as XLSX from "xlsx";

export { authProps as getServerSideProps };

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

async function parseWishlistFile(file) {
  const n = file.name.toLowerCase();
  if (n.endsWith(".xlsx") || n.endsWith(".xls")) {
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
  if (n.endsWith(".csv")) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return { issues: [], count: 0 };
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
    const si = headers.indexOf("series"), ii = headers.indexOf("issue"), di = headers.indexOf("release date");
    if (si === -1 || ii === -1) return { issues: [], count: 0 };
    const issues = [];
    for (let i = 1; i < lines.length; i++) {
      const c = parseCSVLine(lines[i]);
      const s = c[si]?.trim() || ""; const num = c[ii]?.trim() || ""; const y = di >= 0 ? yearFromDateString(c[di]?.trim() || "") : "";
      const parsed = String(num).match(/^(\d+)/);
      if (s && parsed) issues.push(`${s} #${parsed[1]}${y ? ` (${y})` : ""}`);
    }
    return { issues, count: issues.length };
  }
  return { issues: [], count: 0 };
}

export default function Account() {
  const { data: session } = useSession();
  const [locgUsername, setLocgUsername] = useState("");
  const [savedUsername, setSavedUsername] = useState("");
  const [editingUsername, setEditingUsername] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [wishlistItems, setWishlistItems] = useState([]);
  const fileInputRef = useRef(null);

  async function handleFile(file) {
    setUploadMsg("Reading file…");
    try {
      const result = await parseWishlistFile(file);
      if (!result.count) { setUploadMsg("No wish list items found in that file."); return; }
      setWishlistItems(result.issues);
      setUploadMsg(`✓ Loaded ${result.count} wish list item${result.count === 1 ? "" : "s"}.`);
    } catch { setUploadMsg("Could not read that file."); }
  }

  function onDrop(e) { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }
  function onDragOver(e) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave() { setIsDragging(false); }
  function onFileSelected(e) { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }

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
        .locg-username{display:flex;align-items:center;gap:0.6rem;margin-bottom:1rem;flex-wrap:wrap}
        .locg-username input{border:2px solid #1a1a1a;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:0.95rem;padding:0.45rem 0.65rem;color:#1a1a1a;flex:1;min-width:0}
        .locg-username input:focus{outline:none;border-color:#003399;box-shadow:2px 2px 0 #003399}
        .btn-save{background:#003399;color:#fffdf4;border:2px solid #1a1a1a;box-shadow:2px 2px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.82rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.45rem 0.9rem;cursor:pointer;white-space:nowrap}
        .btn-save:hover{background:#0044cc}
        .btn-edit{background:#fffdf4;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:2px 2px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.3rem 0.7rem;cursor:pointer}
        .btn-edit:hover{background:#ffe066}
        .username-display{font-size:1rem;font-weight:600;letter-spacing:0.5px}
        .locg-steps{margin:1rem 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:0.6rem}
        .locg-steps li{display:flex;align-items:flex-start;gap:0.6rem;font-size:0.88rem;line-height:1.5}
        .step-num{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;background:#1a1a1a;color:#ffe066;font-family:'Bangers',cursive;font-size:0.95rem;letter-spacing:1px;flex-shrink:0;margin-top:1px}
        .btn-locg{display:inline-block;background:#ffe066;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.82rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.35rem 0.85rem;text-decoration:none;cursor:pointer}
        .btn-locg:hover{background:#ffd700}
        .drop-zone{border:2px dashed #1a1a1a;padding:1.25rem;text-align:center;cursor:pointer;transition:background 0.15s;margin-top:0.75rem;background:#fffdf4}
        .drop-zone.dragging,.drop-zone:hover{background:#f0f4ff;border-color:#003399}
        .drop-zone-label{font-size:0.85rem;color:#555;font-weight:400}
        .upload-msg{font-size:0.82rem;font-weight:600;color:#003399;margin-top:0.6rem;letter-spacing:0.5px}
        .wishlist-preview{margin-top:1rem}
        .wishlist-preview-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem}
        .wishlist-preview textarea{width:100%;height:140px;border:2px solid #1a1a1a;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:0.82rem;padding:0.5rem;resize:vertical;color:#1a1a1a}
        .btn-search{display:inline-block;background:#cc1f00;color:#fffdf4;border:2px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.2rem;letter-spacing:2px;padding:0.4rem 1.2rem 0.5rem;text-decoration:none;margin-top:0.6rem}
        .btn-search:hover{background:#e02200}
      `}</style>
      <div className="container">
        <Link href="/" className="back">← Back to Comic Bundle Finder</Link>

        <div className="title-panel">
          <h1>My Account</h1>
          <div className="tagline">Manage your profile &amp; saved data</div>
        </div>

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
          <button className="btn-signout" onClick={() => signOut({ callbackUrl: "/" })}>
            Sign Out
          </button>
        </div>

        <div className="panel">
          <div className="caption">Saved Searches</div>
          <p className="placeholder-msg">Your saved searches will appear here. Coming soon.</p>
        </div>

        <div className="panel">
          <div className="caption">League of Comic Geeks</div>

          {!savedUsername && !editingUsername ? (
            <>
              <p className="placeholder-msg" style={{marginBottom:"0.85rem"}}>Enter your LOCG username to quickly import your wish list into the bundle search.</p>
              <button className="btn-save" onClick={() => setEditingUsername(true)}>Connect Account</button>
            </>
          ) : editingUsername ? (
            <div className="locg-username">
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
            <div style={{display:"flex",alignItems:"center",gap:"0.75rem",marginBottom:"1rem",flexWrap:"wrap"}}>
              <span className="username-display">@{savedUsername}</span>
              <button className="btn-edit" onClick={() => { setLocgUsername(savedUsername); setEditingUsername(true); }}>Edit</button>
            </div>
          )}

          {savedUsername && !editingUsername && (
            <>
              <ul className="locg-steps">
                <li>
                  <span className="step-num">1</span>
                  <span>
                    <a
                      className="btn-locg"
                      href={`https://leagueofcomicgeeks.com/profile/${savedUsername}/import-comics`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open my LOCG Wish List ↗
                    </a>
                  </span>
                </li>
                <li>
                  <span className="step-num">2</span>
                  <span>Click <strong>Export</strong> and download the file.</span>
                </li>
                <li>
                  <span className="step-num">3</span>
                  <span>Drop the file below — we'll convert it to a search list instantly.</span>
                </li>
              </ul>

              <div
                className={`drop-zone${isDragging ? " dragging" : ""}`}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="drop-zone-label">Drop your LOCG export here, or click to browse</div>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={onFileSelected} />
              </div>

              {uploadMsg && <div className="upload-msg">{uploadMsg}</div>}

              {wishlistItems.length > 0 && (
                <div className="wishlist-preview">
                  <div className="wishlist-preview-header">
                    <span style={{fontSize:"0.82rem",fontWeight:600,letterSpacing:"0.5px"}}>{wishlistItems.length} items ready</span>
                  </div>
                  <textarea readOnly value={wishlistItems.join("\n")} />
                  <Link
                    href={`/?wishlist=${encodeURIComponent(wishlistItems.join("\n"))}`}
                    className="btn-search"
                  >
                    Search eBay for Bundles →
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
