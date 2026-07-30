import type { Metadata } from "next";
import { PRODUCT_NAME } from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import { AppFooter } from "@/components/app-footer";
import { FeatureFlagsProvider } from "@/feature-flags/feature-flags-context";
import { Doto, Figtree, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const doto = Doto({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-data",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description:
    "Last.fm–compatible listening analytics MVP shell — no fabricated metrics.",
};

/** Read `FEATURE_FLAGS` (and the rest of `loadServerEnv`) at request time, not at build. */
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const env = loadServerEnv();
  return (
    <html
      lang="en"
      className={`dark ${doto.variable} ${figtree.variable} ${jetbrainsMono.variable}`}
    >
      <body className="flex min-h-screen flex-col antialiased">
        <FeatureFlagsProvider value={env.FEATURE_FLAGS}>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          <AppFooter />
        </FeatureFlagsProvider>
      </body>
    </html>
  );
}
