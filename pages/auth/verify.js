import Head from "next/head";
import Link from "next/link";

export default function VerifyRequest() {
  return (
    <>
      <Head>
        <title>Check Your Email — Comic Bundle Finder</title>
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem;display:flex;align-items:flex-start;justify-content:center}
      `}</style>
      <div style={{ width: "100%", maxWidth: "420px" }}>
        <div style={{ background: "#cc1f00", padding: "1.25rem 1.75rem", border: "3px solid #1a1a1a", boxShadow: "6px 6px 0 #1a1a1a", textAlign: "center", marginBottom: 0 }}>
          <h1 style={{ fontFamily: "'Bangers', cursive", fontSize: "2.2rem", color: "#fffdf4", letterSpacing: "4px", textShadow: "3px 3px 0 #1a1a1a" }}>Comic Bundle Finder</h1>
        </div>
        <div style={{ background: "#fffdf4", border: "3px solid #1a1a1a", borderTop: "none", padding: "1.75rem", boxShadow: "6px 6px 0 #1a1a1a", textAlign: "center" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>✉</div>
          <h2 style={{ fontFamily: "'Bangers', cursive", fontSize: "1.8rem", letterSpacing: "2px", color: "#003399", marginBottom: "0.75rem" }}>Check Your Email</h2>
          <p style={{ fontSize: "1rem", fontWeight: 400, lineHeight: 1.7, color: "#444", marginBottom: "1.5rem" }}>
            A sign-in link has been sent to your email address. Click the link in the email to sign in.
            The link expires after 24 hours.
          </p>
          <Link href="/" style={{ display: "inline-block", background: "#1a1a1a", color: "#fffdf4", textDecoration: "none", border: "2px solid #1a1a1a", fontFamily: "'Oswald', sans-serif", fontSize: "1rem", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", padding: "0.4rem 1.25rem" }}>
            ← Back to search
          </Link>
        </div>
      </div>
    </>
  );
}
