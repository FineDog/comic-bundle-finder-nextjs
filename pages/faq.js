import Head from "next/head";
import { getFaqContent } from "../lib/content";
import SiteNav from "../components/SiteNav";
import SiteFooter from "../components/SiteFooter";

export async function getStaticProps() {
  const faq = await getFaqContent();
  return { props: faq };
}

export default function Faq({ frontmatter, html }) {
  return (
    <>
      <Head>
        <title>FAQ — Comic Bundle Finder</title>
        <meta name="description" content="Frequently asked questions about Comic Bundle Finder." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem}

        .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.75rem}
        .panel-nav{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;padding:0.6rem 1.25rem;margin-bottom:1.75rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
        .title-panel{background:#cc1f00;text-align:center;padding:1.25rem 1.75rem 1rem}
        .title-panel h1{font-family:'Bangers',cursive;font-size:clamp(2.5rem,8vw,5rem);color:#fffdf4;letter-spacing:4px;text-shadow:4px 4px 0 #1a1a1a;line-height:1}
        .tagline{color:#ffe066;font-size:1rem;letter-spacing:2px;text-transform:uppercase;margin-top:0.4rem;font-weight:400}
        .nav-link{font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#003399;text-decoration:none}
        .nav-link:hover{text-decoration:underline}
        .nav-sep{color:#aaa;font-size:0.78rem}
        .faq h1{font-family:'Bangers',cursive;font-size:2.2rem;letter-spacing:3px;color:#1a1a1a;margin:2.5rem 0 0.6rem;padding-top:2rem;border-top:3px solid #1a1a1a}
        .faq h2{font-family:'Bangers',cursive;font-size:1.5rem;letter-spacing:2px;color:#cc1f00;margin:1.75rem 0 0.6rem;padding-top:1.5rem;border-top:2px dashed #ddd}
        .faq h2:first-child{margin-top:0;padding-top:0;border-top:none}
        .faq p{font-size:1rem;font-weight:400;line-height:1.85;color:#333;margin-bottom:0.85rem}
        .faq ul,.faq ol{padding-left:1.5rem;margin-bottom:0.85rem}
        .faq li{font-size:1rem;font-weight:400;line-height:1.8;color:#333;margin-bottom:0.2rem}
        .faq a{color:#003399;font-weight:600}
        .faq a:hover{text-decoration:underline}
        .faq strong{font-weight:600;color:#1a1a1a}
      `}</style>
      <div className="page-wrap">
        <SiteNav />

        <div className="panel">
          <div className="faq" dangerouslySetInnerHTML={{ __html: html }} />
        </div>

        <SiteFooter />
      </div>
    </>
  );
}
