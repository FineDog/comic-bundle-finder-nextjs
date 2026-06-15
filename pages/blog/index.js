import Head from "next/head";
import Link from "next/link";
import { getAllBlogPosts } from "../../lib/content";
import SiteNav from "../../components/SiteNav";

export async function getStaticProps() {
  const posts = getAllBlogPosts();
  return { props: { posts } };
}

export default function BlogIndex({ posts }) {
  return (
    <>
      <Head>
        <title>Blog — Comic Bundle Finder</title>
        <meta name="description" content="Tips, updates, and guides for building your comic collection on a budget." />
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
        .post-list{display:flex;flex-direction:column;gap:1.25rem}
        .post-card{border:3px solid #1a1a1a;box-shadow:5px 5px 0 #1a1a1a;background:#fffdf4;display:flex;overflow:hidden;text-decoration:none;color:inherit;transition:transform 0.08s,box-shadow 0.08s}
        .post-card:hover{transform:translate(-2px,-2px);box-shadow:7px 7px 0 #1a1a1a}
        .post-card:active{transform:translate(3px,3px);box-shadow:2px 2px 0 #1a1a1a}
        .post-card-accent{width:8px;flex-shrink:0;background:#cc1f00}
        .post-card-body{flex:1;padding:1.25rem 1.5rem;min-width:0}
        .post-date{font-size:0.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-bottom:0.4rem}
        .post-title{font-family:'Bangers',cursive;font-size:1.5rem;letter-spacing:2px;color:#1a1a1a;line-height:1.15;margin-bottom:0.5rem}
        .post-desc{font-size:1rem;font-weight:400;line-height:1.7;color:#444}
        .empty{font-size:1rem;color:#666;font-weight:400}
      `}</style>
      <div className="page-wrap">
        <SiteNav />

        <div className="post-list">
          {posts.length === 0 ? (
            <div className="panel"><p className="empty">No posts yet — check back soon.</p></div>
          ) : (
            posts.map(post => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="post-card">
                <div className="post-card-accent" />
                <div className="post-card-body">
                  <div className="post-date">{new Date(post.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}</div>
                  <div className="post-title">{post.title}</div>
                  {post.description && <div className="post-desc">{post.description}</div>}
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </>
  );
}
