import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import EmailProvider from "next-auth/providers/email";
import { PostgresAdapter } from "@auth/pg-adapter";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const authOptions = {
  adapter: PostgresAdapter(pool),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    EmailProvider({
      from: "Comic Bundle Finder <hello@comicbundlefinder.com>",
      sendVerificationRequest: async ({ identifier: email, url }) => {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: "Comic Bundle Finder <hello@comicbundlefinder.com>",
          to: email,
          subject: "Sign in to Comic Bundle Finder",
          html: `
            <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
              <h2 style="color:#cc1f00">Comic Bundle Finder</h2>
              <p>Click the link below to sign in. This link expires in 24 hours.</p>
              <a href="${url}" style="display:inline-block;background:#003399;color:#fff;padding:12px 24px;text-decoration:none;font-weight:bold;margin:16px 0">
                Sign In
              </a>
              <p style="color:#666;font-size:0.85em">If you didn't request this, you can safely ignore this email.</p>
            </div>
          `,
        });
      },
    }),
  ],
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async session({ session, user }) {
      session.user.id = user.id;
      session.user.tier = user.tier ?? "free";
      return session;
    },
  },
};

export default NextAuth(authOptions);
