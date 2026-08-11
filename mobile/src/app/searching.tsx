import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnoonAvatar } from '@/components/shared';
import { getCompanionClient } from '@/lib/companion';
import { useAnoonStore } from '@/store';

/**
 * Поиск собеседника (`AnoonSearching.tsx`). Вся логика — из общего стора.
 *
 * Мок-ветки веба здесь нет: на телефоне `platform().useTinode` всегда true
 * (см. `mobile/src/platform.ts`), поэтому `USE_TINODE` проверять не за чем —
 * режим ровно один, живой бэкенд.
 */
export default function SearchingScreen() {
  const queueStatus = useAnoonStore((s) => s.queue.status);
  const leaveQueue = useAnoonStore((s) => s.leaveQueue);
  const resyncMatch = useAnoonStore((s) => s.resyncRouletteMatch);

  /** Взведён, когда экран уходит по своей воле — чтобы idle-эффект не сработал вторым nav.back(). */
  const leaving = useRef(false);

  // Точные фильтры, которые пользователь выбрал на Home: их запомнил
  // companion.enqueue, читаем обратно. Пусто — значит экран открыт после
  // перезагрузки процесса, тогда честнее ничего не обещать.
  const prefs = getCompanionClient().getLastPrefs();

  // Совпало — открываем анонимный чат. Именно `replace`, а не `push`: выход из
  // чата не должен возвращать на экран поиска, который уже ничего не ищет.
  useEffect(() => {
    if (queueStatus === 'matched') router.replace('/anon-chat');
  }, [queueStatus]);

  // Событие `matched` приходит по WS best-effort: переполненный буфер,
  // переподключение или кадр раньше подписки стора — и экран навсегда застревает
  // на спиннере, пока пир уже сидит в чате. Пока ищем, опрашиваем авторитетное
  // состояние сервера; обработчик общий с событием, поэтому дважды доставленный
  // матч открывает один чат.
  useEffect(() => {
    if (queueStatus !== 'searching') return;
    void resyncMatch();
    const id = setInterval(() => void resyncMatch(), 2000);
    return () => clearInterval(id);
  }, [queueStatus, resyncMatch]);

  // Стор может выбросить нас из очереди без нашего участия (бан, лимит,
  // перезапуск companion). Ошибка уже показана тостом; остаётся не оставить
  // человека на спиннере, который больше ничего не ищет.
  useEffect(() => {
    if (leaving.current) return;
    if (queueStatus === 'idle') router.back();
  }, [queueStatus]);

  const cancel = () => {
    leaving.current = true;
    void leaveQueue();
    router.back();
  };

  const ownAge = prefs?.ownAgeRange;
  const peerAges = prefs?.peerAgeRanges ?? [];

  return (
    <SafeAreaView className="flex-1 items-center justify-between bg-background" edges={['top', 'bottom']}>
      <View className="flex-1 items-center justify-center px-6">
        {/* Кольца вокруг аватара. На вебе они пульсируют через `animate-ping`;
            в RN такого класса нет, а тащить Reanimated ради декора — лишнее.
            Ощущение «процесс идёт» даёт нативный ActivityIndicator ниже. */}
        <View className="h-56 w-56 items-center justify-center">
          <View className="absolute h-56 w-56 rounded-full border border-primary/20 bg-primary/10" />
          <View className="absolute h-40 w-40 rounded-full border border-primary/25 bg-primary/15" />
          <View className="absolute h-28 w-28 rounded-full bg-primary/20" />
          <AnoonAvatar initials="?" tone={4} size={88} />
        </View>

        <View className="mt-10 flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#fdbf2d" />
          <Text className="text-lg font-semibold text-foreground">Ищем собеседника…</Text>
        </View>

        <Text className="mt-2 max-w-[16rem] text-center text-xs leading-relaxed text-muted-foreground">
          {ownAge
            ? `По фильтрам: ваш возраст ${ownAge}, собеседник ${
                peerAges.length ? peerAges.join(', ') : 'любой'
              }. Пол — противоположный.`
            : 'Пол — противоположный.'}
        </Text>
      </View>

      <View className="w-full px-5 pb-8">
        <Pressable
          accessibilityRole="button"
          onPress={cancel}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          className="w-full items-center rounded-2xl border border-border bg-card py-4">
          <Text className="text-base font-bold text-foreground">Отмена</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
