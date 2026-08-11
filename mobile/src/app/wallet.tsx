import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';

import { CheckIcon, ChevronLeftIcon, LockIcon } from '@/components/icons';
import type { BillingOrder } from '@/lib/companion';
import {
  coinPacks,
  FEATURE_LABELS,
  PAYMENTS_OFF_MESSAGE,
  planOffer,
  SUBSCRIPTION_PLANS,
  useWalletStore,
} from '@/store/walletStore';

/**
 * Монеты и подписка (`AnoonWallet.tsx`) — порт веб-экрана.
 *
 * Данные и вся логика покупки взяты у веба как есть: тот же `useWalletStore`
 * (он лежит в `frontend/src/store/walletStore.ts` и доезжает сюда через alias
 * `@/*`), тот же companion — баланс и тариф из `GET /me`, каталог из
 * `GET /billing/products`, заказ из `POST /billing/orders`. Второй реализации
 * биллинга здесь нет и быть не должно.
 *
 * Что отличается от веба, и только это:
 *   • Тост рисуем сами. `showError` из общего стора на телефоне некуда вывести —
 *     `uiError` читает только `AnoonApp.tsx`, которого в мобилке нет, так что
 *     ошибка через него ушла бы в никуда.
 *   • Ссылка на оплату открывается `Linking.openURL` вместо `<a target=_blank>`.
 *     Причина веба (Safari режет программный popup) на нативе не действует:
 *     системный браузер открывается по нажатию и ничем не блокируется.
 *
 * Оплата выключена ровно так же, как в вебе, и по той же причине: провайдер не
 * подписан, `BILLING_PROVIDER` не задан, companion вообще не монтирует
 * `/billing/*`. Каталог тогда пустой, у пачек нет кода товара, и кнопка честно
 * отвечает «{@link PAYMENTS_OFF_MESSAGE}» вместо того, чтобы делать вид.
 */

/** Как часто перечитываем открытый заказ, пока плательщик на странице банка. */
const ORDER_POLL_MS = 2000;

/** Три золота монеты — см. тот же комментарий в вебе: это один предмет в трёх
 *  тонах, а не токен `--primary`, иначе монета сольётся с любой жёлтой кнопкой. */
const COIN_FACE = '#E7B75F';
const COIN_RIM = '#C98F3B';
const COIN_ENGRAVING = '#7A5420';

/** Монета: в наборе иконок её нет, рисуем локально (как и в вебе). */
function CoinIcon({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" fill={COIN_FACE} stroke={COIN_RIM} strokeWidth="1.5" />
      <SvgText
        x="12"
        y="16.5"
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fill={COIN_ENGRAVING}>
        ₼
      </SvgText>
    </Svg>
  );
}

/** Всплывающая плашка: и «оплата скоро», и ошибки — выводить их больше некуда. */
type Toast = { text: string; bad?: boolean };

