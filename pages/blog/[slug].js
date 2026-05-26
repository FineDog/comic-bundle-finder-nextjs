import Head from "next/head";
import { getBlogSlugs, getBlogPost } from "../../lib/content";
import SiteNav from "../../components/SiteNav";

export async function getStaticPaths() {
  const slugs = getBlogSlugs();
  return {
    paths: slugs.map(slug => ({ params: { slug } })),
    fallback: false,
  };
}

export async function getStaticProps({ params }) {
  const post = await getBlogPost(params.slug);
  if (post.frontmatter.draft) return { notFound: true };
  return { props: { slug: params.slug, ...post } };
}

export default function BlogPost({ frontmatter, html }) {
  const dateStr = frontmatter.date
    ? new Date(frontmatter.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
    : null;

  return (
    <>
      <Head>
        <title>{frontmatter.title} — Comic Bundle Finder</title>
        {frontmatter.description && <meta name="description" content={frontmatter.description} />}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem}

        .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.75rem}
        .panel-nav{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;padding:0.6rem 1.25rem;margin-bottom:1.75rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
        .nav-link{font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#003399;text-decoration:none}
        .nav-link:hover{text-decoration:underline}
        .nav-sep{color:#aaa;font-size:0.78rem}
        .post-date{font-size:0.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-bottom:0.75rem}
        .post-title{font-family:'Bangers',cursive;font-size:clamp(2rem,6vw,3.5rem);letter-spacing:3px;color:#1a1a1a;line-height:1.1;margin-bottom:1.5rem}
        .post-desc{font-size:0.9rem;font-weight:400;line-height:1.7;color:#555;border-left:4px solid #cc1f00;padding-left:1rem;margin-bottom:1.75rem}
        .divider{border:none;border-top:2px dashed #ccc;margin:1.5rem 0}
        .prose h2{font-family:'Bangers',cursive;font-size:1.7rem;letter-spacing:2px;margin:1.75rem 0 0.75rem;color:#cc1f00}
        .prose h3{font-family:'Bangers',cursive;font-size:1.3rem;letter-spacing:1.5px;margin:1.5rem 0 0.5rem}
        .prose p{font-size:0.9rem;font-weight:400;line-height:1.85;color:#333;margin-bottom:1.1rem}
        .prose ul,.prose ol{padding-left:1.5rem;margin-bottom:1.1rem}
        .prose li{font-size:0.9rem;font-weight:400;line-height:1.8;color:#333;margin-bottom:0.25rem}
        .prose a{color:#003399;font-weight:600}
        .prose a:hover{text-decoration:underline}
        .prose strong{font-weight:600;color:#1a1a1a}
        .prose blockquote{border-left:4px solid #ffe066;background:#fffbe8;padding:0.75rem 1rem;margin:1.25rem 0;font-style:italic}
        .prose code{background:#f0e6c4;border:1px solid #ccc;padding:0.1em 0.4em;font-size:0.85em;border-radius:2px}
        .prose pre{background:#1a1a1a;color:#fffdf4;padding:1rem 1.25rem;margin:1.25rem 0;overflow-x:auto;border:3px solid #1a1a1a}
        .prose pre code{background:none;border:none;padding:0;font-size:0.85rem}
        .prose hr{border:none;border-top:2px dashed #ccc;margin:1.75rem 0}
      `}</style>
      <div className="page-wrap">
        <SiteNav />

        <div className="panel">
          {dateStr && <div className="post-date">{dateStr}</div>}
          <h1 className="post-title">{frontmatter.title}</h1>
          {frontmatter.description && (
            <p className="post-desc">{frontmatter.description}</p>
          )}
          <hr className="divider" />
          <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </>
  );
}
