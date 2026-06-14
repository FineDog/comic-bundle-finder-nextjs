import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import { useSession, signIn } from "next-auth/react";
import { useRouter } from "next/router";
import SiteNav from "../components/SiteNav";
import SiteFooter from "../components/SiteFooter";

export default function Welcome() {
  const router = useRouter();
  const { status } = useSession();
  const [email, setEmail] = useState("");
  const [state, setState] = useState("loading"); // loading | sent | error | already
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    if (status === "loading") return;

    // Already signed in (e.g. an existing user who just upgraded) — send them on.
    if (status === "authenticated") {
      started.current = true;
      setState("already");
      router.replace("/account?upgraded=1");
      return;
    }

    const sessionId = router.query.session_id;
    if (!router.isReady) return;
    started.current = true;

    if (!sessionId) {
      setState("error");
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/stripe/session?session_id=${encodeURIComponent(sessionId)}`);
        const data = await res.json();
        if (!res.ok || !data.email) throw new Error();
        setEmail(data.email);
        // Send the magic link so the new premium account can sign in.
        await signIn("email", { email: data.email, callbackUrl: "/account", redirect: false });
        setState("sent");
      } catch {
        setState("error");
      }
    })();
  }, [status, router.isReady, router.query.session_id, router]);

  return (
    <>
      <Head>
        <title>Welcome to Premium — Comic Bundle Finder</title>
        <meta name="robots" content="noindex" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem}

        .welcome-panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:2.25rem 2rem;margin-bottom:1.75rem;text-align:center}
        .welcome-badge{display:inline-block;background:#1a8a1a;color:#fffdf4;border:2px solid #1a1a1a;padding:0.25rem 0.85rem;font-size:0.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:1rem}
        .welcome-title{font-family:'Bangers',cursive;font-size:2.6rem;letter-spacing:3px;color:#cc1f00;line-height:1;margin-bottom:0.75rem}
        .welcome-body{font-size:1.05rem;font-weight:400;color:#444;line-height:1.65;max-width:34rem;margin:0 auto}
        .welcome-email{font-weight:600;color:#1a1a1a}
        .welcome-note{font-size:0.85rem;color:#888;margin-top:1.25rem;line-height:1.5}
        .welcome-err{font-size:0.95rem;color:#cc1f00;font-weight:600;margin-top:0.5rem;line-height:1.6}
        .btn-plans{display:inline-block;background:#003399;color:#fffdf4;border:2px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.2rem;letter-spacing:2px;padding:0.4rem 1.2rem 0.5rem;text-decoration:none;margin-top:1.25rem}
        .btn-plans:hover{background:#0044cc}
        .spinner{display:inline-block;width:28px;height:28px;border:4px solid #e0d8c0;border-top-color:#cc1f00;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:0.5rem}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      <div className="page-wrap">
        <SiteNav />

        <div className="welcome-panel">
          {state === "loading" && (
            <>
              <div className="spinner" />
              <div className="welcome-title">Confirming your order…</div>
              <p className="welcome-body">Hang tight while we set up your premium account.</p>
            </>
          )}

          {state === "sent" && (
            <>
              <div className="welcome-badge">★ Premium Unlocked</div>
              <div className="welcome-title">You&rsquo;re all set!</div>
              <p className="welcome-body">
                Thanks for upgrading. Your premium account is ready — we just sent a sign-in
                link to <span className="welcome-email">{email}</span>. Click it to access your
                account and start uploading want lists, running the Gap Analyzer, and more.
              </p>
              <p className="welcome-note">
                Didn&rsquo;t get it? Check your spam folder, or{" "}
                <a href="/auth/signin" style={{ color: "#003399", fontWeight: 600 }}>request a new link</a>.
              </p>
            </>
          )}

          {state === "already" && (
            <>
              <div className="spinner" />
              <div className="welcome-title">You&rsquo;re all set!</div>
              <p className="welcome-body">Taking you to your account…</p>
            </>
          )}

          {state === "error" && (
            <>
              <div className="welcome-title">Payment received</div>
              <p className="welcome-body">
                Your upgrade went through, but we couldn&rsquo;t automatically send your sign-in
                link. Sign in with the email you used at checkout to access your premium account.
              </p>
              <a href="/auth/signin" className="btn-plans">Sign In →</a>
            </>
          )}
        </div>

        <SiteFooter />
      </div>
    </>
  );
}
