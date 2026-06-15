import { NextResponse } from "next/server";

// Maintenance-mode gate.
//
// Activate by setting MAINTENANCE_MODE=1 in the Vercel project's env vars and
// redeploying. While active, every visitor gets a styled 503 "back soon" page.
// Set it back to 0 (or remove it) and redeploy to restore the site.
//
// Owner bypass: set MAINTENANCE_BYPASS_TOKEN to a secret string, then visit
//   https://<site>/?bypass=<that-token>
// once. A cookie is set so you can browse the real site normally for 8 hours
// (e.g. to verify post-merge fixes) while everyone else still sees maintenance.

export const config = {
  // Run on all routes except Next internals and common static asset requests.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};

const BYPASS_COOKIE = "cbf-maintenance-bypass";

const MAINTENANCE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Back soon — Comic Bundle Finder</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    font-family: "Oswald", sans-serif;
    color: #1a1a1a;
    background-color: #f0e6c4;
    background-image: radial-gradient(#1a1a1a 1px, transparent 1px);
    background-size: 18px 18px;
  }
  .panel {
    max-width: 540px;
    width: 100%;
    background: #fffdf4;
    border: 3px solid #1a1a1a;
    box-shadow: 6px 6px 0 #1a1a1a;
    padding: 40px 32px;
    text-align: center;
  }
  .pill {
    display: inline-block;
    background: #ffe066;
    border: 2px solid #1a1a1a;
    padding: 4px 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-size: 14px;
    margin-bottom: 20px;
  }
  h1 {
    font-family: "Bangers", cursive;
    color: #cc1f00;
    font-size: 48px;
    line-height: 1.05;
    margin: 0 0 16px;
    letter-spacing: 1px;
  }
  p { font-size: 18px; line-height: 1.5; margin: 0 0 12px; }
  .small { font-size: 15px; color: #555; margin-top: 24px; }
</style>
</head>
<body>
  <main class="panel">
    <span class="pill">Hang tight!</span>
    <h1>We're Updating the Shelves</h1>
    <p>Comic Bundle Finder is undergoing maintenance while we roll out a big update.</p>
    <p>Please check back later today &mdash; we'll be open for business soon.</p>
    <p class="small">Thanks for your patience.</p>
  </main>
</body>
</html>`;

export function proxy(req) {
  if (process.env.MAINTENANCE_MODE !== "1") return NextResponse.next();

  const token = process.env.MAINTENANCE_BYPASS_TOKEN;

  // Owner bypass via ?bypass=<token> — sets a cookie, then lets the request through.
  if (token) {
    const queryToken = req.nextUrl.searchParams.get("bypass");
    if (queryToken === token) {
      const res = NextResponse.next();
      res.cookies.set(BYPASS_COOKIE, token, {
        path: "/",
        maxAge: 60 * 60 * 8, // 8 hours
        httpOnly: true,
        sameSite: "lax",
      });
      return res;
    }
    if (req.cookies.get(BYPASS_COOKIE)?.value === token) {
      return NextResponse.next();
    }
  }

  return new NextResponse(MAINTENANCE_HTML, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "3600",
    },
  });
}
