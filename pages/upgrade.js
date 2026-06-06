import { useState } from "react";
import Head from "next/head";
import { useSession, signIn } from "next-auth/react";
import SiteNav from "../components/SiteNav";
import SiteFooter from "../components/SiteFooter";

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

  const [billing, setBilling] = useState("annual"); // "monthly" | "annual"
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");

  const monthlyPriceId = process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID;
  const annualPriceId  = process.env.NEXT_PUBLIC_STRIPE_ANNUAL_PRICE_ID;
  const priceId = billing === "annual" ? annualPriceId : monthlyPriceId;

  async function handleCheckout() {
    if (!session) {
      signIn(undefined, { callbackUrl: "/upgrade" });
      return;
    }
    setCheckoutLoading(true);
    setCheckoutError("");
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      window.location.href = data.url;
    } catch (e) {
      setCheckoutError(e.message);
      setCheckoutLoading(false);
    }
  }

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

        .billing-toggle{display:flex;align-items:center;justify-content:center;gap:0;margin-bottom:1.75rem;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;width:fit-content;margin-left:auto;margin-right:auto}
        .toggle-btn{font-family:'Bangers',cursive;font-size:1.1rem;letter-spacing:1.5px;padding:0.45rem 1.5rem 0.55rem;border:none;cursor:pointer;transition:background 0.1s,color 0.1s;background:#fffdf4;color:#888;white-space:nowrap}
        .toggle-btn:first-child{border-right:2px solid #1a1a1a}
        .toggle-btn.active{background:#1a1a1a;color:#ffe066}
        .toggle-btn:not(.active):hover{background:#f0e6c4;color:#1a1a1a}
        .save-pill{display:inline-block;background:#cc1f00;color:#fffdf4;font-family:'Oswald',sans-serif;font-size:0.65rem;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:0.1rem 0.4rem;margin-left:0.4rem;vertical-align:middle;border:1.5px solid #1a1a1a;line-height:1.4}

        .plan-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:1.75rem;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a}
        @media(max-width:640px){.plan-grid{grid-template-columns:1fr}}

        .plan-card{background:#fffdf4;padding:1.75rem;display:flex;flex-direction:column}
        .plan-card.premium{background:#fffbea;border-left:3px solid #1a1a1a}
        @media(max-width:640px){.plan-card.premium{border-left:none;border-top:3px solid #1a1a1a}}



        .plan-name{font-family:'Bangers',cursive;font-size:2.4rem;letter-spacing:3px;line-height:1;margin-bottom:0.5rem}
        .plan-name.free-color{color:#888}
        .plan-name.premium-color{color:#cc1f00}

        .plan-price{margin-bottom:1.5rem;padding-bottom:1.25rem;border-bottom:2px solid #e0d8c0;min-height:5.5rem}
        .price-main{font-family:'Bangers',cursive;font-size:3rem;letter-spacing:1px;line-height:1;color:#1a1a1a}
        .price-period{font-size:1.1rem;font-family:'Oswald',sans-serif;font-weight:400;letter-spacing:0}
        .price-sub{font-size:0.8rem;font-weight:400;color:#666;margin-top:0.25rem;line-height:1.5}
        .price-billed{font-size:0.82rem;font-weight:600;color:#003399;margin-top:0.15rem}

        .feature-list{list-style:none;margin-bottom:1.75rem;display:flex;flex-direction:column;gap:0.55rem;flex:1}
        .feature-item{display:flex;align-items:flex-start;gap:0.6rem;font-size:1rem;font-weight:400;line-height:1.4}
        .feature-check{font-size:1rem;flex-shrink:0;margin-top:0.05rem}
        .feature-check.yes{color:#1a8a1a}
        .feature-divider-text{font-family:'Bangers',cursive;font-size:1rem;letter-spacing:1px;color:#1a1a1a;padding-bottom:0.1rem;border-bottom:1px dashed #ccc}
        .soon-pill{display:inline-block;background:#ffe066;border:1.5px solid #1a1a1a;padding:0.1rem 0.45rem;font-size:0.62rem;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-left:0.35rem;vertical-align:middle;line-height:1.4}

        .btn-primary{display:block;width:100%;background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.5rem;letter-spacing:2px;padding:0.5rem 1rem 0.6rem;cursor:pointer;text-align:center;text-decoration:none;transition:transform 0.08s,box-shadow 0.08s;margin-top:auto}
        .btn-primary:hover:not(:disabled){background:#0044cc;transform:translate(-1px,-1px);box-shadow:5px 5px 0 #1a1a1a}
        .btn-primary:active:not(:disabled){transform:translate(3px,3px);box-shadow:1px 1px 0 #1a1a1a}
        .btn-primary:disabled{background:#888;cursor:not-allowed;transform:none;box-shadow:4px 4px 0 #1a1a1a}

        .btn-current{display:block;width:100%;background:#fffdf4;color:#888;border:3px solid #ccc;box-shadow:4px 4px 0 #ccc;font-family:'Bangers',cursive;font-size:1.5rem;letter-spacing:2px;padding:0.5rem 1rem 0.6rem;text-align:center;cursor:default;margin-top:auto}
        .btn-premium-current{display:block;width:100%;background:#1a8a1a;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.5rem;letter-spacing:2px;padding:0.5rem 1rem 0.6rem;text-align:center;cursor:default;margin-top:auto}

        .checkout-error{font-size:0.8rem;font-weight:600;color:#cc1f00;margin-top:0.6rem;text-align:center}

        .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.75rem}
        .section-label{font-family:'Bangers',cursive;font-size:1.6rem;letter-spacing:2px;color:#1a1a1a;margin-bottom:0.75rem}
        .faq-q{font-weight:600;font-size:1rem;letter-spacing:0.5px;margin-bottom:0.3rem;color:#1a1a1a}
        .faq-a{font-size:1rem;font-weight:400;color:#555;line-height:1.6;margin-bottom:1.1rem}
        .faq-a:last-child{margin-bottom:0}
      `}</style>

      <div className="page-wrap">
        <SiteNav />

        {/* Billing toggle */}
        <div className="billing-toggle">
          <button
            className={`toggle-btn${billing === "monthly" ? " active" : ""}`}
            onClick={() => setBilling("monthly")}
          >
            Monthly
          </button>
          <button
            className={`toggle-btn${billing === "annual" ? " active" : ""}`}
            onClick={() => setBilling("annual")}
          >
            Annual
            {billing !== "annual" && <span className="save-pill">Save 40%</span>}
          </button>
        </div>

        {/* Plan cards */}
        <div className="plan-grid">

          {/* Free */}
          <div className="plan-card">
            <div className="plan-name free-color">Free</div>
            <div className="plan-price">
              <div className="price-main">$0</div>
              <div className="price-sub">No account needed to search</div>
            </div>
            <ul className="feature-list">
              {FREE_FEATURES.map(f => (
                <li className="feature-item" key={f}>
                  <span className="feature-check yes">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {!loading && (
              <div className="btn-current">
                {!session ? "Free Forever" : isPremium ? "Free Plan" : "✓ Your Current Plan"}
              </div>
            )}
          </div>

          {/* Premium */}
          <div className="plan-card premium">
            <div className="plan-name premium-color">Premium</div>
            <div className="plan-price">
              {billing === "monthly" ? (
                <>
                  <div className="price-main">$5<span className="price-period">/mo</span></div>
                  <div className="price-sub">Billed monthly — cancel anytime</div>
                </>
              ) : (
                <>
                  <div className="price-main">$3<span className="price-period">/mo</span></div>
                  <div className="price-billed">Billed $36/year — save 40%</div>
                  <div className="price-sub">Cancel anytime</div>
                </>
              )}
            </div>
            <ul className="feature-list">
              {PREMIUM_FEATURES.map((f, i) => {
                if (typeof f === "object" && f.divider) {
                  return (
                    <li className="feature-item" key={i}>
                      <span className="feature-check yes">✓</span>
                      <span className="feature-divider-text">{f.label}</span>
                    </li>
                  );
                }
                const label = typeof f === "object" ? f.label : f;
                const soon  = typeof f === "object" && f.soon;
                return (
                  <li className="feature-item" key={i}>
                    <span className="feature-check yes">✓</span>
                    <span>
                      {label}
                      {soon && <span className="soon-pill">Soon</span>}
                    </span>
                  </li>
                );
              })}
            </ul>

            {!loading && (
              isPremium ? (
                <div className="btn-premium-current">★ You&rsquo;re on Premium</div>
              ) : (
                <>
                  <button
                    className="btn-primary"
                    onClick={handleCheckout}
                    disabled={checkoutLoading}
                  >
                    {checkoutLoading
                      ? "Loading…"
                      : !session
                      ? "Get Premium →"
                      : `Upgrade — $${billing === "annual" ? "36/yr" : "5/mo"} →`}
                  </button>
                  {checkoutError && <div className="checkout-error">{checkoutError}</div>}
                </>
              )
            )}
          </div>

        </div>

        {/* FAQ */}
        <div className="panel">
          <div className="section-label">Questions</div>

          <div className="faq-q">Do I need an account to search?</div>
          <div className="faq-a">Nope. Basic searching is free and works without signing in. An account is only needed for Premium features.</div>

          <div className="faq-q">Can I cancel anytime?</div>
          <div className="faq-a">Yes. Cancel from your account page and you keep Premium access until the end of your billing period. No questions asked.</div>

          <div className="faq-q">What&rsquo;s the difference between monthly and annual?</div>
          <div className="faq-a">Same features either way — annual is just $36 upfront instead of $5/month, which works out to $3/month. You save $24 over the year.</div>

          <div className="faq-q">Why is the Gap Analyzer premium?</div>
          <div className="faq-a">It parses your entire collection file and runs eBay searches on every gap — significantly heavier on resources than a manual search.</div>

          <div className="faq-q">What file formats does upload support?</div>
          <div className="faq-a">League of Comic Geeks exports (.xlsx), CLZ exports (.csv), and plain text lists (.txt).</div>
        </div>

        <SiteFooter />
      </div>
    </>
  );
}
