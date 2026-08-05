"use client";

/**
 * Standalone zustand store for coins/subscription state (Wave-3 #102 / W3-7),
 * kept OUT of the main anoon store (`./slices.ts`) so this feature can land
 * without touching a file other agents are editing concurrently this wave —
 * same reasoning as {@link ../store/callStore.ts}.
 *
 * Payment provider is a STUB: `buyCoins`/`subscribe` never hit a real backend
 * yet (Armenian payment integration — Idram/Telcell/ArCa — is a later business
 * decision, see BUSINESS-PLAN.md §3/§9). Both always resolve with the same
 * "coming soon" message; the screen shows it as a toast and never throws.
 *
 * Real balance/tier come from companion's `GET /me` (`User.coins`/`subscription`)
 * once that's populated; `fetchWallet` falls back to free/0 on any failure
 * (backend down / mock mode), same pattern as the rest of the companion client.
 */
import { create } from "zustand";
import { getCompanionClient } from "@/lib/companion";
import type { SubscriptionTier } from "@/types/companion";

/** Gated perks per tier — mirrors BUSINESS-PLAN.md §2's feature table. */
export type WalletFeature =
  | "unlimitedRoulette"
  | "peerFilter"
  | "queuePriority"
  | "noAds"
  | "topRatedInbox"
  | "incognito"
  | "monthlyBonusCoins"
  | "vanityId";

/** Russian label for each perk, shared by the tier cards and any lock hints. */
export const FEATURE_LABELS: Record<WalletFeature, string> = {
  unlimitedRoulette: "Безлимитный поиск собеседника",
  peerFilter: "Точный фильтр по полу и возрасту",
  queuePriority: "Приоритет в очереди рулетки",
  noAds: "Без рекламы",
  topRatedInbox: "Кто оценил вас высоко",
  incognito: "Инкогнито-режим",
  monthlyBonusCoins: "Бонусные монеты каждый месяц",
  vanityId: "Красивый короткий #ID",
};

/** Perks unlocked at each paid tier, cumulative (super_premium includes premium's). */
const TIER_FEATURES: Record<SubscriptionTier, WalletFeature[]> = {
  free: [],
  premium: ["unlimitedRoulette", "peerFilter", "queuePriority", "noAds", "topRatedInbox"],
  super_premium: [
    "unlimitedRoulette",
    "peerFilter",
    "queuePriority",
    "noAds",
    "topRatedInbox",
    "incognito",
    "monthlyBonusCoins",
    "vanityId",
  ],
};

/** Display data for the two paid tier cards — prices are BUSINESS-PLAN.md §3 draft figures. */
export const SUBSCRIPTION_PLANS: Record<
  "premium" | "super_premium",
  { label: string; priceAmd: number; perks: WalletFeature[] }
> = {
  premium: {
    label: "Premium",
    priceAmd: 1990,
    perks: TIER_FEATURES.premium,
  },
  super_premium: {
    label: "Super Premium",
    priceAmd: 4990,
    perks: TIER_FEATURES.super_premium,
  },
};

/** One purchasable coin pack — prices are BUSINESS-PLAN.md §3 draft figures. */
export interface CoinPack {
  id: string;
  coins: number;
  priceAmd: number;
}

export const COIN_PACKS: CoinPack[] = [
  { id: "s", coins: 50, priceAmd: 490 },
  { id: "m", coins: 150, priceAmd: 1290 },
  { id: "l", coins: 400, priceAmd: 2990 },
  { id: "xl", coins: 1000, priceAmd: 4900 },
];

/** Result of a stubbed purchase/subscribe call — always `ok: false` for now. */
export interface WalletActionResult {
  ok: boolean;
  message: string;
}

const PAYMENTS_STUB_MESSAGE = "Оплата скоро — Армения";

export interface WalletStore {
  balance: number;
  tier: SubscriptionTier;
  /** True once {@link WalletStore.fetchWallet} has resolved at least once. */
  ready: boolean;
  /** Pull `coins`/`subscription` from companion `/me`; free/0 when unavailable. */
  fetchWallet: () => Promise<void>;
  /** Whether the current tier includes `feature`. */
  hasFeature: (feature: WalletFeature) => boolean;
  /** UI-friendly gate: allowed flag + the cheapest tier that would unlock it. */
  tierGate: (feature: WalletFeature) => { allowed: boolean; requiredTier: SubscriptionTier | null };
  /** STUB: no payment provider wired yet — resolves without charging or crashing. */
  buyCoins: (packId: string) => Promise<WalletActionResult>;
  /** STUB: same as {@link buyCoins}, for a paid subscription tier. */
  subscribe: (tier: "premium" | "super_premium") => Promise<WalletActionResult>;
}

export const useWalletStore = create<WalletStore>((set, get) => ({
  balance: 0,
  tier: "free",
  ready: false,

  fetchWallet: async () => {
    const me = await getCompanionClient().me();
    set({
      balance: me?.coins ?? 0,
      tier: me?.subscription ?? "free",
      ready: true,
    });
  },

  hasFeature: (feature) => TIER_FEATURES[get().tier].includes(feature),

  tierGate: (feature) => {
    if (get().hasFeature(feature)) return { allowed: true, requiredTier: null };
    const requiredTier = TIER_FEATURES.premium.includes(feature) ? "premium" : "super_premium";
    return { allowed: false, requiredTier };
  },

  buyCoins: async () => {
    // TODO(W3-7 payments): wire a real Armenian provider (Idram/Telcell/ArCa/EasyPay).
    return { ok: false, message: PAYMENTS_STUB_MESSAGE };
  },

  subscribe: async () => {
    // TODO(W3-7 payments): same as buyCoins — no provider yet.
    return { ok: false, message: PAYMENTS_STUB_MESSAGE };
  },
}));
