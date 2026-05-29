import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

// For API routes: returns the session if premium, otherwise sends 403.
// Usage: const session = await requirePremium(req, res);
//        if (!session) return; // 403 already sent
export async function requirePremium(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    res.status(401).json({ error: "Sign in required." });
    return null;
  }
  if (session.user.tier !== "premium") {
    res.status(403).json({ error: "Premium subscription required." });
    return null;
  }
  return session;
}

// For pages (getServerSideProps): redirects to /upgrade if not premium.
// Usage: export { premiumPageGuard as getServerSideProps }
export async function premiumPageGuard(context) {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session) {
    return { redirect: { destination: "/auth/signin", permanent: false } };
  }
  if (session.user.tier !== "premium") {
    return { redirect: { destination: "/upgrade", permanent: false } };
  }
  return { props: { session } };
}
