import { useState, type ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { BlockIcon, UserCircleIcon } from '@/components/icons';

import { CHAT_COLORS } from './icons';

/** Всплывающая плашка-уведомление поверх шапки (веб: `banner`). */
export function Banner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View className="absolute left-0 right-0 top-2 z-40 items-center">
      <Text className="rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background">
        {message}
      </Text>
    </View>
  );
}

/**
 * Выпадающее меню шапки. На вебе — абсолютно спозиционированный блок с
 * подложкой на весь экран; здесь `Modal`, потому что иначе меню обрезалось бы
 * границами шапки (в RN нет `overflow: visible` поверх соседей на Android).
 */
export function ChatMenu({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 px-3 pt-14" onPress={onClose}>
        <View className="w-56 self-end overflow-hidden rounded-2xl border border-border bg-popover py-1">
          {children}
        </View>
      </Pressable>
    </Modal>
  );
}

/** Строка внутри {@link ChatMenu}. */
export function ChatMenuItem({
  label,
  icon,
  destructive,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 px-4 py-3">
      {icon}
      <Text className={`text-sm ${destructive ? 'text-destructive' : 'text-popover-foreground'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Предложение раскрыть профили — ключевой момент «подружиться». Карточка живёт
 * прямо в ленте (как системное сообщение), поэтому у неё нет собственной
 * подложки.
 */
export function RevealPrompt({
  partnerId,
  onOpen,
  onDecline,
  onBlock,
}: {
  partnerId?: string;
  onOpen: () => void;
  onDecline: () => void;
  onBlock: () => void;
}) {
  return (
    <View className="w-full max-w-[320px] self-center rounded-2xl border border-border bg-card p-4">
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-primary/15">
          <UserCircleIcon size={24} color={CHAT_COLORS.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-foreground">
            Собеседник хочет открыть профиль
          </Text>
          <Text className="mt-0.5 text-xs text-muted-foreground">
            {/* Хендл подставляем, только если он есть: до ответа `/roulette/status`
                он пустой, и текст выходил с дырой посреди фразы. */}
            {partnerId
              ? `Собеседник ${partnerId} предлагает раскрыть профили — вы увидите имя, фото и станете друзьями.`
              : 'Собеседник предлагает раскрыть профили — вы увидите имя, фото и станете друзьями.'}
          </Text>
        </View>
      </View>

      <View className="mt-3 gap-2">
        <Pressable
          accessibilityRole="button"
          onPress={onOpen}
          className="items-center rounded-full bg-primary py-2.5">
          <Text className="text-sm font-semibold text-primary-foreground">Открыть</Text>
        </Pressable>
        <View className="flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            onPress={onDecline}
            className="flex-1 items-center rounded-full bg-muted py-2.5">
            <Text className="text-sm font-medium text-foreground">Отклонить</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onBlock}
            className="flex-1 flex-row items-center justify-center gap-1.5 rounded-full bg-destructive/15 py-2.5">
            <BlockIcon size={16} color={CHAT_COLORS.destructive} />
            <Text className="text-sm font-medium text-destructive">Заблокировать</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const RATINGS: { value: number; emoji: string; label: string }[] = [
  { value: 1, emoji: '😡', label: 'Ужасно' },
  { value: 2, emoji: '🙁', label: 'Плохо' },
  { value: 3, emoji: '😐', label: 'Нормально' },
  { value: 4, emoji: '🙂', label: 'Хорошо' },
  { value: 5, emoji: '😍', label: 'Отлично' },
];

/**
 * «Разговор завершён» / «Собеседник вышел из чата» с оценкой собеседника.
 *
 * `peerLeft` — это не подтверждение, а новость: пользователь её не просил, и
 * главное действие в этом случае — не «отправить оценку», а следующий
 * собеседник. Оценка остаётся необязательной: держать выход заложником услуги
 * нельзя.
 */
export function ConversationEnded({
  peerLeft = false,
  onSubmit,
  onSkip,
  onNext,
}: {
  peerLeft?: boolean;
  onSubmit: (rating: number) => void;
  onSkip: (rating?: number) => void;
  onNext: (rating?: number) => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const primaryDisabled = !peerLeft && rating === null;

  return (
    <Modal visible transparent animationType="fade">
      <View className="flex-1 justify-end bg-black/60 px-4 pb-6">
        <View className="w-full rounded-3xl border border-border bg-card p-5">
          <View className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted-foreground/30" />

          <Text className="text-center text-lg font-bold text-foreground">
            {peerLeft ? 'Собеседник вышел из чата' : 'Разговор завершён'}
          </Text>
          <Text className="mt-1 text-center text-sm text-muted-foreground">
            Оцените собеседника — это поможет находить лучших людей.
          </Text>

          <View className="mt-5 flex-row items-center justify-between px-1">
            {RATINGS.map((r) => (
              <Pressable
                key={r.value}
                accessibilityRole="button"
                accessibilityLabel={r.label}
                accessibilityState={{ selected: rating === r.value }}
                onPress={() => setRating(r.value)}
                className={`h-13 w-13 items-center justify-center rounded-full ${
                  rating === r.value ? 'bg-primary/20' : 'opacity-60'
                }`}>
                <Text className="text-3xl">{r.emoji}</Text>
              </Pressable>
            ))}
          </View>

          <View className="mt-2 flex-row justify-between px-1">
            <Text className="text-[11px] text-muted-foreground">Плохо</Text>
            <Text className="text-[11px] text-muted-foreground">Отлично</Text>
          </View>

          <View className="mt-6 gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: primaryDisabled }}
              disabled={primaryDisabled}
              onPress={() =>
                peerLeft ? onNext(rating ?? undefined) : rating !== null && onSubmit(rating)
              }
              className={`items-center rounded-full bg-primary py-3 ${
                primaryDisabled ? 'opacity-40' : ''
              }`}>
              <Text className="text-sm font-semibold text-primary-foreground">
                {peerLeft ? 'Новый собеседник' : 'Отправить оценку'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              // «Пропустить» означает ровно это — выбранная и пропущенная оценка
              // не отправляется. В режиме peerLeft тот же слот — «На главную»,
              // это выход, а не отказ, и оценку он уносит с собой.
              onPress={() => onSkip(peerLeft ? rating ?? undefined : undefined)}
              className="items-center rounded-full py-2.5">
              <Text className="text-sm font-medium text-muted-foreground">
                {peerLeft ? 'На главную' : 'Пропустить'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
