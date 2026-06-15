import { SessionProvider } from 'next-auth/react';
import { Analytics } from '@vercel/analytics/next';
import "@/styles/globals.css";
import { SpeedInsights } from "@vercel/speed-insights/next";
import UmamiAnalytics from "@/components/UmamiAnalytics";

export default function App({ Component, pageProps: { session, ...pageProps } }) {
  return (
    <SessionProvider session={session}>
      <Component {...pageProps} />
      <UmamiAnalytics />
      <Analytics />
      <SpeedInsights />
    </SessionProvider>
  );
}
