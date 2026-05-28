import Head from "next/head";
import Link from "next/link";
import SiteNav from "../../components/SiteNav";

export default function CharacterPage({ char, error }) {
  const title = char
    ? `${char.name} — Character Guide | Comic Bundle Finder`
    : "Character Not Found | Comic Bundle Finder";

  return (
    <>
      <Head>
        <title>{title}</title>
        {char && (
          <meta
            name="description"
            content={char.desc || `Find eBay bundle deals for comics featuring ${char.name}.`}
          />
        )}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem}

        .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.75rem}
        .panel-slim{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;padding:0.6rem 1.25rem;margin-bottom:1.75rem}
        .caption{display:inline-block;background:#ffe066;border:2px solid #1a1a1a;padding:0.3rem 0.7rem;font-size:0.8rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:1.1rem}
        .back-link{font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#003399;text-decoration:none}
        .back-link:hover{text-decoration:underline}

        .char-header{background:#cc1f00;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.25rem 1.75rem 1.1rem;margin-bottom:1.75rem}
        .char-header-inner{display:flex;align-items:flex-start;gap:1.5rem;flex-wrap:wrap}
        .char-image{width:80px;height:80px;object-fit:cover;border:3px solid #1a1a1a;flex-shrink:0}
        .char-image-placeholder{width:80px;height:80px;background:#a81800;border:3px solid #1a1a1a;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:'Bangers',cursive;font-size:2rem;color:#ffe066}
        .char-name{font-family:'Bangers',cursive;font-size:clamp(2rem,7vw,3.2rem);color:#fffdf4;letter-spacing:4px;text-shadow:3px 3px 0 #1a1a1a;line-height:1}
        .char-sub{color:#ffe066;font-size:0.82rem;letter-spacing:2px;text-transform:uppercase;font-weight:400;margin-top:0.35rem}

        .section-label{font-size:0.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-bottom:0.5rem}
        .desc{font-size:0.88rem;font-weight:400;line-height:1.8;color:#333}
        .tag-list{display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.35rem}
        .tag{display:inline-block;background:#f0e6c4;border:1.5px solid #1a1a1a;padding:0.15rem 0.6rem;font-size:0.75rem;font-weight:600;letter-spacing:0.5px}

        .btn-primary{display:inline-block;background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.15rem;letter-spacing:2px;padding:0.35rem 1.4rem 0.45rem;text-decoration:none;white-space:nowrap;transition:transform 0.08s,box-shadow 0.08s}
        .btn-primary:hover{background:#0044cc}
        .btn-primary:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #1a1a1a}
        .btn-secondary{display:inline-block;background:#fffdf4;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.82rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.3rem 0.9rem;text-decoration:none;white-space:nowrap;transition:transform 0.08s,box-shadow 0.08s}
        .btn-secondary:hover{background:#f0e6c4}
        .btn-secondary:active{transform:translate(2px,2px);box-shadow:1px 1px 0 #1a1a1a}
        .cta-row{display:flex;gap:0.85rem;align-items:center;flex-wrap:wrap;margin-top:0.5rem}
        .error-state{text-align:center;padding:2rem;color:#cc1f00;font-weight:600}
      `}</style>

      <div className="page-wrap">
        <SiteNav />

        <div className="panel-slim">
          <Link href="/collection-guides" className="back-link">← Collection Guides</Link>
        </div>

        {error && (
          <div className="panel">
            <div className="error-state">Could not load character — {error}</div>
          </div>
        )}

        {char && (
          <>
            <div className="char-header">
              <div className="char-header-inner">
                {char.image ? (
                  <img src={char.image} alt={char.name} className="char-image" />
                ) : (
                  <div className="char-image-placeholder">{char.name[0]}</div>
                )}
                <div>
                  <div className="char-name">{char.name}</div>
                  {char.alias?.length > 0 && (
                    <div className="char-sub">a.k.a. {char.alias.join(" · ")}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="caption">Find Bundle Deals</div>
              <p className="desc" style={{ marginBottom: "1.1rem" }}>
                Use the Comic Bundle Finder to search eBay for sellers carrying multiple{" "}
                <strong>{char.name}</strong> issues — save on combined shipping instead of buying each one separately.
              </p>
              <div className="cta-row">
                <Link href="/" className="btn-primary">Find eBay Bundles &rarr;</Link>
                {char.resource_url && (
                  <a href={char.resource_url} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                    View on Metron ↗
                  </a>
                )}
              </div>
            </div>

            {(char.desc || char.teams?.length > 0 || char.creators?.length > 0) && (
              <div className="panel">
                {char.desc && (
                  <div style={{ marginBottom: (char.teams?.length > 0 || char.creators?.length > 0) ? "1.25rem" : 0 }}>
                    <div className="section-label">About</div>
                    <p className="desc">{char.desc}</p>
                  </div>
                )}
                {char.teams?.length > 0 && (
                  <div style={{ marginBottom: char.creators?.length > 0 ? "1.1rem" : 0 }}>
                    <div className="section-label">Teams</div>
                    <div className="tag-list">
                      {char.teams.map((t) => <span className="tag" key={t.id}>{t.name}</span>)}
                    </div>
                  </div>
                )}
                {char.creators?.length > 0 && (
                  <div>
                    <div className="section-label">Created By</div>
                    <div className="tag-list">
                      {char.creators.map((c) => <span className="tag" key={c.id}>{c.name}</span>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

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

export async function getServerSideProps({ params }) {
  const { id } = params;
  const auth = Buffer.from(
    `${process.env.METRON_USERNAME}:${process.env.METRON_PASSWORD}`
  ).toString("base64");

  try {
    const res = await fetch(`https://metron.cloud/api/character/${id}/`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return { props: { char: null, error: `Character not found (HTTP ${res.status})` } };
    const char = await res.json();
    return { props: { char, error: null } };
  } catch (e) {
    return { props: { char: null, error: "Could not reach Metron API" } };
  }
}
