import Head from "next/head";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import SiteNav from "../components/SiteNav";

const FREE_FEATURES = [
  "Unlimited manual searching",
  "Filter & sort results",
  "Collection Guides (series & arc pages)",
];

const PREMIUM_FEATURES = [
  { label: "Everything in Free", divider: true },
  "File upload (LOCG, CLZ, .csv, .txt)",
  "Gap Analyzer",
  "Save & share results",
  "Email results to yourself",
  "Daily digest email alerts",
  "Saved want lists",
  { label: "eBay Price Data", soon: true },
];

export default function Upgrade() {
  const { data: session, status } = useSession();
  const plan = session?.user?.plan ?? "free";
  const isPremium = plan === "premium";
  const loading = status === "loading";

  return (
    <>
      <Head>
        <title>Plans — Comic Bundle Finder</title>
        <meta name="description" content="Upgrade to Comic Bundle Finder Premium for file uploads, gap analysis, saved searches, email alerts, and more." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem}

        .plan-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:1.75rem;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a}
        @media(max-width:640px){.plan-grid{grid-template-columns:1fr}}

        .plan-card{background:#fffdf4;padding:1.75rem}
        .plan-card.premium{background:#fffbea;border-left:3px solid #1a1a1a}
        @media(max-width:640px){.plan-card.premium{border-left:none;border-top:3px solid #1a1a1a}}

        .plan-badge{display:inline-block;background:#1a1a1a;color:#ffe066;border:2px solid #1a1a1a;padding:0.25rem 0.65rem;font-size:0.68rem;font-weight:600;letter-spacing:2px;text-transform:uppercase;margin-bottom:0.75rem}
        .plan-badge.free{background:#fffdf4;color:#888;border-color:#ccc}

        .plan-name{font-family:'Bangers',cursive;font-size:2.4rem;letter-spacing:3px;line-height:1;margin-bottom:0.5rem}
        .plan-name.free-color{color:#888}
        .plan-name.premium-color{color:#cc1f00}

        .plan-price{margin-bottom:1.5rem;padding-bottom:1.25rem;border-bottom:2px solid #e0d8c0}
        .price-main{font-family:'Bangers',cursive;font-size:3rem;letter-spacing:1px;line-height:1;color:#1a1a1a}
        .price-sub{font-size:0.8rem;font-weight:400;color:#666;margin-top:0.25rem;line-height:1.5}
        .price-alt{font-size:0.85rem;font-weight:600;color:#003399;margin-top:0.2rem}

        .feature-list{list-style:none;margin-bottom:1.75rem;display:flex;flex-direction:column;gap:0.55rem}
        .feature-item{display:flex;align-items:flex-start;gap:0.6rem;font-size:0.88rem;font-weight:400;line-height:1.4}
        .feature-check{font-size:0.9rem;flex-shrink:0;margin-top:0.05rem}
        .feature-check.yes{color:#1a8a1a}
        .feature-check.no{color:#bbb}
        .feature-text.dimmed{color:#bbb}
        .feature-divider{font-family:'Bangers',cursive;font-size:1rem;letter-spacing:1px;color:#1a1a1a;margin-top:0.25rem;padding-bottom:0.1rem;border-bottom:1px dashed #ccc}
        .soon-pill{display:inline-block;background:#ffe066;border:1.5px solid #1a1a1a;padding:0.1rem 0.45rem;font-size:0.62rem;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-left:0.35rem;vertical-align:middle;line-height:1.4}

        .btn-primary{display:block;width:100%;background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.5rem;letter-spacing:2px;padding:0.5rem 1rem 0.6rem;cursor:pointer;text-align:center;text-decoration:none;transition:transform 0.08s,box-shadow 0.08s}
        .btn-primary:hover{background:#0044cc;transform:translate(-1px,-1px);box-shadow:5px 5px 0 #1a1a1a}
        .btn-primary:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #1a1a1a}
        .btn-primary:disabled,.btn-primary.disabled{background:#888;cursor:default;transform:none;box-shadow:4px 4px 0 #1a1a1a}

        .btn-current{display:block;width:100%;background:#fffdf4;color:#888;border:3px solid #ccc;box-shadow:4px 4px 0 #ccc;font-family:'Bangers',cursive;font-size:1.5rem;letter-spacing:2px;padding:0.5rem 1rem 0.6rem;text-align:center;cursor:default}
        .btn-premium-current{display:block;width:100%;background:#1a8a1a;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.5rem;letter-spacing:2px;padding:0.5rem 1rem 0.6rem;text-align:center;cursor:default}

        .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.75rem}
        .section-label{font-family:'Bangers',cursive;font-size:1.6rem;letter-spacing:2px;color:#1a1a1a;margin-bottom:0.4rem}
        .faq-q{font-weight:600;font-size:0.88rem;letter-spacing:0.5px;margin-bottom:0.3rem;color:#1a1a1a}
        .faq-a{font-size:0.85rem;font-weight:400;color:#555;line-height:1.6;margin-bottom:1.1rem}
        .faq-a:last-child{margin-bottom:0}
      `}</style>

      <div className="page-wrap">
        <SiteNav />

        {/* Intro */}
        <div className="panel" style={{ marginBottom: "1.75rem", fontSize: "0.88rem", fontWeight: 400, lineHeight: 1.8, color: "#333" }}>
          Free searching, no account required — ever. Premium unlocks power features for serious collectors: file imports, gap finding, email alerts, and more.
        </div>

        {/* Plan cards */}
        <div className="plan-grid">

          {/* Free */}
          <div className="plan-card">
            <div className="plan-badge free">Free</div>
            <div className="plan-name free-color">Free</div>
            <div className="plan-price">
              <div className="price-main">$0</div>
              <div className="price-sub">No account needed to search</div>
            </div>
            <ul className="feature-list">
              {FREE_FEATURES.map(f => (
                <li className="feature-item" key={f}>
                  <span className="feature-check yes">✓</span>
                  <span className="feature-text">{f}</span>
                </li>
              ))}
            </ul>
            {loading ? null : !session ? (
              <button className="btn-current" disabled>Start Searching Free</button>
            ) : isPremium ? (
              <div className="btn-current">Free Plan</div>
            ) : (
              <div className="btn-current">✓ Your Current Plan</div>
            )}
          </div>

          {/* Premium */}
          <div className="plan-card premium">
            <div className="plan-badge">⚡ Premium</div>
            <div className="plan-name premium-color">Premium</div>
            <div className="plan-price">
              <div className="price-main">$5<span style={{ fontSize: "1.1rem", fontFamily: "'Oswald',sans-serif", fontWeight: 400, letterSpacing: 0 }}>/mo</span></div>
              <div className="price-alt">or $36/year — save 40%</div>
              <div className="price-sub">Billed monthly or annually</div>
            </div>
            <ul className="feature-list">
              {PREMIUM_FEATURES.map((f, i) => {
                if (typeof f === "object" && f.divider) {
                  return (
                    <li className="feature-item" key={i}>
                      <span className="feature-check yes">✓</span>
                      <span className="feature-text feature-divider">{f.label}</span>
                    </li>
                  );
                }
                const label = typeof f === "object" ? f.label : f;
                const soon = typeof f === "object" && f.soon;
                return (
                  <li className="feature-item" key={i}>
                    <span className="feature-check yes">✓</span>
                    <span className="feature-text">
                      {label}
                      {soon && <span className="soon-pill">Soon</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
            {loading ? null : isPremium ? (
              <div className="btn-premium-current">★ You&rsquo;re on Premium</div>
            ) : !session ? (
              <button className="btn-primary" onClick={() => signIn(undefined, { callbackUrl: "/upgrade" })}>
                Get Premium →
              </button>
            ) : (
              <button className="btn-primary" onClick={() => alert("Payment coming soon! Email hello@comicbundlefinder.com to upgrade manually.")}>
                Upgrade to Premium →
              </button>
            )}
          </div>

        </div>

        {/* FAQ */}
        <div className="panel">
          <div className="section-label">Questions</div>
          <div className="faq-q">Do I need an account to search?</div>
          <div className="faq-a">Nope. The basic search is free and works without signing in. An account is only needed for Premium features.</div>

          <div className="faq-q">Can I cancel anytime?</div>
          <div className="faq-a">Yes. Cancel anytime and you keep access until the end of your billing period.</div>

          <div className="faq-q">Why is the Gap Analyzer premium?</div>
          <div className="faq-a">It parses your entire collection file and runs eBay searches on every gap — it's significantly heavier on resources than a manual search.</div>

          <div className="faq-q">What formats does file upload support?</div>
          <div className="faq-a">League of Comic Geeks exports (.xlsx), CLZ exports (.csv), and plain text lists (.txt). The search page tells you exactly what it detected from your file.</div>
        </div>

        {/* Footer note */}
        <div style={{ textAlign: "center", fontSize: "0.78rem", fontWeight: 400, color: "#888", lineHeight: 1.6 }}>
          Questions? <a href="mailto:hello@comicbundlefinder.com" style={{ color: "#003399", fontWeight: 600 }}>hello@comicbundlefinder.com</a>
        </div>
      </div>
    </>
  );
}
