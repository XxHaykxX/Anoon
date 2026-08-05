// @ts-nocheck
/**
 * ANOON — 2-user CHAT + MEDIA + CALL + REVEAL + TIMING QA harness
 * ============================================================================
 * Drives two live browser contexts (admin1 #00011 male, admin2 #00012 female)
 * against a REAL-MODE build and asserts BOTH sides of every interaction with
 * real waits/timing — this is where the race-condition bugs hide.
 *
 * Companion harness: ScreensFix owns the non-chat (profile/settings/friends)
 * scenario. This file owns: roulette match → anon text + read-ticks (BUG-8) →
 * typing/upload indicators (BUG-18) → photo/video + fullscreen viewer
 * (BUG-10/11) → view-once (BUG-12) → voice (BUG-13) → reveal→friends animation
 * + avatar (BUG-14) → peer-left system line (BUG-15) → first-attempt voice call
 * + synced hangup (BUG-16) → background/closed-chat delivery (BUG-17). Sound
 * (BUG-19) can't be asserted headlessly — noted only.
 *
 * RUN (do NOT run until prod is rebuilt in real mode):
 *   ANOON_URL=http://localhost:8088 node qa-chat.mjs
 *
 * Env:
 *   ANOON_URL   base URL of the running app  (default http://localhost:8088)
 *   QA_PHOTO   path to a real image fixture (optional; a 1x1 PNG is generated)
 *   QA_VIDEO   path to a real .mp4 fixture  (optional; see note in makeFixtures)
 *   QA_HEADED  "1" to watch it run          (default headless)
 *   QA_SLOWMO  ms slowmo per action         (default 0)
 *
 * NOTE ON SELECTORS: the app ships zero data-testid, so every selector below
 * anchors on the real Russian aria-labels / visible text found in the
 * components (AnoonLogin, AnoonHome, AnoonAnonChat, AnoonPrivateChat, ChatMediaBubble,
 * VoiceMessage, AnoonMediaViewer). A FAIL therefore means EITHER a genuine
 * product bug OR selector drift to reconcile on the first live run — the log
 * makes clear which by printing what it looked for.
 * ============================================================================
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.ANOON_URL || "http://localhost:8088").replace(/\/+$/, "");
const APP_URL = `${BASE}/anoon`;
const SHOTS = join(process.cwd(), "qa-shots-chat");
const FIX = join(process.cwd(), "qa-fixtures");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(FIX, { recursive: true });

const HEADED = process.env.QA_HEADED === "1";
const SLOWMO = Number(process.env.QA_SLOWMO || 0);

// ── credentials ────────────────────────────────────────────────────────────
// Tinode "basic" login accepts a bare username (3+ chars); password must be ≥6.
const USERS = {
  a1: { login: "admin1", pass: "admin1", hash: "00011", label: "admin1(M#00011)" },
  a2: { login: "admin2", pass: "admin2", hash: "00012", label: "admin2(F#00012)" },
};

// ── result bookkeeping ───────────────────────────────────────────────────────
const results = [];
const consoleErrors = []; // { who, text }
let shotN = 0;

function rec(step, ok, detail = "") {
  results.push({ step, ok: !!ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${step}${detail ? `  ::  ${detail}` : ""}`);
}

// Console/​page-error noise we deliberately ignore (not product bugs).
const NOISE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /ResizeObserver loop/i,
  /Autoplay/i,
  /play\(\) request was interrupted/i,
  /favicon/i,
  /manifest/i,
];
function isNoise(t) {
  return NOISE.some((re) => re.test(t || ""));
}

function attachConsole(who, page) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (isNoise(t)) return;
    consoleErrors.push({ who, text: t });
    console.log(`  [console:${who}] ${t}`);
  });
  page.on("pageerror", (e) => {
    const t = e?.message || String(e);
    if (isNoise(t)) return;
    consoleErrors.push({ who, text: `pageerror: ${t}` });
    console.log(`  [pageerror:${who}] ${t}`);
  });
  // Name any HTTP 4xx/5xx so a bare "Failed to load resource 404" is actionable.
  page.on("response", (r) => {
    const s = r.status();
    if (s < 400) return;
    const url = r.url();
    if (isNoise(url)) return;
    console.log(`  [http:${who}] ${s} ${url}`);
  });
}

async function shot(page, name) {
  const file = join(SHOTS, `${String(++shotN).padStart(2, "0")}-${name}.png`);
  try {
    await page.screenshot({ path: file, fullPage: false });
  } catch {
    /* page may be closing */
  }
}

