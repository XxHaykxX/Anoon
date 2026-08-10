"use client";

import { useEffect, useState } from "react";
import { ChevronLeftIcon, CheckIcon, LockIcon } from "@/components/icons";
import type { BillingOrder } from "@/lib/companion";
import { USE_TINODE } from "@/lib/tinode";
import { useAnoonStore } from "@/store";
import {
  coinPacks,
  FEATURE_LABELS,
  PAYMENTS_OFF_MESSAGE,
  planOffer,
  SUBSCRIPTION_PLANS,
  useWalletStore,
} from "@/store/walletStore";
import { PRESS_FX } from "@/components/anoon/_shared";

/** How often the open order is re-read while the payer is on the provider's page. */
const ORDER_POLL_MS = 2000;

/**
 * The coin glyph's three golds. Deliberately NOT the brand yellow and
 * deliberately NOT tokens: this is one object shaded in three tones — a lit
 * face, a darker rim, and a dark engraved symbol — and it only reads as a coin
 * because they differ. There is a single gold token (`--primary`, #FDBF2D), so
 * putting the coin on the token system would flatten all three into one disc,
 * and it would also make the currency glyph the exact colour of every CTA and
 * accent in the app, which is precisely what a coin must not look like.
 *
 * Named here rather than inlined so the set is visible and changes together.
 */
const COIN_FACE = "#E7B75F";
const COIN_RIM = "#C98F3B";
const COIN_ENGRAVING = "#7A5420";

/** Small coin glyph — no icon set entry for it, so a local inline SVG (see AnoonProfile's QrPlaceholder for the same pattern). */
function CoinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="9" fill={COIN_FACE} stroke={COIN_RIM} strokeWidth="1.5" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="11" fontWeight="700" fill={COIN_ENGRAVING}>
        ₼
      </text>
    </svg>
  );
}

/**
 * Desktop column. Across the shell's full 60rem the balance strip was an
 * 840px-wide rule with «Баланс монет» at one end and the tier pill at the
 * other, and the four coin packs were 200px boxes holding a number. Both halves
 * of the variant are load-bearing: `lg:` alone would also fire in the showcase
 * (fixed 390px frames on a wide monitor), and `.anoon-desktop` alone is on the
 * app root at every width and would restyle the phone (docs/DESKTOP-LAYOUT.md).
 */
const DESKTOP_COL =
  "lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:w-full lg:[.anoon-desktop_&]:max-w-[44rem]";

export interface AnoonWalletProps {
  /** Opened as a local overlay from AnoonProfile — no global route yet. */
  onClose: () => void;
}

/**
 * Coins + subscription screen (W3-7). Opened as a same-screen overlay from
 * AnoonProfile (`onClose` collapses it back) rather than through the app-wide
 * nav/route — avoids touching AnoonApp.tsx/anoonNav while those are owned by
 * another agent this wave. Payment provider is a stub everywhere here: every
 * buy/subscribe button shows the "Оплата скоро" toast and never fails hard.
 */
