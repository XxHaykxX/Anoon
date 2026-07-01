export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // всегда свежий — по нему клиент ловит новый деплой

// GET /api/version → { v } (commit sha текущего деплоя). Клиент опрашивает и авто-перезагружается.
export async function GET() {
  const v = process.env.NEXT_PUBLIC_BUILD_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";
  return new Response(JSON.stringify({ v }), {
    headers: { "content-type": "application/json", "cache-control": "no-store, max-age=0" },
  });
}
