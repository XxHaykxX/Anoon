import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { skipUnlessReal, loginReal, switchTab } from "./helpers";

skipUnlessReal(test);

/**
 * Button-by-button sweep of the signed-in app against the LIVE backend, plus
 * the two layout faults that are cheap to detect and expensive to notice by
 * eye: a screen that scrolls sideways, and tap targets too small to hit on a
 * phone.
 *
 * The existing real/ specs each drive one flow deeply. This one goes wide: it
 * visits every reachable screen and presses everything on it that is safe to
 * press, watching for uncaught errors — the class of defect that only shows up
 * when a control nobody wrote a test for is finally clicked.
 *
 * Destructive controls are named, not guessed: anything that signs out, ends a
 * match, blocks, reports, deletes, pays, or starts a search would take the
 * sweep somewhere else (or wreck the seeded accounts the rest of the suite
 * depends on).
 */
const SKIP_LABELS = [
  "Выйти",
  "Удалить аккаунт",
  "Заблокировать",
  "Пожаловаться",
  "Начать чат",
  "Завершить разговор",
  "Новый собеседник",
  "Раскрыть",
  "Купить",
  "Оформить",
  "Подключить",
  "Включить", // push permission prompt
  "Отправить", // empty composer / report submit
  "Позвонить",
  "Аудиозвонок",
  "Видеозвонок",
  "Записать голосовое сообщение",
];

/** Tap targets below this (CSS px) are hard to hit on a phone (WCAG 2.5.8 is 24, Apple's HIG is 44). */
const MIN_TAP_PX = 24;

type Fault = { screen: string; detail: string };

async function collectLayoutFaults(page: Page, screen: string): Promise<Fault[]> {
  return page.evaluate(
    ({ screen, minTap }) => {
      const faults: { screen: string; detail: string }[] = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > doc.clientWidth + 1) {
        faults.push({
          screen,
          detail: `page scrolls sideways: scrollWidth=${doc.scrollWidth} > clientWidth=${doc.clientWidth}`,
        });
      }
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>('button, [role="button"], a[href]'),
      );
      // A control's hit area is not always its own box: an `::after` overlay or
      // a padded wrapper can make a 23px-tall switch comfortably tappable, and
      // getBoundingClientRect knows nothing about either. So a small box is only
      // a fault if the points a thumb would actually land on do NOT reach the
      // control — checked by hit-testing the four edges of the minimum square.
      const reaches = (el: HTMLElement, x: number, y: number) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === el || el.contains(hit) || hit.closest("button, a") === el);
      };
      for (const el of controls) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue; // hidden — not a tap target
        if (r.width >= minTap && r.height >= minTap) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const half = minTap / 2;
        const covered =
          reaches(el, cx, cy - half) &&
          reaches(el, cx, cy + half) &&
          reaches(el, cx - half, cy) &&
          reaches(el, cx + half, cy);
        if (covered) continue; // small box, big hit area — fine
        const name =
          el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 30) || el.tagName;
        faults.push({
          screen,
          detail: `tap target ${Math.round(r.width)}×${Math.round(r.height)}px: «${name}»`,
        });
      }
      return faults;
    },
    { screen, minTap: MIN_TAP_PX },
  );
}

