import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CheckIcon, CloseIcon } from '@/components/icons';
import { AnoonAvatar } from '@/components/shared';
import { getCompanionClient } from '@/lib/companion';
import { useAnoonStore } from '@/store';

type RequestStatus = 'pending' | 'accepted' | 'declined';

interface FriendRequestRow {
  id: string;
  hashId: string;
  name: string;
  initials: string;
  tone: number;
  when: string;
}

/** Грубое «сколько назад» из unix-ms. */
function timeAgo(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин назад`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  return 'вчера';
}

/** Заявки в друзья (`AnoonFriendRequests.tsx`). Демо-строки веба здесь не нужны. */
export default function FriendRequestsScreen() {
  const [statuses, setStatuses] = useState<Record<string, RequestStatus>>({});

  const storeRequests = useAnoonStore((s) => s.requests);
  const upsertFriend = useAnoonStore((s) => s.upsertFriend);
  const removeRequest = useAnoonStore((s) => s.removeRequest);
  const addRequest = useAnoonStore((s) => s.addRequest);
  const showError = useAnoonStore((s) => s.showError);

  const rows: FriendRequestRow[] = storeRequests
    .filter((r) => r.direction === 'incoming')
    .map((r) => ({
      id: r.id,
      hashId: r.hashId.startsWith('#') ? r.hashId : `#${r.hashId}`,
      name: r.displayName,
      initials: (r.displayName.trim()[0] ?? '?').toUpperCase(),
      tone: r.avatarTone,
      when: timeAgo(r.createdAt),
    }));

  const setStatus = (id: string, status: RequestStatus) =>
    setStatuses((prev) => ({ ...prev, [id]: status }));

  const respond = (r: FriendRequestRow, accept: boolean) => {
    setStatus(r.id, accept ? 'accepted' : 'declined');
    const raw = r.hashId.replace(/^#/, '');
    // Держим исходную строку: отказ бэкенда должен вернуть её обратно — из
    // стора она уже уйдёт, и повторить будет нечего.
    const original = storeRequests.find((x) => x.id === r.id);
    // Друг добавляется ВМЕСТЕ с p2p-топиком, который вернул бэкенд: без него
    // чат открывается без топика и сообщения уходят в никуда (BUG-42).
    void getCompanionClient()
      .friendRespond(raw, accept)
      .then((res) => {
        if (!accept) return;
        upsertFriend({
          id: raw,
          hashId: r.hashId,
          displayName: r.name,
          avatarTone: r.tone,
          topic: res.topic,
          online: true,
          lastActiveAt: Date.now(),
        });
      })
      .catch(() => {
        // Бэкенд отказал — откатываем оптимистичный UI, иначе человек уверен,
        // что у него появился друг, о котором ничей сервер не знает.
        setStatus(r.id, 'pending');
        if (original) addRequest(original);
        showError(
          accept
            ? 'Не удалось принять заявку. Попробуйте ещё раз'
            : 'Не удалось отклонить заявку. Попробуйте ещё раз',
        );
      });
    // Убираем из стора и здесь — иначе заявка висит вечно: вернётся при
    // следующем заходе, а бейджи «Заявки»/уведомлений никогда не уменьшатся.
    removeRequest(r.id);
  };

  const pendingCount = rows.filter((r) => (statuses[r.id] ?? 'pending') === 'pending').length;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <View className="flex-row items-center justify-between px-5 pb-3 pt-3">
        <Text className="text-2xl font-bold text-foreground">Заявки в друзья</Text>
        {pendingCount > 0 ? (
          <View className="h-6 min-w-6 items-center justify-center rounded-full bg-primary px-2">
            <Text className="text-xs font-semibold text-primary-foreground">{pendingCount}</Text>
          </View>
        ) : null}
      </View>

      <ScrollView className="flex-1">
        {pendingCount === 0 ? (
          <Text className="px-5 pt-4 text-center text-xs text-muted-foreground">Новых заявок нет</Text>
        ) : null}

        <View className="gap-2.5 px-5">
          {rows.map((r) => {
            const status = statuses[r.id] ?? 'pending';
            return (
              <View key={r.id} className="rounded-2xl border border-border bg-card p-3">
                <View className="flex-row items-center gap-3">
                  <AnoonAvatar initials={r.initials} tone={r.tone} size={44} />
                  <View className="min-w-0 flex-1">
                    <View className="flex-row items-center gap-1.5">
                      <Text numberOfLines={1} className="shrink font-semibold text-foreground">
                        {r.name}
                      </Text>
                      <Text className="shrink-0 text-xs text-muted-foreground">{r.hashId}</Text>
                    </View>
                    <Text numberOfLines={1} className="text-sm text-muted-foreground">
                      хочет добавить в друзья · {r.when}
                    </Text>
                  </View>
                </View>

                {status === 'pending' ? (
                  <View className="mt-3 flex-row gap-2">
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => respond(r, true)}
                      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                      className="flex-1 flex-row items-center justify-center gap-1.5 rounded-full bg-primary py-2">
                      <CheckIcon size={16} color="#000000" />
                      <Text className="text-sm font-semibold text-primary-foreground">Принять</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => respond(r, false)}
                      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                      className="flex-1 flex-row items-center justify-center gap-1.5 rounded-full bg-muted py-2">
                      <CloseIcon size={16} />
                      <Text className="text-sm font-semibold text-foreground">Отклонить</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View
                    className={`mt-3 rounded-full py-2 ${
                      status === 'accepted' ? 'bg-online/15' : 'bg-muted'
                    }`}>
                    <Text
                      className={`text-center text-sm font-medium ${
                        status === 'accepted' ? 'text-online' : 'text-muted-foreground'
                      }`}>
                      {status === 'accepted' ? 'Заявка принята — вы теперь друзья' : 'Заявка отклонена'}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
