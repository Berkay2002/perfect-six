import type { Metadata } from "next";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@/theme/perfect-six.css";
import "./globals.css";

import { AppHeader } from "@/components/app-header";
import { AppProviders } from "@/components/app-providers";

export const metadata: Metadata = {
  title: "Perfect Six — Cobbleverse Team Generator",
  description:
    "Deterministic, source-backed teams of six for Cobbleverse adventure and singles battles.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>
          <AppHeader />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