export default function AnoonWallet({ onClose }: AnoonWalletProps) {
  const balance = useWalletStore((s) => s.balance);
  const tier = useWalletStore((s) => s.tier);
  const products = useWalletStore((s) => s.products);
  const fetchWallet = useWalletStore((s) => s.fetchWallet);
  const startPurchase = useWalletStore((s) => s.startPurchase);
  const orderStatus = useWalletStore((s) => s.orderStatus);
  const showError = useAnoonStore((s) => s.showError);

  const [toast, setToast] = useState<string | null>(null);
  /** The order the payer is currently settling, if any. */
  const [pending, setPending] = useState<BillingOrder | null>(null);

  const packs = coinPacks(products);

  useEffect(() => {
    if (USE_TINODE) void fetchWallet();
  }, [fetchWallet]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  /**
   * While an order is open, ask companion what became of it.
   *
   * This is the only thing on the client that may conclude a payment happened.
   * The provider's page sends the payer back to a URL, and that redirect proves
   * nothing — it is a link anyone can type — so no branch here reacts to the
   * user returning. Companion flips the order to `paid` only after the
   * provider's signed callback settled it, and the balance is then re-read from
   * `/me` rather than added up locally.
   *
   * Polling ends by itself: every non-open status is terminal, and an order the
   * payer abandons reads back as `expired` once its deadline passes.
   */
  useEffect(() => {
    if (!pending) return;
    let done = false;
    const timer = window.setInterval(async () => {
      const order = await orderStatus(pending.id);
      // A failed poll is transient (a dropped request, a restart): keep waiting.
      if (done || !order || order.status === "new" || order.status === "pending") return;
      done = true;
      window.clearInterval(timer);
      setPending(null);
      if (order.status === "paid") {
        await fetchWallet();
        setToast("Оплата прошла — начислено");
      } else {
        showError(
          order.status === "expired"
            ? "Время на оплату истекло. Заказ отменён"
            : "Оплата не прошла. Деньги не списаны",
        );
      }
    }, ORDER_POLL_MS);
    return () => {
      done = true;
      window.clearInterval(timer);
    };
  }, [pending, orderStatus, fetchWallet, showError]);

  /**
   * Buy `code`. An empty code means the catalogue is not live (no provider
   * configured), which is answered honestly instead of with a button that
   * appears to work.
   */
  const buy = async (code: string | null) => {
    if (!code) {
      setToast(PAYMENTS_OFF_MESSAGE);
      return;
    }
    const result = await startPurchase(code);
    if (!result.ok) {
      showError(result.message);
      return;
    }
    setPending(result.order);
  };

  return (
    <div className="absolute inset-0 z-50 flex h-full w-full flex-col bg-background text-foreground animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <header
        className={`flex shrink-0 items-center gap-2 px-3 pb-2 pt-4 lg:[.anoon-desktop_&]:px-5 ${DESKTOP_COL}`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Назад"
          className={`grid size-9 place-items-center rounded-full text-foreground ${PRESS_FX}`}
        >
          <ChevronLeftIcon className="size-6" />
        </button>
        <h1 className="text-xl font-bold">Монеты и подписка</h1>
      </header>

      {/*
        Desktop (≥1024) keeps the same single column — this screen is a short
        list of offers, not a form — but the two card grids below stop being
        one-per-row. The switch is `lg:[.anoon-desktop_&]:…`: `lg:` alone would
        fire in the showcase's 390px frame on a wide monitor, `.anoon-desktop`
        alone would fire on the phone (docs/DESKTOP-LAYOUT.md).
      */}
      <div
        className={`flex-1 overflow-y-auto px-5 pb-6 lg:[.anoon-desktop_&]:px-5 ${DESKTOP_COL}`}
      >
        {/* Balance */}
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
          <CoinIcon className="size-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Баланс монет</p>
            <p className="text-2xl font-bold">{balance}</p>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            {tier === "super_premium"
              ? "Super Premium"
              : tier === "premium"
                ? "Premium"
                : "Бесплатный"}
          </span>
        </div>

        {/* Coin packs */}
        <section className="mt-6">
          <h2 className="text-sm font-semibold">Купить монеты</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Монеты — на бусты в очереди, подарки и супер-оценки.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2.5 lg:[.anoon-desktop_&]:grid-cols-4">
            {packs.map((pack) => (
              <button
                key={pack.id || `fallback-${pack.coins}`}
                type="button"
                onClick={() => void buy(pack.id)}
                className={`flex flex-col items-center gap-1 rounded-2xl border border-border bg-card py-4 ${PRESS_FX}`}
              >
                <CoinIcon className="size-6" />
                <span className="text-base font-bold">{pack.coins}</span>
                <span className="text-xs text-muted-foreground">{pack.priceAmd} ֏</span>
              </button>
            ))}
          </div>
        </section>

        {/* Subscription tiers */}
        <section className="mt-6">
          <h2 className="text-sm font-semibold">Подписка</h2>
          {/* The plans stack on the phone and stand side by side on desktop.
              Side by side the cards stretch to a common height, so the CTA is
              pinned to the bottom (`mt-auto`) instead of hanging under a short
              perk list while its neighbour's sits lower. */}
          <div className="mt-3 space-y-3 lg:[.anoon-desktop_&]:grid lg:[.anoon-desktop_&]:grid-cols-2 lg:[.anoon-desktop_&]:gap-3 lg:[.anoon-desktop_&]:space-y-0">
            {(Object.keys(SUBSCRIPTION_PLANS) as (keyof typeof SUBSCRIPTION_PLANS)[]).map((id) => {
              const plan = SUBSCRIPTION_PLANS[id];
              // Price and product code come from the catalogue when billing is
              // live; the constant's price is only the offline fallback.
              const offer = planOffer(products, id);
              const isCurrent = tier === id;
              return (
                <div
                  key={id}
                  className={`rounded-2xl border p-4 lg:[.anoon-desktop_&]:flex lg:[.anoon-desktop_&]:flex-col ${
                    isCurrent ? "border-primary bg-primary/5" : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{plan.label}</h3>
                    {isCurrent ? (
                      <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground">
                        Ваш тариф
                      </span>
                    ) : (
                      <span className="text-sm font-semibold">{offer.priceAmd} ֏/мес</span>
                    )}
                  </div>
                  <ul className="mt-2.5 space-y-1.5 lg:[.anoon-desktop_&]:pb-3">
                    {plan.perks.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-foreground">
                        <CheckIcon className="size-4 shrink-0 text-online" />
                        {FEATURE_LABELS[feature]}
                      </li>
                    ))}
                  </ul>
                  {!isCurrent && (
                    <button
                      type="button"
                      onClick={() => void buy(offer.code)}
                      className={`mt-3 w-full rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground lg:[.anoon-desktop_&]:mt-auto ${PRESS_FX}`}
                    >
                      Оформить {plan.label}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Free-tier lock hint */}
        {tier === "free" && (
          <p className="mt-5 flex items-start gap-2 rounded-xl bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <LockIcon className="mt-0.5 size-3.5 shrink-0" />
            Без подписки поиск собеседника ограничен, а фильтр по возрасту и приоритет очереди
            недоступны.
          </p>
        )}
      </div>

      {/*
        Waiting on an open order. The payment page opens in a new tab from a
        real click on this link rather than programmatically after the await
        that created the order — a window.open() at that point is a popup and
        Safari blocks it, which would strand the payer on a screen saying it is
        waiting for a payment they were never shown.
      */}
      {pending && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-background/95 px-8 text-center">
          <CoinIcon className="size-10" />
          <p className="text-sm font-semibold">Заказ на {pending.amountAmd} ֏</p>
          <a
            href={pending.payUrl}
            target="_blank"
            rel="noreferrer"
            className={`w-full max-w-xs rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground ${PRESS_FX}`}
          >
            Перейти к оплате
          </a>
          <p className="text-xs text-muted-foreground">
            Ждём подтверждения от банка. Монеты начислятся сами — эту страницу можно не держать
            открытой.
          </p>
          <button
            type="button"
            onClick={() => setPending(null)}
            className={`rounded-full px-4 py-2 text-xs font-medium text-muted-foreground ${PRESS_FX}`}
          >
            Отмена
          </button>
        </div>
      )}

      {toast && (
        <div className="anoon-msg-in absolute left-1/2 top-16 z-[70] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
