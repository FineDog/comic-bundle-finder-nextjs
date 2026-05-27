import { getServerSideProps as authProps } from "@/lib/auth-guard";
import { signOut, useSession } from "next-auth/react";
import Head from "next/head";
import Link from "next/link";

export { authProps as getServerSideProps };

export default function Account() {
  const { data: session } = useSession();

  return (
    <>
      <Head>
        <title>Account — Comic Bundle Finder</title>
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem}
        .container{max-width:720px;margin:0 auto}
        .title-panel{background:#cc1f00;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;text-align:center;padding:1.25rem 1.75rem 1rem;margin-bottom:1.75rem}
        .title-panel h1{font-family:'Bangers',cursive;font-size:2.5rem;color:#fffdf4;letter-spacing:4px;text-shadow:4px 4px 0 #1a1a1a;line-height:1}
        .tagline{color:#ffe066;font-size:0.8rem;letter-spacing:2px;text-transform:uppercase;margin-top:0.4rem}
        .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.75rem}
        .caption{display:inline-block;background:#ffe066;border:2px solid #1a1a1a;padding:0.3rem 0.7rem;font-size:0.8rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:1rem}
        .user-info{display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem}
        .avatar{width:52px;height:52px;border:2px solid #1a1a1a;border-radius:50%;object-fit:cover}
        .avatar-placeholder{width:52px;height:52px;border:2px solid #1a1a1a;background:#ffe066;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bangers',cursive;font-size:1.4rem;color:#1a1a1a}
        .user-name{font-size:1.1rem;font-weight:600;letter-spacing:1px}
        .user-email{font-size:0.85rem;color:#555;font-weight:400}
        .tier-badge{display:inline-block;background:#003399;color:#fffdf4;border:2px solid #1a1a1a;padding:0.2rem 0.65rem;font-size:0.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-left:0.5rem}
        .btn-signout{background:#fffdf4;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.85rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.4rem 1rem;cursor:pointer}
        .btn-signout:hover{background:#ffe066}
        .back{display:inline-block;color:#003399;text-decoration:none;font-size:0.85rem;font-weight:600;margin-bottom:1.5rem}
        .back:hover{text-decoration:underline}
        .placeholder-msg{color:#888;font-size:0.88rem;font-weight:400;line-height:1.7}
      `}</style>
      <div className="container">
        <Link href="/" className="back">← Back to Comic Bundle Finder</Link>

        <div className="title-panel">
          <h1>My Account</h1>
          <div className="tagline">Manage your profile &amp; saved data</div>
        </div>

        <div className="panel">
          <div className="caption">Profile</div>
          <div className="user-info">
            {session?.user?.image ? (
              <img className="avatar" src={session.user.image} alt="" />
            ) : (
              <div className="avatar-placeholder">
                {(session?.user?.name || session?.user?.email || "?")[0].toUpperCase()}
              </div>
            )}
            <div>
              <div className="user-name">
                {session?.user?.name || session?.user?.email}
                <span className="tier-badge">{session?.user?.tier ?? "free"}</span>
              </div>
              {session?.user?.name && <div className="user-email">{session?.user?.email}</div>}
            </div>
          </div>
          <button className="btn-signout" onClick={() => signOut({ callbackUrl: "/" })}>
            Sign Out
          </button>
        </div>

        <div className="panel">
          <div className="caption">Saved Searches</div>
          <p className="placeholder-msg">Your saved searches will appear here. Coming soon.</p>
        </div>

        <div className="panel">
          <div className="caption">League of Comic Geeks</div>
          <p className="placeholder-msg">Link your LOCG profile to sync your collection and wishlist. Coming soon.</p>
        </div>
      </div>
    </>
  );
}
