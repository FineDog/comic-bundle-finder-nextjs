import Link from "next/link";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";

export default function SiteNav() {
  const router = useRouter();
  const path = router.pathname;
  const { data: session } = useSession();

  const activeSearch = path === "/";
  const activeAnalyzer = path === "/gap-analyzer";
  const activeGuides = path === "/collection-guides" || path.startsWith("/series/") || path.startsWith("/arc/");
  const activeAbout = path === "/faq";
  const activeUpgrade = path === "/upgrade";

  return (
    <>
      <style>{`
        .page-wrap{max-width:960px;margin:0 auto}
        .snav-header{display:block;background:#cc1f00;text-align:center;padding:1.25rem 1.75rem 1rem;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;text-decoration:none;transition:filter 0.12s}
        .snav-header:hover{filter:brightness(1.1)}
        .snav-h1{font-family:'Bangers',cursive;font-size:clamp(2.5rem,8vw,5rem);color:#fffdf4;letter-spacing:4px;text-shadow:4px 4px 0 #1a1a1a;line-height:1;margin:0}
        .snav-tagline{color:#ffe066;font-size:0.85rem;letter-spacing:2px;text-transform:uppercase;margin-top:0.4rem;font-weight:400;font-family:'Oswald',sans-serif}
        .snav-bar{display:flex;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;margin-top:0.875rem;margin-bottom:1.75rem}
        .snav-item{flex:1;text-align:center;padding:0.55rem 0.5rem 0.65rem;font-family:'Bangers',cursive;font-size:1.15rem;letter-spacing:2px;text-transform:uppercase;text-decoration:none;border-right:2px solid #1a1a1a;transition:background 0.1s,color 0.1s;background:#fffdf4;color:#888}
        .snav-item:last-child{border-right:none}
        .snav-item:hover:not(.snav-active){background:#f0e6c4;color:#1a1a1a}
        .snav-item.snav-active{background:#cc1f00;color:#fffdf4}
        .snav-account{flex:0 0 auto;padding:0.55rem 1rem 0.65rem;font-family:'Bangers',cursive;font-size:1.15rem;letter-spacing:2px;text-transform:uppercase;text-decoration:none;background:#ffe066;color:#1a1a1a;border-left:2px solid #1a1a1a;transition:background 0.1s}
        .snav-account:hover{background:#ffd700}
        @media(max-width:540px){.snav-item{font-size:0.88rem;padding:0.5rem 0.15rem 0.55rem;letter-spacing:0.5px}.snav-account{font-size:0.88rem;padding:0.5rem 0.5rem 0.55rem}}
      `}</style>
      <Link href="/" className="snav-header">
        <h1 className="snav-h1">Comic Bundle Finder</h1>
        <div className="snav-tagline">Find sellers with multiple issues you need — save on shipping</div>
      </Link>
      <nav className="snav-bar">
        <Link href="/" className={`snav-item${activeSearch ? " snav-active" : ""}`}>Search</Link>
        <Link href="/gap-analyzer" className={`snav-item${activeAnalyzer ? " snav-active" : ""}`}>Gap Analyzer</Link>
        <Link href="/collection-guides" className={`snav-item${activeGuides ? " snav-active" : ""}`}>Collection Guides</Link>
        <Link href="/faq" className={`snav-item${activeAbout ? " snav-active" : ""}`}>About</Link>
        <Link href="/upgrade" className={`snav-item${activeUpgrade ? " snav-active" : ""}`} style={activeUpgrade ? {} : { color: "#cc1f00", fontWeight: 700 }}>⚡ Premium</Link>
        <Link href={session ? "/account" : "/auth/signin"} className="snav-account">
          {session ? "My Account" : "Sign In"}
        </Link>
      </nav>
    </>
  );
}
