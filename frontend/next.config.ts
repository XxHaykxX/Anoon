import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  // Две сборки этого приложения должны уживаться рядом: боевая (реальный режим,
  // `NEXT_PUBLIC_USE_TINODE=1`, её гоняет набор `tests/e2e/real`) и мок-сборка
  // для набора `tests/e2e/*` — `NEXT_PUBLIC_*` подставляется НА СБОРКЕ, поэтому
  // одним артефактом оба набора не покрыть. Без своего каталога вторая сборка
  // затирала первую, и «прогнать мок-набор» означало сломать стенд.
  //
  // Мок-набор нельзя гонять и против `next dev`: dev-оверлей «issues» рисует
  // счётчик, который ловится тестовыми селекторами (`getByText("0")` в кошельке
  // — strict mode violation). `devIndicators: false` его не убирает.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Allow the Cloudflare Tunnel host to load /_next/* dev resources (client
  // chunks, fonts, HMR) — without this Next dev blocks them cross-origin and the
  // page never hydrates (all buttons dead). Wildcard covers the rotating URL.
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "conclusion-bathrooms-prices-weblogs.trycloudflare.com",
  ],
  // The dev indicator badge renders bottom-left, exactly on top of the phone
  // frame's bottom nav — it swallows clicks on «Чаты» and breaks the e2e suite
  // (and manual tapping) with "nextjs-portal intercepts pointer events".
  devIndicators: false,
  // The app lived at /badu until the 2026-08-05 rename. Bookmarks, installed
  // home-screen shortcuts and any shared link still point there — without these
  // the old URL is a bare 404.
  async redirects() {
    return [
      { source: "/badu", destination: "/anoon", permanent: true },
      { source: "/badu/:path*", destination: "/anoon/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
