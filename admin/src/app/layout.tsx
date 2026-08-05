import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import "./globals.css";
import { RefineProviders } from "@/providers/refine-providers";

export const metadata: Metadata = {
  title: "anoon · admin",
  description: "Модерация anoon",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "anoon admin" },
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-bg text-fg antialiased">
        {/* Suspense — Refine router использует useSearchParams (CSR bailout при prerender /_not-found). */}
        <Suspense fallback={null}>
          <RefineProviders>{children}</RefineProviders>
        </Suspense>
      </body>
    </html>
  );
}
