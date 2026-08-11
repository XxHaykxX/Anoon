import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CheckIcon, ChevronLeftIcon, ForwardIcon } from '@/components/icons';
import { AnoonNotice } from '@/components/shared';
import { copyText } from '@/lib/clipboard';
import { useAnoonStore } from '@/store';

/**
 * Пригласить друга (`AnoonInvite.tsx`).
 *
 * `navigator.clipboard` / `navigator.share` веба заменены нативными: `Share`
 * из react-native — это системная шторка «Поделиться», а буфер обмена — это
 * `expo-clipboard` через {@link copyText} (`Clipboard` из ядра RN выпилен).
 */
export default function InviteScreen() {
  const user = useAnoonStore((s) => s.user);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');

  const hashId = user?.hashId;
  const inviteLink = `anoon.app/add/${hashId ?? ''}`;
  const inviteUrl = `https://${inviteLink}`;
  const myId = `#${hashId ?? ''}`;

  // Отказ буфера обмена показываем на самой кнопке: молча оставить надпись
  // «Скопировать» — значит соврать, что нажатие ничего не сделало.
  const handleCopy = async () => {
    setCopyState((await copyText(inviteUrl)) ? 'ok' : 'fail');
    setTimeout(() => setCopyState('idle'), 1800);
  };

  const handleShare = () => {
    // Отказ пользователя (закрыл шторку) — не ошибка, поэтому тихо.
    void Share.share({ message: `Мой код ${myId} — ${inviteUrl}` }).catch(() => {});
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <View className="flex-row items-center gap-1 px-6 pb-2 pt-6">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Назад"
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          className="-ml-5 h-12 w-12 shrink-0 items-center justify-center rounded-full">
          <ChevronLeftIcon size={24} />
        </Pressable>
        <View className="min-w-0">
          <Text className="text-2xl font-bold text-foreground">Пригласить друга</Text>
          <Text className="mt-0.5 text-sm text-muted-foreground">
            Отправьте ссылку или назовите свой #ID
          </Text>
        </View>
      </View>

      <View className="flex-1 items-center px-6 pb-4">
        {!hashId ? (
          // Без аккаунта ссылка ведёт в никуда — честнее сказать это, чем
          // показать кнопку «Скопировать», копирующую мусор.
          <AnoonNotice message="Войдите в аккаунт, чтобы получить свою ссылку-приглашение." tone="info" />
        ) : (
          <>
            {/* Карточка #ID — без QR (BUG-20: ссылки и #ID достаточно). */}
            <View className="mt-3 w-full items-center rounded-3xl border border-border bg-card p-6">
              <Text className="text-xs text-muted-foreground">Мой код</Text>
              <Text className="mt-1 text-3xl font-bold tracking-wide text-foreground">{myId}</Text>
            </View>

            <View className="mt-5 w-full">
              <Text className="mb-1.5 px-1 text-xs text-muted-foreground">Ссылка-приглашение</Text>
              <View className="flex-row items-center justify-between gap-2 rounded-2xl border border-border bg-muted px-4 py-3">
                <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                  {inviteLink}
                </Text>
              </View>
            </View>

            <View className="mt-4 w-full flex-row gap-2.5">
              <Pressable
                accessibilityRole="button"
                onPress={() => void handleCopy()}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-full bg-primary py-3">
                {copyState === 'ok' ? <CheckIcon size={16} color="#000000" /> : null}
                <Text className="text-sm font-semibold text-primary-foreground">
                  {copyState === 'ok'
                    ? 'Скопировано'
                    : copyState === 'fail'
                      ? 'Не удалось скопировать'
                      : 'Скопировать ссылку'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={handleShare}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-full bg-muted py-3">
                <ForwardIcon size={16} />
                <Text className="text-sm font-semibold text-foreground">Поделиться</Text>
              </Pressable>
            </View>

            <Text className="mt-4 px-2 text-center text-xs leading-relaxed text-muted-foreground">
              Кто перейдёт по ссылке — сможет отправить вам запрос дружбы. Свою собственную ссылку
              добавить нельзя.
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
