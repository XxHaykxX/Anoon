import { router } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';

import { BellIcon, CheckIcon, CloseIcon, PeopleIcon } from '@/components/icons';
import { AnoonAvatar } from '@/components/shared';
import { getCompanionClient } from '@/lib/companion';
import { useAnoonStore } from '@/store';
import type { FriendRequest, Notification } from '@/types/companion';

/**
 * Уведомления (`AnoonNotifications.tsx`): заявки в друзья сверху, лента ниже.
 *
 * Чего нет и почему: баннера «Включите уведомления». На вебе он дёргает
 * `Notification.requestPermission()`; на телефоне разрешение спрашивает
 * `expo-notifications`, которого в зависимостях нет — а кнопка, которая
 * ничего не включает, врёт пользователю. Вернётся вместе с самим пушем.
 */

/** Две буквы аватара из #ID («#04821» → «04»). */
function initialsFromHash(hashId: string): string {
  const clean = hashId.replace(/^#/, '');
  return (clean.slice(0, 2) || '··').toUpperCase();
}

/** Устойчивый тон аватара (0–5) из строки #ID. */
function toneFromHash(hashId: string): number {
  return [...hashId].reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
}

/** Грубое «N назад» из unix-ms. */
function relativeTime(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'вчера' : `${d} дн назад`;
}

/** Заявка в друзья — карточка с двумя кнопками. */
function RequestCard({
  request,
  onRespond,
}: {
  request: FriendRequest;
  onRespond: (accept: boolean) => void;
}) {
  return (
    <View className="mb-2 flex-row items-center gap-3 rounded-2xl border border-border bg-card p-3">
      <AnoonAvatar
        initials={initialsFromHash(request.hashId)}
        tone={request.avatarTone}
        size={44}
      />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-sm font-semibold text-foreground">
          {request.displayName || `Собеседник ${request.hashId}`}
        </Text>
        <Text numberOfLines={1} className="text-xs text-muted-foreground">
          хочет добавить вас в друзья
        </Text>
      </View>
      <View className="shrink-0 flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Принять"
          onPress={() => onRespond(true)}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          className="h-9 w-9 items-center justify-center rounded-full bg-primary">
          <CheckIcon size={20} color="#000000" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Отклонить"
          onPress={() => onRespond(false)}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          className="h-9 w-9 items-center justify-center rounded-full bg-muted">
          <CloseIcon size={20} color="#9a9aa0" />
        </Pressable>
      </View>
    </View>
  );
}

export default function NotificationsScreen() {
  const requests = useAnoonStore((s) => s.requests);
  const notifications = useAnoonStore((s) => s.notifications);
  const unreadCount = useAnoonStore((s) => s.unreadCount);
  const removeRequest = useAnoonStore((s) => s.removeRequest);
  const addRequest = useAnoonStore((s) => s.addRequest);
  const showError = useAnoonStore((s) => s.showError);
  const markRead = useAnoonStore((s) => s.markRead);
  const markAllRead = useAnoonStore((s) => s.markAllRead);

  const incoming = requests.filter((r) => r.direction === 'incoming');

  const handleRequest = (request: FriendRequest, accept: boolean) => {
    void getCompanionClient()
      .friendRespond(request.hashId, accept)
      .catch(() => {
        // Отказ — возвращаем заявку на место, иначе пользователь решит, что
        // ответил, а сервер об этом не знает.
        addRequest(request);
        showError('Не удалось ответить на заявку. Попробуйте ещё раз');
      });
    removeRequest(request.id);
  };

  const handleFeedPress = (item: Notification) => {
    markRead(item.id);
    // Всё про друзей ведёт на вкладку друзей, остальное — информационное.
    if (item.kind === 'friend_request' || item.kind === 'friend_accepted') {
      router.navigate('/(tabs)/friends');
    }
  };

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-5 pb-2 pt-4">
        <Text className="text-3xl font-bold text-foreground">Уведомления</Text>
        {unreadCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={markAllRead}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            className="rounded-full px-3 py-1.5">
            <Text className="text-sm font-medium text-primary">Прочитать все</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Один скролл на экран: заявки едут шапкой ленты, а не вторым списком —
          вложенные скроллы в RN так же плохи, как и в вебе. */}
      <FlatList
        data={notifications}
        keyExtractor={(n) => n.id}
        ListHeaderComponent={
          <View>
            {incoming.length > 0 ? (
              <View className="mb-3">
                <View className="flex-row items-center gap-2 px-5 pb-2 pt-1">
                  <PeopleIcon size={16} color="#9a9aa0" />
                  <Text className="text-sm font-semibold text-muted-foreground">
                    Заявки в друзья
                  </Text>
                  <View className="h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5">
                    <Text className="text-[11px] font-semibold text-primary-foreground">
                      {incoming.length}
                    </Text>
                  </View>
                </View>
                <View className="px-5">
                  {incoming.map((request) => (
                    <RequestCard
                      key={request.id}
                      request={request}
                      onRespond={(accept) => handleRequest(request, accept)}
                    />
                  ))}
                </View>
              </View>
            ) : null}
            <Text className="px-5 pb-1 pt-1 text-sm font-semibold text-muted-foreground">
              Лента
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text className="px-5 pt-6 text-sm text-muted-foreground">Пока ничего нет</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => handleFeedPress(item)}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            className="flex-row items-center gap-3 border-b border-border px-5 py-3">
            {item.hashId ? (
              <AnoonAvatar
                initials={initialsFromHash(item.hashId)}
                tone={toneFromHash(item.hashId)}
                size={40}
              />
            ) : (
              <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
                <BellIcon size={20} color="#9a9aa0" />
              </View>
            )}
            <View className="min-w-0 flex-1">
              <Text
                className={`text-sm ${item.read ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>
                {item.body ? `${item.title} — ${item.body}` : item.title}
              </Text>
              <Text className="mt-0.5 text-xs text-muted-foreground">
                {relativeTime(item.createdAt)}
              </Text>
            </View>
            {item.read ? null : (
              <View className="mt-1 h-2.5 w-2.5 shrink-0 self-start rounded-full bg-primary" />
            )}
          </Pressable>
        )}
      />
    </View>
  );
}
