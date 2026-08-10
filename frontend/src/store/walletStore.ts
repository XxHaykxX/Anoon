"use client";

/**
 * Standalone zustand store for coins/subscription state (Wave-3 #102 / W3-7),
 * kept OUT of the main anoon store (`./slices.ts`) so this feature can land
 * without touching a file other agents are editing concurrently this wave —
 * same reasoning as {@link ../store/callStore.ts}.
 *
 * Balance/tier come from companion's `GET /me` (`User.coins`/`subscription`);
 * `fetchWallet` falls back to free/0 on any failure (backend down / mock mode),
 * same pattern as the rest of the companion client.
 *
 * Purchases go through companion's billing module (#14, docs/PAYMENTS-PLAN.md):
 * the catalogue is `GET /billing/products`, a purchase opens an order and the
 * screen polls its status. Which provider is behind it (Ameriabank / Idram /
 * the local sandbox) is entirely the backend's business — the client only ever
 * sees a product code and a payment URL.
 *
 * When NO provider is configured — the shipped default until one is signed —
 * companion does not mount /billing/* at all, {@link WalletStore.products} stays
 * null, and the screen falls back to the draft price list plus the honest
 * "оплата скоро" toast. That fallback is the only reason the price constants
 * below still exist.
 */
import { create } from "zustand";
import { getCompanionClient, type BillingOrder, type BillingProduct } from "@/lib/companion";
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

/**
 * Display data for the two paid tier cards. The label and the perk list are
 * client-side by nature (the backend sells a tier, it has no opinion about how
 * the perks are worded); the price here is only the fallback shown when the
 * catalogue is unreachable — see {@link planOffer}.
 */
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

/**
 * One coin pack as the screen draws it. `id` is the companion product code
 * when the catalogue is live, and a local placeholder when it is not — which is
 * exactly what tells the buy handler whether there is anything to charge.
 */
export interface CoinPack {
  id: string;
  coins: number;
  priceAmd: number;
}

/**
 * Draft prices (BUSINESS-PLAN.md §3), shown ONLY while billing is off. Once a
 * provider is configured these are replaced by `products` rows, so a price
 * change is a row update and not a client rebuild.
 */
const FALLBACK_COIN_PACKS: CoinPack[] = [
  { id: "", coins: 50, priceAmd: 490 },
  { id: "", coins: 150, priceAmd: 1290 },
  { id: "", coins: 400, priceAmd: 2990 },
  { id: "", coins: 1000, priceAmd: 4900 },
];

/**
 * The coin packs to draw: the server catalogue when billing is live, the draft
 * list otherwise. An entry with an empty `id` cannot be bought — the screen
 * answers it with the "coming soon" toast rather than a dead button.
 */
export function coinPacks(products: BillingProduct[] | null): CoinPack[] {
  const live = (products ?? []).filter((p) => p.kind === "coins");
  if (!live.length) return FALLBACK_COIN_PACKS;
  return live.map((p) => ({ id: p.code, coins: p.coins ?? 0, priceAmd: p.priceAmd }));
}

/**
 * Price and product code for a paid tier. `code: null` means the same thing as
 * an empty pack id: nothing to sell yet, show the draft price.
 */
export function planOffer(
  products: BillingProduct[] | null,
  tier: "premium" | "super_premium",
): { priceAmd: number; code: string | null } {
  const live = (products ?? []).find((p) => p.kind === "sub" && p.tier === tier);
  return live
    ? { priceAmd: live.priceAmd, code: live.code }
    : { priceAmd: SUBSCRIPTION_PLANS[tier].priceAmd, code: null };
}

/**
 * Outcome of pressing a buy button: an open order to send the payer to, or a
 * message explaining why there is none.
 */
export type WalletActionResult =
  | { ok: true; order: BillingOrder }
  | { ok: false; message: string };

export const PAYMENTS_OFF_MESSAGE = "Оплата скоро — Армения";

export interface WalletStore {
  balance: number;
  tier: SubscriptionTier;
  /** True once {@link WalletStore.fetchWallet} has resolved at least once. */
  ready: boolean;
  /**
   * The server catalogue, or null when billing is off / unreachable. Read it
   * through {@link coinPacks} and {@link planOffer} rather than directly.
   */
  products: BillingProduct[] | null;
  /** Pull balance/tier from `/me` and the catalogue from `/billing/products`. */
  fetchWallet: () => Promise<void>;
  /** Whether the current tier includes `feature`. */
  hasFeature: (feature: WalletFeature) => boolean;
  /** UI-friendly gate: allowed flag + the cheapest tier that would unlock it. */
  tierGate: (feature: WalletFeature) => { allowed: boolean; requiredTier: SubscriptionTier | null };
  /**
   * Open an order for a product code. Nothing is charged and no balance moves
   * here — this only produces the URL to send the payer to; the money is
   * granted by the provider's callback to companion, and the screen learns
   * about it by polling {@link WalletStore.orderStatus}.
   */
  startPurchase: (productCode: string) => Promise<WalletActionResult>;
  /** Re-read one order from companion. Null on a transient failure. */
  orderStatus: (id: string) => Promise<BillingOrder | null>;
}

export const useWalletStore = create<WalletStore>((set, get) => ({
  balance: 0,
  tier: "free",
  ready: false,
  products: null,

  fetchWallet: async () => {
    const client = getCompanionClient();
    // Both are independently optional: a live catalogue with a failed /me still
    // renders prices, and a working /me with billing off still shows a balance.
    const [me, products] = await Promise.all([client.me(), client.billingProducts()]);
    set({
      balance: me?.coins ?? 0,
      tier: me?.subscription ?? "free",
      products,
      ready: true,
    });
  },

  hasFeature: (feature) => TIER_FEATURES[get().tier].includes(feature),

  tierGate: (feature) => {
    if (get().hasFeature(feature)) return { allowed: true, requiredTier: null };
    const requiredTier = TIER_FEATURES.premium.includes(feature) ? "premium" : "super_premium";
    return { allowed: false, requiredTier };
  },

  startPurchase: async (productCode) => {
    // No catalogue means no provider: nothing to open an order against, and the
    // caller shows the "coming soon" toast instead of a button that does nothing.
    if (!productCode) return { ok: false, message: PAYMENTS_OFF_MESSAGE };
    try {
      return { ok: true, order: await getCompanionClient().createOrder(productCode) };
    } catch (err) {
      // Surfaced by the caller as a red error toast. Swallowing this would leave
      // the user tapping a button that silently does nothing.
      console.error("wallet: could not open an order", err);
      return { ok: false, message: "Не удалось начать оплату. Попробуйте ещё раз" };
    }
  },

  orderStatus: (id) => getCompanionClient().orderStatus(id),
}));
