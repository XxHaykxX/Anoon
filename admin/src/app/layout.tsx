import type { Metadata } from "next";
import { Suspense } from "react";

import "./globals.css";
import { RefineProviders } from "@/providers/refine-providers";

export const metadata: Metadata = {
  title: "anoon · admin",
  description: "Модерация anoon",
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
