import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { canAccess } from "../lib/features.js";
import { PremiumModal } from "./PremiumGate.js";

export default function SiteNav() {
  const router = useRouter();
  const path = router.pathname;
  const { data: session } = useSession();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const plan = session?.user?.plan ?? "free";
  const hasPremium = canAccess(plan, "gap-analyzer");

  const activeSearch = path === "/";
  const activeAnalyzer = path === "/gap-analyzer";
  const activeGuides = path === "/collection-guides" || path.startsWith("/series/") || path.startsWith("/arc/");
  const activeAbout = path === "/faq";
  const activeUpgrade = path === "/upgrade";

  function closeMenu() { setMenuOpen(false); }

  return (
    <>
      <style>{`
        .page-wrap{max-width:960px;margin:0 auto}
        .snav-header{display:flex;flex-direction:column;align-items:center;background:#cc1f00;text-align:center;padding:1.25rem 1.75rem 1rem;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;text-decoration:none;transition:filter 0.12s}
        .snav-header:hover{filter:brightness(1.1)}
        .snav-logo-full{height:clamp(2.5rem,8vw,5rem);width:auto;display:block}
        .snav-tagline{color:#ffe066;font-size:1rem;letter-spacing:2px;text-transform:uppercase;margin-top:0.4rem;font-weight:400;font-family:'Oswald',sans-serif}
        .snav-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
        .snav-bar{display:flex;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;margin-top:0.875rem;margin-bottom:1.75rem}
        .snav-item{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;padding:0.55rem 0.5rem 0.65rem;font-family:'Bangers',cursive;font-size:1.15rem;letter-spacing:2px;text-transform:uppercase;text-decoration:none;white-space:nowrap;border-right:2px solid #1a1a1a;transition:background 0.1s,color 0.1s;background:#fffdf4;color:#888}
        button.snav-item{border:none;border-right:2px solid #1a1a1a}
        .snav-item:last-child{border-right:none}
        .snav-item:hover:not(.snav-active){background:#f0e6c4;color:#1a1a1a}
        .snav-item.snav-active{background:#cc1f00;color:#fffdf4}
        .snav-account{flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding:0.55rem 1rem 0.65rem;font-family:'Bangers',cursive;font-size:1.15rem;letter-spacing:2px;text-transform:uppercase;text-decoration:none;white-space:nowrap;background:#ffe066;color:#1a1a1a;border-left:2px solid #1a1a1a;transition:background 0.1s}
        .snav-account:hover{background:#ffd700}
        .snav-hamburger{display:none}
        @media(max-width:640px){
          .snav-bar{flex-direction:column;box-shadow:4px 4px 0 #1a1a1a}
          .snav-hamburger{display:flex;align-items:center;justify-content:space-between;width:100%;padding:0.65rem 1rem;font-family:'Bangers',cursive;font-size:1.2rem;letter-spacing:2px;text-transform:uppercase;background:#fffdf4;color:#1a1a1a;border:none;cursor:pointer}
          .snav-hamburger-icon{font-size:1.5rem;line-height:1}
          .snav-item,.snav-account{display:none}
          .snav-bar.snav-open .snav-item,
          .snav-bar.snav-open .snav-account{display:flex;width:100%;box-sizing:border-box;border-right:none;border-top:2px solid #1a1a1a;white-space:normal}
          .snav-bar.snav-open button.snav-item{border:none;border-top:2px solid #1a1a1a}
          .snav-bar.snav-open .snav-account{border-left:none;border-top:2px solid #1a1a1a}
        }
      `}</style>
      <Link href="/" className="snav-header">
        <h1 className="snav-sr-only">Comic Bundle Finder</h1>
        <img
          src="/logo/logo-full-2.svg"
          role="img"
          aria-label="Comic Bundle Finder"
          title="Comic Bundle Finder"
          alt="Comic Bundle Finder"
          className="snav-logo-full"
        />
        <div className="snav-tagline">Find sellers with multiple issues you need — save on shipping</div>
      </Link>
      <nav className={`snav-bar${menuOpen ? " snav-open" : ""}`}>
        <button className="snav-hamburger" onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen} aria-label="Toggle navigation">
          <span>Menu</span>
          <span className="snav-hamburger-icon">{menuOpen ? "✕" : "☰"}</span>
        </button>
        <Link href="/" className={`snav-item${activeSearch ? " snav-active" : ""}`} onClick={closeMenu}>Search</Link>
        {hasPremium ? (
          <Link href="/gap-analyzer" className={`snav-item${activeAnalyzer ? " snav-active" : ""}`} onClick={closeMenu}>Gap Analyzer</Link>
        ) : (
          <button
            className={`snav-item${activeAnalyzer ? " snav-active" : ""}`}
            onClick={() => { setShowUpgradeModal(true); closeMenu(); }}
            style={{ background: activeAnalyzer ? "#cc1f00" : undefined, cursor: "pointer" }}
          >Gap Analyzer</button>
        )}
        <Link href="/collection-guides" className={`snav-item${activeGuides ? " snav-active" : ""}`} onClick={closeMenu}>Collection Guides</Link>
        <Link href="/faq" className={`snav-item${activeAbout ? " snav-active" : ""}`} onClick={closeMenu}>About</Link>
        <Link href="/upgrade" className={`snav-item${activeUpgrade ? " snav-active" : ""}`} style={activeUpgrade ? {} : { color: "#cc1f00", fontWeight: 700 }} onClick={closeMenu}>Premium</Link>
        <Link href={session ? "/account" : "/auth/signin"} className="snav-account" onClick={closeMenu}>
          {session ? "My Account" : "Sign In"}
        </Link>
      </nav>
      {showUpgradeModal && <PremiumModal onClose={() => setShowUpgradeModal(false)} />}
    </>
  );
}
