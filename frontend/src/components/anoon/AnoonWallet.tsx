"use client";

import { useEffect, useState } from "react";
import { ChevronLeftIcon, CheckIcon, LockIcon } from "@/components/icons";
import { USE_TINODE } from "@/lib/tinode";
import {
  COIN_PACKS,
  FEATURE_LABELS,
  SUBSCRIPTION_PLANS,
  useWalletStore,
  type WalletActionResult,
} from "@/store/walletStore";
import { PRESS_FX } from "@/components/anoon/_shared";

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
  const fetchWallet = useWalletStore((s) => s.fetchWallet);
  const buyCoins = useWalletStore((s) => s.buyCoins);
  const subscribe = useWalletStore((s) => s.subscribe);

  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (USE_TINODE) void fetchWallet();
  }, [fetchWallet]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const showResult = (r: WalletActionResult) => setToast(r.message);

  return (
    <div className="absolute inset-0 z-50 flex h-full w-full flex-col bg-background text-foreground animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-4">
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

      <div className="flex-1 overflow-y-auto px-5 pb-6">
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
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {COIN_PACKS.map((pack) => (
              <button
                key={pack.id}
                type="button"
                onClick={() => void buyCoins(pack.id).then(showResult)}
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
        <section className="mt-6 space-y-3">
          <h2 className="text-sm font-semibold">Подписка</h2>
          {(Object.keys(SUBSCRIPTION_PLANS) as (keyof typeof SUBSCRIPTION_PLANS)[]).map((id) => {
            const plan = SUBSCRIPTION_PLANS[id];
            const isCurrent = tier === id;
            return (
              <div
                key={id}
                className={`rounded-2xl border p-4 ${
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
                    <span className="text-sm font-semibold">{plan.priceAmd} ֏/мес</span>
                  )}
                </div>
                <ul className="mt-2.5 space-y-1.5">
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
                    onClick={() => void subscribe(id).then(showResult)}
                    className={`mt-3 w-full rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground ${PRESS_FX}`}
                  >
                    Оформить {plan.label}
                  </button>
                )}
              </div>
            );
          })}
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

      {toast && (
        <div className="anoon-msg-in absolute left-1/2 top-16 z-40 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
