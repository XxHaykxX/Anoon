import type { NextConfig } from "next";

// Уникальный id сборки: commit sha (если есть) иначе таймстамп билда. Меняется каждый деплой →
// клиент ловит его через /api/version и авто-перезагружается на новую версию.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now());

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
};

export default nextConfig;
