import { useState } from "react";
import { signIn, getProviders } from "next-auth/react";
import Head from "next/head";
import Link from "next/link";

export async function getServerSideProps() {
  const providers = await getProviders();
  return { props: { providers: providers ?? {} } };
}

export default function SignIn({ providers }) {
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleEmailSignIn(e) {
    e.preventDefault();
    setLoading(true);
    await signIn("email", { email, callbackUrl: "/account", redirect: false });
    setEmailSent(true);
    setLoading(false);
  }

  return (
    <>
      <Head>
        <title>Sign In — Comic Bundle Finder</title>
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem;display:flex;align-items:flex-start;justify-content:center}
        .wrap{width:100%;max-width:420px;margin-top:3rem}
        .title-panel{background:#cc1f00;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;text-align:center;padding:1.25rem 1.75rem 1rem;margin-bottom:1.75rem}
        .title-panel h1{font-family:'Bangers',cursive;font-size:2.5rem;color:#fffdf4;letter-spacing:4px;text-shadow:4px 4px 0 #1a1a1a;line-height:1}
        .tagline{color:#ffe066;font-size:0.8rem;letter-spacing:2px;text-transform:uppercase;margin-top:0.4rem}
        .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.25rem}
        .caption{display:inline-block;background:#ffe066;border:2px solid #1a1a1a;padding:0.3rem 0.7rem;font-size:0.8rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:1rem}
        .btn-google{width:100%;background:#fffdf4;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.95rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.65rem 1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:0.6rem}
        .btn-google:hover{background:#ffe066}
        .divider{display:flex;align-items:center;gap:0.75rem;margin:1rem 0;color:#888;font-size:0.8rem;letter-spacing:1px}
        .divider::before,.divider::after{content:'';flex:1;border-top:1px solid #ccc}
        input[type=email]{width:100%;border:2px solid #1a1a1a;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:0.95rem;padding:0.6rem 0.75rem;margin-bottom:0.75rem;color:#1a1a1a}
        input[type=email]:focus{outline:none;border-color:#003399;box-shadow:2px 2px 0 #003399}
        .btn-email{width:100%;background:#003399;color:#fffdf4;border:2px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.3rem;letter-spacing:2px;padding:0.4rem 1rem 0.5rem;cursor:pointer}
        .btn-email:hover{background:#0044cc}
        .btn-email:disabled{background:#888;cursor:not-allowed}
        .success{background:#e8f5e9;border:2px solid #1a1a1a;padding:1rem;font-size:1rem;line-height:1.6}
        .back{display:block;text-align:center;margin-top:1rem;font-size:1rem;color:#003399;text-decoration:none;font-weight:600}
        .back:hover{text-decoration:underline}
      `}</style>
      <div className="wrap">
        <div className="title-panel">
          <h1>Comic Bundle Finder</h1>
          <div className="tagline">Sign in to your account</div>
        </div>

        <div className="panel">
          <div className="caption">Sign In</div>

          {emailSent ? (
            <div className="success">
              Check your inbox! We sent a sign-in link to <strong>{email}</strong>.
            </div>
          ) : (
            <>
              {providers.google && (
                <button className="btn-google" onClick={() => signIn("google", { callbackUrl: "/account" })}>
                  <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.8 2.2 30.2 0 24 0 14.7 0 6.7 5.4 2.7 13.3l7.9 6.1C12.5 13 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 6.9-10 7.1-17z"/><path fill="#FBBC05" d="M10.6 28.6A14.8 14.8 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A23.8 23.8 0 0 0 0 24c0 3.9.9 7.5 2.5 10.8l8.1-6.2z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.2-7.7 2.2-6.2 0-11.5-4.2-13.4-9.8l-8.1 6.2C6.6 42.5 14.7 48 24 48z"/></svg>
                  Continue with Google
                </button>
              )}

              {providers.google && providers.email && (
                <div className="divider">or</div>
              )}

              {providers.email && (
                <form onSubmit={handleEmailSignIn}>
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                  <button className="btn-email" type="submit" disabled={loading}>
                    {loading ? "Sending…" : "Email me a link"}
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        <Link href="/" className="back">← Back to Comic Bundle Finder</Link>
      </div>
    </>
  );
}