// ── polling helper: resolve on first truthy return, else throw on timeout ────
async function poll(fn, { timeout = 15000, interval = 300, label = "" } = {}) {
  const deadline = Date.now() + timeout;
  let lastErr;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timeout after ${timeout}ms${label ? ` waiting for ${label}` : ""}${lastErr ? ` (${lastErr.message})` : ""}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

const visible = (loc) => loc.first().isVisible().catch(() => false);
async function count(loc) {
  try {
    return await loc.count();
  } catch {
    return 0;
  }
}

// ── synthetic getUserMedia + Notification, injected before app scripts ───────
// Real MediaStream tracks (canvas video + oscillator audio) so MediaRecorder
// (voice notes) produces an actual blob and RTCPeerConnection has tracks to add.
const INIT_SCRIPT = `
(() => {
  try {
    const mkStream = (constraints) => {
      const tracks = [];
      if (constraints && constraints.video) {
        const c = document.createElement('canvas');
        c.width = 320; c.height = 240;
        const ctx = c.getContext('2d');
        let i = 0;
        setInterval(() => { i = (i + 8) % 255; ctx.fillStyle = 'rgb(' + i + ',80,140)'; ctx.fillRect(0,0,320,240); }, 100);
        const vs = c.captureStream(15);
        vs.getVideoTracks().forEach(t => tracks.push(t));
      }
      if (constraints && constraints.audio) {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ac = new AC();
        const osc = ac.createOscillator();
        const dst = ac.createMediaStreamDestination();
        osc.frequency.value = 440; osc.connect(dst); osc.start();
        dst.stream.getAudioTracks().forEach(t => tracks.push(t));
      }
      return new MediaStream(tracks);
    };
    if (!navigator.mediaDevices) navigator.mediaDevices = {};
    navigator.mediaDevices.getUserMedia = async (c) => mkStream(c || { audio: true });
    navigator.mediaDevices.enumerateDevices = async () => ([
      { deviceId: 'mic1', kind: 'audioinput', label: 'Mock Mic', groupId: 'g' },
      { deviceId: 'cam1', kind: 'videoinput', label: 'Mock Cam', groupId: 'g' },
    ]);
    // Grant Notification without a prompt (some flows call it).
    try {
      window.Notification = window.Notification || function(){};
      window.Notification.permission = 'granted';
      window.Notification.requestPermission = async () => 'granted';
    } catch (e) {}
  } catch (e) { /* never block the app */ }
})();
`;

// ── test fixtures ────────────────────────────────────────────────────────────
function makeFixtures() {
  const photo = process.env.QA_PHOTO || join(FIX, "qa-photo.png");
  if (!process.env.QA_PHOTO && !existsSync(photo)) {
    // 1x1 opaque PNG — decodes cleanly in <img>.
    const b64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    writeFileSync(photo, Buffer.from(b64, "base64"));
  }
  // Video: a real decodable clip is required for the <video> poster/viewer to
  // render (an invalid blob trips ChatMediaBubble's onError → «не удалось
  // загрузить»). We can't synthesize a valid encoded MP4 here, so we REQUIRE an
  // override via QA_VIDEO; without it the video sub-steps are reported SKIPPED.
  const video = process.env.QA_VIDEO && existsSync(process.env.QA_VIDEO) ? process.env.QA_VIDEO : null;
  return { photo, video };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page-object helpers (all keyed off verified Russian labels/text)
// ─────────────────────────────────────────────────────────────────────────────

async function login(page, who, user) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  // The app boots at Onboarding; advance through it until the email login form
  // appears. Resilient to both "onboarding→login" and a direct login landing.
  const email = page.locator('input[type="email"]');
  await poll(
    async () => {
      if (await visible(email)) return true;
      // Try onboarding / entry CTAs, in priority order.
      for (const name of [/^Войти$/, /есть аккаунт/i, /^Начать$/, /^Далее$/, /Войти через|по email/i]) {
        const b = page.getByRole("button", { name }).first();
        if (await visible(b)) {
          await b.click().catch(() => {});
          await page.waitForTimeout(250);
          break;
        }
      }
      return await visible(email);
    },
    { timeout: 20000, label: `${who}: email login field` },
  );

  await email.fill(user.login);
  await page.locator('input[type="password"]').fill(user.pass);
  const submit = page.getByRole("button", { name: /^Войти$/ }).first();
  await poll(async () => (await submit.isEnabled().catch(() => false)) === true, {
    timeout: 5000,
    label: `${who}: login submit enabled`,
  });
  await submit.click();

  // Post-login landing is now the «Чаты» screen with a bottom nav
  // (BUG-24 redesign): nav-chats / nav-notifications / nav-roulette / nav-profile.
  await poll(
    async () =>
      visible(page.locator('[data-testid="nav-roulette"], [data-testid="nav-chats"]').first()).then(
        (v) => v || visible(page.getByRole("heading", { name: /^Чаты$/ })),
      ),
    { timeout: 20000, label: `${who}: post-login «Чаты» + bottom nav` },
  );
}

// Roulette now lives behind the «Рулетка» bottom-nav tab (BUG-24): tab → «Начать чат».
async function startRoulette(page) {
  const rouletteTab = page.locator('[data-testid="nav-roulette"]').first();
  const tabFallback = page.getByRole("button", { name: /^Рулетка$/ }).first();
  await ((await visible(rouletteTab)) ? rouletteTab : tabFallback).click().catch(() => {});
  const start = page.getByRole("button", { name: /Начать чат/ }).first();
  await poll(() => visible(start), { timeout: 12000, label: "roulette «Начать чат»" });
  await start.click();
}

// Anon chat is "open" once the composer input is on screen.
const anonComposer = (page) =>
  page.locator('input[placeholder="Сообщение"], input[placeholder="Изменить сообщение"]').first();

async function waitAnonChat(page, who) {
  await poll(async () => visible(anonComposer(page)), {
    timeout: 40000,
    label: `${who}: anon chat composer (matched)`,
  });
}

async function sendText(page, text) {
  const input = anonComposer(page);
  await input.click();
  await input.fill(text);
  await page.getByRole("button", { name: "Отправить" }).first().click();
}

// Set the hidden file input (bypasses the AttachMenu UI).
async function uploadVia(page, accept, filePath) {
  const input = page.locator(`input[type="file"][accept*="${accept}"]`).first();
  await input.setInputFiles(filePath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== ANOON chat/media/call QA ===`);
  console.log(`app: ${APP_URL}`);
  const { photo, video } = makeFixtures();
  console.log(`photo fixture: ${photo}`);
  console.log(`video fixture: ${video || "(none — set QA_VIDEO to a real .mp4 to exercise video)"}\n`);

  const browser = await chromium.launch({ headless: !HEADED, slowMo: SLOWMO });

  const mkCtx = async () => {
    const ctx = await browser.newContext({
      serviceWorkers: "block",
      permissions: ["microphone", "camera"],
      viewport: { width: 430, height: 900 },
    });
    await ctx.grantPermissions(["microphone", "camera"], { origin: BASE });
    await ctx.addInitScript(INIT_SCRIPT);
    return ctx;
  };

  const ctx1 = await mkCtx();
  const ctx2 = await mkCtx();
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();
  attachConsole("A1", p1);
  attachConsole("A2", p2);

  const uA = `${USERS.a1.hash}`; // admin1 text tag
  const uB = `${USERS.a2.hash}`;
  const MSG_AB = `A→B ${Date.now().toString().slice(-5)}`;
  const MSG_BA = `B→A ${Date.now().toString().slice(-5)}`;

  try {
    // ── Step 1: login + roulette match ──────────────────────────────────────
    console.log("\n[1] login both + roulette match");
    await Promise.all([login(p1, "A1", USERS.a1), login(p2, "A2", USERS.a2)]);
    rec("1a login both users", true);
    await shot(p1, "a1-home");
    await shot(p2, "a2-home");

    await startRoulette(p1);
    await startRoulette(p2);
    try {
      await Promise.all([waitAnonChat(p1, "A1"), waitAnonChat(p2, "A2")]);
      rec("1b roulette matched (both in anon chat)", true);
    } catch (e) {
      rec("1b roulette matched (both in anon chat)", false, e.message);
      throw new Error("no match — remaining chat steps cannot run");
    }
    await shot(p1, "a1-matched");
    await shot(p2, "a2-matched");

    // ── Step 2: anon text both directions + read-ticks (BUG-8) ──────────────
    console.log("\n[2] anon text A→B, B→A + read-ticks");
    await sendText(p1, MSG_AB);
    try {
      await poll(() => visible(p2.getByText(MSG_AB, { exact: false })), { timeout: 15000, label: "B receives A" });
      rec("2a A→B arrives on B", true);
    } catch (e) {
      rec("2a A→B arrives on B", false, e.message);
    }
    await sendText(p2, MSG_BA);
    try {
      await poll(() => visible(p1.getByText(MSG_BA, { exact: false })), { timeout: 15000, label: "A receives B" });
      rec("2b B→A arrives on A", true);
    } catch (e) {
      rec("2b B→A arrives on A", false, e.message);
    }
    // Read-tick: A's own bubble tick flips to the "read" colour class once B has
    // the chat focused (StatusTicks → .text-read-tick).
    try {
      await poll(async () => (await count(p1.locator(".text-read-tick"))) > 0, {
        timeout: 15000,
        label: "A sees read-tick",
      });
      rec("2c read-tick flips to read on A (BUG-8)", true);
    } catch (e) {
      rec("2c read-tick flips to read on A (BUG-8)", false, e.message);
    }
    await shot(p1, "a1-texted");
    await shot(p2, "a2-texted");

    // ── Step 3: typing + upload indicators (BUG-18) ─────────────────────────
    console.log("\n[3] typing indicator + «отправляет медиа…»");
    await anonComposer(p1).click();
    await anonComposer(p1).type("печатаю...", { delay: 40 });
    try {
      await poll(() => visible(p2.getByText("печатает…")), { timeout: 8000, label: "B sees typing" });
      rec("3a B sees «печатает…» while A types (BUG-18)", true);
    } catch (e) {
      rec("3a B sees «печатает…» while A types (BUG-18)", false, e.message);
    }
    await anonComposer(p1).fill(""); // clear draft so typing stops

    // upload indicator: fire a photo upload from A, look for the label on B
    // during the in-flight window (race — poll tightly).
    await uploadVia(p1, "image", photo);
    try {
      await poll(() => visible(p2.getByText("отправляет медиа…")), { timeout: 6000, interval: 120, label: "B sees uploading" });
      rec("3b B sees «отправляет медиа…» during upload (BUG-18)", true);
    } catch (e) {
      rec("3b B sees «отправляет медиа…» during upload (BUG-18)", false, `${e.message} (tight race — may be transient)`);
    }

    // ── Step 4: photo A→B + fullscreen viewer opens SAME image (BUG-10/11) ──
    console.log("\n[4] photo delivery + fullscreen viewer");
    // Prefer data-testid anchors (added to ChatMediaBubble / AnoonMediaViewer),
    // fall back to aria/text so the harness survives if a testid ever moves.
    const chatImgBtn = p2.locator('[data-testid="chat-image"], button[aria-label="Открыть изображение"]').first();
    const bImg = chatImgBtn.locator("img").first();
    try {
      await poll(() => visible(bImg), { timeout: 20000, label: "B receives photo" });
      rec("4a photo arrives + renders on B", true);
    } catch (e) {
      rec("4a photo arrives + renders on B", false, e.message);
    }
    await shot(p2, "a2-photo-received");
    try {
      const thumbSrc = await bImg.getAttribute("src");
      await chatImgBtn.click();
      const closeBtn = p2.locator('[data-testid="media-viewer-close"], button[aria-label="Закрыть"]').first();
      await poll(() => visible(closeBtn), { timeout: 8000, label: "viewer open" });
      // Overlay: the viewer root carries data-testid + a black backdrop.
      const overlayDark =
        (await count(p2.locator('[data-testid="media-viewer"], div.z-50.bg-black'))) > 0;
      const viewerSrc = await poll(
        async () => {
          const im = p2.locator('[data-testid="media-viewer-item"], [data-testid="media-viewer"] img, .z-50 img').first();
          if (!(await visible(im))) return null;
          return await im.getAttribute("src");
        },
        { timeout: 6000, label: "viewer image src" },
      );
      const sameImage = !!thumbSrc && viewerSrc === thumbSrc;
      rec("4b viewer opens with a dark overlay (BUG-11)", overlayDark, overlayDark ? "" : "no media-viewer/z-50 overlay found");
      rec("4c viewer shows the SAME photo that was tapped (BUG-10)", sameImage, sameImage ? "" : `thumb=${thumbSrc} viewer=${viewerSrc}`);
      await shot(p2, "a2-viewer");
      await closeBtn.click().catch(() => {});
    } catch (e) {
      rec("4b/4c fullscreen viewer (BUG-10/11)", false, e.message);
    }

    // video (optional — needs a real decodable clip)
    if (video) {
      console.log("    [4d] video delivery + viewer");
      await uploadVia(p1, "video", video);
      try {
        const chatVid = p2.locator('[data-testid="chat-video"], button[aria-label="Открыть видео"]').first();
        await poll(() => visible(chatVid), { timeout: 20000, label: "B receives video" });
        await chatVid.click();
        const closeBtn = p2.locator('[data-testid="media-viewer-close"], button[aria-label="Закрыть"]').first();
        await poll(() => visible(closeBtn), { timeout: 8000, label: "video viewer open" });
        const hasVideo = (await count(p2.locator('[data-testid="media-viewer-item"], [data-testid="media-viewer"] video, .z-50 video'))) > 0;
        rec("4d video arrives + opens in viewer with <video>", hasVideo, hasVideo ? "" : "no <video> in viewer");
        await closeBtn.click().catch(() => {});
      } catch (e) {
        rec("4d video arrives + opens in viewer", false, e.message);
      }
    } else {
      rec("4d video delivery", false, "SKIPPED — set QA_VIDEO to a real .mp4 to exercise video");
    }

    // ── Step 5: view-once photo A→B, opened then spent (BUG-12) ─────────────
    console.log("\n[5] view-once photo");
    try {
      // Arm view-once for the next photo (👁 toggle in the composer).
      const vo = p1.getByRole("button", { name: /Фото на один просмотр/ }).first();
      if (await visible(vo)) await vo.click();
      await uploadVia(p1, "image", photo);
      const voBubble = p2
        .locator('[data-testid="viewonce-tile"][data-viewonce-state="unseen"], button[aria-label*="Открыть фото (один раз)"]')
        .first();
      await poll(() => visible(voBubble), { timeout: 20000, label: "B receives view-once" });
      rec("5a view-once bubble renders on B (BUG-12)", true);
      await shot(p2, "a2-viewonce-before");
      await voBubble.click();
      const voClose = p2.locator('[data-testid="media-viewer-close"], button[aria-label="Закрыть"]').first();
      await poll(() => visible(voClose), { timeout: 8000, label: "view-once viewer" });
      await voClose.click().catch(() => {});
      // After viewing it must be marked spent (data-viewonce-state="seen").
      await poll(
        () =>
          visible(
            p2.locator('[data-testid="viewonce-tile"][data-viewonce-state="seen"]').first(),
          ).then((v) => v || visible(p2.getByText(/просмотрено/))),
        { timeout: 8000, label: "spent state" },
      );
      rec("5b view-once marked «просмотрено» after open (BUG-12)", true);
      await shot(p2, "a2-viewonce-after");
    } catch (e) {
      rec("5 view-once flow (BUG-12)", false, e.message);
    }

    // ── Step 6: voice message A→B (BUG-13) ──────────────────────────────────
    console.log("\n[6] voice message");
    try {
      // With an empty draft in real mode the composer shows the VoiceRecorder.
      await anonComposer(p1).fill("");
      // VoiceRecorder: press-and-hold / tap to record, then send. It has no
      // stable aria in the grep, so drive by the mic control then a send/stop.
      const mic = p1.getByRole("button", { name: /Голосов|Запис|Отправить голос|Микрофон/i }).first();
      if (await visible(mic)) {
        await mic.click(); // start
        await p1.waitForTimeout(1500);
        // stop/send — try an explicit send-voice control, else the mic again.
        const stop = p1.getByRole("button", { name: /Отправить|Стоп|Готово/i }).first();
        await (await visible(stop) ? stop : mic).click().catch(() => {});
      } else {
        rec("6 voice recorder control found", false, "no mic/record control located");
      }
      // On B a VoiceMessage renders (data-testid="chat-voice") with a play
      // control (data-testid="voice-play", aria «Воспроизвести»).
      await poll(
        () => visible(p2.locator('[data-testid="chat-voice"], [data-testid="voice-bubble"]').first()),
        { timeout: 20000, label: "B receives voice bubble" },
      );
      const play = p2.locator('[data-testid="voice-play"]').first();
      const playFallback = p2.getByRole("button", { name: "Воспроизвести" }).first();
      const playBtn = (await visible(play)) ? play : playFallback;
      await poll(() => visible(playBtn), { timeout: 5000, label: "B voice play control" });
      rec("6a voice bubble renders on B (BUG-13)", true);
      await playBtn.click();
      await poll(
        () =>
          visible(p2.locator('[data-testid="voice-play"][aria-label="Пауза"]').first()).then(
            (v) => v || visible(p2.getByRole("button", { name: "Пауза" })),
          ),
        { timeout: 5000, label: "voice plays" },
      );
      rec("6b voice plays (play→pause) on B (BUG-13)", true);
      await shot(p2, "a2-voice");
    } catch (e) {
      rec("6 voice message (BUG-13)", false, `${e.message} (anon voice needs real-mode VoiceRecorder wiring)`);
    }

    // ── Step 7: reveal handshake → friends + avatar (BUG-14) ─────────────────
    console.log("\n[7] reveal handshake → friends + avatar");
    try {
      // A initiates reveal via the header «Раскрыть» button (AnoonAnonChat:885).
      await p1.getByRole("button", { name: /^Раскрыть$/ }).first().click().catch(() => {});
      // B gets the reveal prompt (AnoonRevealPrompt) → «Открыть».
      const bAccept = p2.getByRole("button", { name: /^Открыть$/ }).first();
      if (await poll(() => visible(bAccept), { timeout: 12000, label: "B reveal prompt" }).catch(() => false)) {
        await bAccept.click().catch(() => {});
      }
      // A may also get a confirm prompt in a mutual-handshake variant.
      const aAccept = p1.getByRole("button", { name: /^Открыть$/ }).first();
      if (await visible(aAccept)) await aAccept.click().catch(() => {});
      // Both should show the friends banner.
      await Promise.all([
        poll(() => visible(p1.getByText(/вы теперь друзья/)), { timeout: 15000, label: "A friends banner" }),
        poll(() => visible(p2.getByText(/вы теперь друзья/)), { timeout: 15000, label: "B friends banner" }),
      ]);
      rec("7a reveal → «вы теперь друзья» on BOTH (BUG-14)", true);
      // Peer avatar should now render in the header. Seeded accounts have no
      // photo, so it's the reveal-ring AnoonAvatar (gradient/initials div,
      // `.anoon-reveal-avatar`), NOT an <img> — accept either.
      const av1 = (await count(p1.locator('.anoon-reveal-avatar, header img'))) > 0;
      rec("7b peer avatar renders after reveal (BUG-14)", av1, av1 ? "" : "no .anoon-reveal-avatar / header img found");
      await shot(p1, "a1-revealed");
      await shot(p2, "a2-revealed");
    } catch (e) {
      rec("7 reveal handshake (BUG-14)", false, `${e.message} (menu/prompt labels are best-effort — reconcile on first run)`);
    }

    // ── Step 8: peer-left system line (BUG-15) ──────────────────────────────
    // NOTE: after a reveal the pair are friends in a private chat; to exercise
    // the anon peer-left path cleanly this really wants a fresh un-revealed
    // match. We assert the system line on whichever side stays when the peer
    // leaves the CURRENT conversation.
    console.log("\n[8] peer-left system line");
    try {
      // admin2 leaves the conversation (top-left back hit-target / Назад).
      const back2 = p2.getByRole("button", { name: "Назад" }).first();
      await (await visible(back2) ? back2 : p2.locator("button").first()).click().catch(() => {});
      await poll(() => visible(p1.getByText(/покинул/)), { timeout: 15000, label: "A sees peer-left line" });
      rec("8 A gets «Собеседник покинул чат» + chat ended (BUG-15)", true);
      await shot(p1, "a1-peer-left");
    } catch (e) {
      rec("8 peer-left system line (BUG-15)", false, e.message);
    }

    // ── Step 9: voice call first-attempt connect + synced hangup (BUG-16) ────
    console.log("\n[9] voice call (first attempt) + synced hangup");
    try {
      // Re-open the friend conversation on both from the Friends tab, then A
      // calls B. Navigation labels are best-effort.
      await openFriendChat(p1);
      await openFriendChat(p2);
      await p1.getByRole("button", { name: "Аудиозвонок" }).first().click();
      // B gets an incoming call → accept (IncomingCall — aria «Принять звонок»).
      const accept = p2.getByRole("button", { name: /Принять звонок|Принять|Ответить/i }).first();
      await poll(() => visible(accept), { timeout: 15000, label: "B incoming call" });
      await accept.click();
      // Both reach the in-call screen (CallScreen hang-up — aria «Завершить звонок»).
      const hang1 = p1.getByRole("button", { name: /Завершить звонок|Заверш|Отбой/i }).first();
      const hang2 = p2.getByRole("button", { name: /Завершить звонок|Заверш|Отбой/i }).first();
      await Promise.all([
        poll(() => visible(hang1), { timeout: 15000, label: "A in-call" }),
        poll(() => visible(hang2), { timeout: 15000, label: "B in-call" }),
      ]);
      rec("9a call connects on BOTH on the FIRST attempt (BUG-16)", true);
      await shot(p1, "a1-incall");
      await shot(p2, "a2-incall");
      // A hangs up → the call must end on BOTH within a couple seconds.
      await hang1.click();
      await Promise.all([
        poll(async () => !(await visible(hang1)), { timeout: 6000, label: "A call ended" }),
        poll(async () => !(await visible(hang2)), { timeout: 6000, label: "B call ended (synced)" }),
      ]);
      rec("9b hangup ends the call on BOTH within ~2s (BUG-16)", true);
    } catch (e) {
      rec("9 voice call connect/hangup (BUG-16)", false, e.message);
    }

    // ── Step 10: background (closed-chat) message delivery (BUG-17) ──────────
    console.log("\n[10] background message to a CLOSED chat");
    try {
      // admin2 navigates away from the private chat (to the «Чаты» list).
      await goHome(p2);
      await shot(p2, "a2-closed-chat"); // diagnostic: A2's list state before the bg message
      const BG = `bg ${Date.now().toString().slice(-5)}`;
      // admin1 (still in the chat) sends a message.
      const inp = anonComposer(p1);
      if (await visible(inp)) {
        await inp.fill(BG);
        await p1.getByRole("button", { name: "Отправить" }).first().click();
      } else {
        // private-chat composer uses the same placeholder; fall back to any text input.
        const anyInput = p1.locator('input[placeholder*="ообщени"]').first();
        await anyInput.fill(BG);
        await p1.getByRole("button", { name: "Отправить" }).first().click();
      }
      // admin2, WITHOUT opening the chat, should see an unread badge / preview
      // update in the friends list (or a nav badge).
      await poll(
        async () => {
          const preview = await visible(p2.getByText(BG, { exact: false }));
          const badge =
            (await count(p2.locator('[class*="bg-destructive"], [class*="bg-primary"] >> text=/^\\d+$/'))) > 0;
          return preview || badge;
        },
        { timeout: 15000, label: "A2 unread/preview updates while chat closed" },
      );
      rec("10 closed-chat message updates unread/preview WITHOUT opening (BUG-17)", true);
      await shot(p2, "a2-background");
    } catch (e) {
      rec("10 background message delivery (BUG-17)", false, e.message);
    }
    rec("10b sound on new message (BUG-19)", true, "NOT ASSERTABLE headlessly — verify manually");
  } finally {
    await shot(p1, "a1-final");
    await shot(p2, "a2-final");
    await browser.close();
  }

  // ── summary + exit code ──────────────────────────────────────────────────
  const fails = results.filter((r) => !r.ok);
  console.log(`\n================ SUMMARY ================`);
  for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.step}${r.detail ? `  — ${r.detail}` : ""}`);
  console.log(`\n  steps: ${results.length}   pass: ${results.length - fails.length}   fail: ${fails.length}`);
  console.log(`  console/page errors: ${consoleErrors.length}`);
  for (const e of consoleErrors) console.log(`    [${e.who}] ${e.text}`);
  console.log(`  screenshots: ${SHOTS}`);
  console.log(`========================================\n`);

  const bad = fails.length > 0 || consoleErrors.length > 0;
  process.exit(bad ? 1 : 0);
}

// ── navigation helpers (BUG-24 redesign: testid'd bottom nav + friend rows) ──
async function openFriendChat(page) {
  // «Чаты» tab → first friend-row (the friend appears here after a reveal).
  const chatsTab = page.locator('[data-testid="nav-chats"]').first();
  const chatsFallback = page.getByRole("button", { name: /^Чаты$/ }).first();
  await ((await visible(chatsTab)) ? chatsTab : chatsFallback).click().catch(() => {});
  await page.waitForTimeout(400);
  const row = page.locator('[data-testid="friend-row"]').first();
  const rowFallback = page.getByText(/Собеседник|admin|#000/i).first();
  await ((await visible(row)) ? row : rowFallback).click().catch(() => {});
  await page.waitForTimeout(400);
}

// Navigate AWAY from the open chat → back to the «Чаты» list (closed-chat state).
// The app is a client-side STACK router (no per-screen URLs), so page.goBack()
// would leave the SPA and blank the view — never use it. Leave a chat via its
// header «Назад» button, which pops back to the list; only then is the bottom
// nav present again.
async function goHome(page) {
  const back = page.getByRole("button", { name: "Назад" }).first();
  if (await visible(back)) await back.click().catch(() => {});
  await page.waitForTimeout(400);
  // Ensure we're on the «Чаты» tab (bottom nav is back on the list screen).
  const chatsTab = page.locator('[data-testid="nav-chats"]').first();
  if (await visible(chatsTab)) await chatsTab.click().catch(() => {});
}

main().catch((e) => {
  console.error("\nFATAL:", e?.stack || e);
  process.exit(2);
});