export default function WalletScreen() {
  const balance = useWalletStore((s) => s.balance);
  const tier = useWalletStore((s) => s.tier);
  const products = useWalletStore((s) => s.products);
  const fetchWallet = useWalletStore((s) => s.fetchWallet);
  const startPurchase = useWalletStore((s) => s.startPurchase);
  const orderStatus = useWalletStore((s) => s.orderStatus);

  const [toast, setToast] = useState<Toast | null>(null);
  /** Заказ, который плательщик сейчас оплачивает, если такой есть. */
  const [pending, setPending] = useState<BillingOrder | null>(null);

  const packs = coinPacks(products);
  /** Страница оплаты. Отдельная переменная, чтобы сузить тип до колбэка. */
  const payUrl = pending?.payUrl;

  // Мобильный клиент всегда живой (`platform.ts`: useTinode: true), поэтому
  // проверки `USE_TINODE` из веба здесь нет.
  useEffect(() => {
    void fetchWallet();
  }, [fetchWallet]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  /**
   * Пока заказ открыт — спрашиваем companion, чем он кончился.
   *
   * Это единственное на клиенте, что вправе заключить, что оплата прошла.
   * Возврат с сайта провайдера не доказывает ничего (такой URL может набрать
   * кто угодно), поэтому ни одна ветка здесь не реагирует на возвращение
   * пользователя. `paid` companion ставит только после подписанного колбэка
   * провайдера, а баланс после этого перечитывается из `/me`, а не досчитывается
   * на месте.
   *
   * Опрос кончается сам: любой статус, кроме `new`/`pending`, терминальный, а
   * брошенный заказ по истечении срока читается как `expired`.
   */
  useEffect(() => {
    if (!pending) return;
    let done = false;
    const timer = setInterval(async () => {
      const order = await orderStatus(pending.id);
      // Сорванный опрос — это временно (потерянный запрос, рестарт): ждём дальше.
      if (done || !order || order.status === 'new' || order.status === 'pending') return;
      done = true;
      clearInterval(timer);
      setPending(null);
      if (order.status === 'paid') {
        await fetchWallet();
        setToast({ text: 'Оплата прошла — начислено' });
      } else {
        setToast({
          text:
            order.status === 'expired'
              ? 'Время на оплату истекло. Заказ отменён'
              : 'Оплата не прошла. Деньги не списаны',
          bad: true,
        });
      }
    }, ORDER_POLL_MS);
    return () => {
      done = true;
      clearInterval(timer);
    };
  }, [pending, orderStatus, fetchWallet]);

  /**
   * Купить `code`. Пустой код означает, что каталог не живой (провайдер не
   * настроен) — отвечаем честно, а не кнопкой, которая притворяется рабочей.
   */
  const buy = async (code: string | null) => {
    if (!code) {
      setToast({ text: PAYMENTS_OFF_MESSAGE });
      return;
    }
    const result = await startPurchase(code);
    if (!result.ok) {
      setToast({ text: result.message, bad: true });
      return;
    }
    setPending(result.order);
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <View className="flex-row items-center gap-2 px-3 pb-2 pt-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Назад"
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          className="h-9 w-9 items-center justify-center rounded-full">
          <ChevronLeftIcon size={24} />
        </Pressable>
        <Text className="text-xl font-bold text-foreground">Монеты и подписка</Text>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-6">
        {/* Баланс */}
        <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-card p-4">
          <CoinIcon size={40} />
          <View className="min-w-0 flex-1">
            <Text className="text-xs text-muted-foreground">Баланс монет</Text>
            <Text className="text-2xl font-bold text-foreground">{balance}</Text>
          </View>
          <View className="shrink-0 rounded-full bg-muted px-3 py-1">
            <Text className="text-xs font-medium text-muted-foreground">
              {tier === 'super_premium'
                ? 'Super Premium'
                : tier === 'premium'
                  ? 'Premium'
                  : 'Бесплатный'}
            </Text>
          </View>
        </View>

        {/* Пачки монет */}
        <View className="mt-6">
          <Text className="text-sm font-semibold text-foreground">Купить монеты</Text>
          <Text className="mt-0.5 text-xs text-muted-foreground">
            Монеты — на бусты в очереди, подарки и супер-оценки.
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2.5">
            {packs.map((pack) => (
              <Pressable
                key={pack.id || `fallback-${pack.coins}`}
                accessibilityRole="button"
                onPress={() => void buy(pack.id)}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                // Две в ряд: половина ширины минус половина зазора (gap-2.5 = 10).
                className="w-[48%] grow items-center gap-1 rounded-2xl border border-border bg-card py-4">
                <CoinIcon size={24} />
                <Text className="text-base font-bold text-foreground">{pack.coins}</Text>
                <Text className="text-xs text-muted-foreground">{pack.priceAmd} ֏</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Подписка */}
        <View className="mt-6">
          <Text className="text-sm font-semibold text-foreground">Подписка</Text>
          <View className="mt-3 gap-3">
            {(Object.keys(SUBSCRIPTION_PLANS) as (keyof typeof SUBSCRIPTION_PLANS)[]).map((id) => {
              const plan = SUBSCRIPTION_PLANS[id];
              // Цена и код товара приезжают из каталога, когда биллинг живой;
              // цена в константе — только офлайн-запасной вариант.
              const offer = planOffer(products, id);
              const isCurrent = tier === id;
              return (
                <View
                  key={id}
                  className={`rounded-2xl border bg-card p-4 ${
                    isCurrent ? 'border-primary' : 'border-border'
                  }`}>
                  <View className="flex-row items-center justify-between">
                    <Text className="font-semibold text-foreground">{plan.label}</Text>
                    {isCurrent ? (
                      <View className="rounded-full bg-primary px-2.5 py-1">
                        <Text className="text-[11px] font-semibold text-primary-foreground">
                          Ваш тариф
                        </Text>
                      </View>
                    ) : (
                      <Text className="text-sm font-semibold text-foreground">
                        {offer.priceAmd} ֏/мес
                      </Text>
                    )}
                  </View>
                  <View className="mt-2.5 gap-1.5">
                    {plan.perks.map((feature) => (
                      <View key={feature} className="flex-row items-center gap-2">
                        <CheckIcon size={16} color="#32d74b" />
                        <Text className="shrink text-sm text-foreground">
                          {FEATURE_LABELS[feature]}
                        </Text>
                      </View>
                    ))}
                  </View>
                  {!isCurrent ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void buy(offer.code)}
                      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                      className="mt-3 items-center rounded-full bg-primary py-2.5">
                      <Text className="text-sm font-semibold text-primary-foreground">
                        Оформить {plan.label}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>

        {/* Что заперто без подписки */}
        {tier === 'free' ? (
          <View className="mt-5 flex-row items-start gap-2 rounded-xl bg-muted px-3 py-2.5">
            <View className="mt-0.5">
              <LockIcon size={14} color="#9a9aa0" />
            </View>
            <Text className="shrink text-xs leading-relaxed text-muted-foreground">
              Без подписки поиск собеседника ограничен, а фильтр по возрасту и приоритет очереди
              недоступны.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Ждём открытый заказ. */}
      {pending ? (
        <View className="absolute inset-0 items-center justify-center gap-3 bg-background px-8">
          <CoinIcon size={40} />
          <Text className="text-sm font-semibold text-foreground">
            Заказ на {pending.amountAmd} ֏
          </Text>
          {payUrl ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                void Linking.openURL(payUrl).catch(() =>
                  setToast({ text: 'Не удалось открыть страницу оплаты', bad: true }),
                )
              }
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              className="w-full max-w-xs items-center rounded-full bg-primary py-2.5">
              <Text className="text-sm font-semibold text-primary-foreground">Перейти к оплате</Text>
            </Pressable>
          ) : null}
          <Text className="text-center text-xs text-muted-foreground">
            Ждём подтверждения от банка. Монеты начислятся сами — этот экран можно не держать
            открытым.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setPending(null)}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            className="rounded-full px-4 py-2">
            <Text className="text-xs font-medium text-muted-foreground">Отмена</Text>
          </Pressable>
        </View>
      ) : null}

      {toast ? (
        <View
          pointerEvents="none"
          className={`absolute left-6 right-6 top-16 items-center rounded-full px-4 py-2 ${
            toast.bad ? 'bg-destructive' : 'bg-foreground'
          }`}>
          <Text
            className={`text-xs font-medium ${toast.bad ? 'text-foreground' : 'text-background'}`}>
            {toast.text}
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