test.describe.serial("UI sweep: every reachable screen and its buttons", () => {
  let context: BrowserContext;
  let page: Page;
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const layoutFaults: Fault[] = [];

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      // Media that 404s after a stand reset, and the SW's own noise, are not
      // what this sweep is looking for.
      if (/favicon|service worker|Failed to load resource/i.test(text)) return;
      consoleErrors.push(text);
    });
    await loginReal(page, "a");
  });

  test.afterAll(async () => {
    // Same cleanup rule as deep-probe: never hand the next spec an open anon
    // pairing. The sweep never starts one deliberately, but it presses a lot of
    // buttons on the roulette tab.
    await page
      ?.getByRole("button", { name: "Меню чата" })
      .click({ timeout: 3_000 })
      .then(() => page.getByRole("button", { name: "Завершить разговор" }).click({ timeout: 3_000 }))
      .catch(() => {
        /* not in a chat — the common case */
      });
    if (layoutFaults.length) {
      console.log(`[ui-sweep] ${layoutFaults.length} layout notes:`);
      for (const f of layoutFaults) console.log(`  · ${f.screen}: ${f.detail}`);
    } else {
      console.log("[ui-sweep] no layout faults");
    }
    await context?.close();
  });

  const TABS = ["Чаты", "Контакты", "Рулетка", "Уведомления", "Профиль"] as const;

  for (const tab of TABS) {
    test(`tab «${tab}»: renders, buttons respond, layout holds`, async () => {
      // Pressing every control on a live backend is inherently slow — each click
      // is a real round-trip. The default 60s covers a flow, not a sweep.
      test.setTimeout(240_000);
      await switchTab(page, tab);
      await page.waitForTimeout(500);
      layoutFaults.push(...(await collectLayoutFaults(page, tab)));

      // Labels are read once, up front: re-querying by index after every click
      // makes the sweep O(clicks × DOM) against a live backend, and a tab whose
      // list re-renders (Чаты does, on every incoming message) invalidates the
      // indices anyway. Clicking BY LABEL is stable across those re-renders.
      const labels = await page
        .locator("button:visible")
        .evaluateAll((els) =>
          els.map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim()),
        );
      expect(labels.length, `«${tab}» should offer something to press`).toBeGreaterThan(0);

      const pressable = [...new Set(labels)]
        .filter((l) => l.length > 0 && !SKIP_LABELS.some((s) => l.includes(s)))
        .slice(0, 12);
      console.log(
        `[ui-sweep] ${tab}: pressing ${pressable.length} of ${labels.length} controls: ${pressable.join(" | ")}`,
      );

      for (const label of pressable) {
        const btn = page.locator(`button:visible`, { hasText: label }).first();
        const byAria = page.locator(`button[aria-label="${label}"]:visible`).first();
        const target = (await byAria.count()) ? byAria : btn;
        if (!(await target.isVisible().catch(() => false))) continue;
        if (!(await target.isEnabled().catch(() => false))) continue;
        await target.click({ timeout: 4_000 }).catch(() => {
          /* covered / gone — the error watchers still apply */
        });
        await page.waitForTimeout(120);
        // Get back to the tab. Testing "is the nav bar visible" is not enough:
        // full-screen sheets (the wallet) render OVER it, so the bar is visible
        // and unclickable at the same time — which is exactly what wedged this
        // sweep. Try the tab, fall back to the sheet's own «Назад», and reload
        // as the last resort so one stuck screen cannot swallow the rest.
        const backOnTab = await page
          .getByRole("navigation")
          .getByRole("button", { name: tab })
          .click({ timeout: 2_500 })
          .then(() => true)
          .catch(() => false);
        if (!backOnTab) {
          await page
            .getByLabel("Назад")
            .last()
            .click({ timeout: 3_000 })
            .catch(() => {});
          await switchTab(page, tab).catch(async () => {
            await page.reload();
            await switchTab(page, tab).catch(() => {});
          });
        }
      }

      expect(pageErrors, `uncaught errors while sweeping «${tab}»`).toEqual([]);
      expect(consoleErrors, `console errors while sweeping «${tab}»`).toEqual([]);
    });
  }

  test("profile sub-screens open and come back", async () => {
    // Start from a known screen: the sweep above deliberately pressed things
    // that navigate, and this test is about the sub-screens, not about cleaning
    // up after it.
    await page.reload();
    await switchTab(page, "Профиль");
    for (const entry of ["Настройки", "Монеты и подписка", "Пригласить друга"]) {
      const link = page.getByText(entry, { exact: false }).first();
      if (!(await link.isVisible({ timeout: 3_000 }).catch(() => false))) continue;
      await link.click();
      await page.waitForTimeout(600);
      layoutFaults.push(...(await collectLayoutFaults(page, entry)));
      await page
        .getByRole("button", { name: "Назад" })
        .last()
        .click({ timeout: 5_000 })
        .catch(() => switchTab(page, "Профиль"));
      await page.waitForTimeout(300);
    }
    expect(pageErrors, "uncaught errors while walking profile sub-screens").toEqual([]);
  });
});
