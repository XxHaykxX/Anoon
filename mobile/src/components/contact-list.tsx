import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import {
  ChatIcon,
  ChevronRightIcon,
  CloseIcon,
  ForwardIcon,
  SearchIcon,
} from '@/components/icons';
import { AnoonAvatar, StatusDot } from '@/components/shared';
import { avatarUrlFor } from '@/lib/media-url';
import { useAnoonStore } from '@/store';
import type { Friend } from '@/types/companion';

/**
 * Список контактов — порт `AnoonFriends.tsx`, который на вебе тоже один
 * компонент на две вкладки: «Чаты» (`mode="chats"`, только начатые переписки)
 * и «Контакты» (весь список). Отсюда общий файл, а не копия в каждом экране.
 */

/** Грубое «N назад» из unix-ms (те же формулировки, что в уведомлениях). */
function relativeTime(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'вчера' : `${d} дн`;
}

function capBadge(n: number): string {
  return n > 9 ? '9+' : String(n);
}

/** Пустое состояние: кружок с иконкой, заголовок, подсказка. */
function Empty({
  Icon,
  title,
  hint,
  children,
}: {
  Icon: (p: { size?: number; color?: string }) => React.ReactElement;
  title: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <View className="items-center px-8 pt-24">
      <View className="mb-3 h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Icon size={24} color="#9a9aa0" />
      </View>
      <Text className="text-sm font-medium text-foreground">{title}</Text>
      <Text className="mt-1 text-center text-xs text-muted-foreground">{hint}</Text>
      {children}
    </View>
  );
}

function ContactRow({ friend, onPress }: { friend: Friend; onPress: () => void }) {
  const unread = friend.unread ?? 0;
  // У анонимного друга ника нет — имя И ЕСТЬ #ID, второй раз его не печатаем (BUG-42).
  const nameIsHash =
    !friend.displayName ||
    friend.displayName.replace(/^#/, '') === friend.hashId.replace(/^#/, '');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Открыть чат: ${friend.displayName || friend.hashId}`}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      className="flex-row items-center gap-3 px-5 py-2.5">
      <View className="shrink-0">
        <AnoonAvatar
          initials={(friend.displayName.trim()[0] ?? '?').toUpperCase()}
          tone={friend.avatarTone}
          size={48}
          photoUrl={avatarUrlFor(friend.topic)}
        />
        <View className="absolute bottom-0 right-0">
          <StatusDot online={friend.online} />
        </View>
      </View>

      <View className="min-w-0 flex-1">
        <View className="flex-row items-center justify-between gap-2">
          <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
            <Text numberOfLines={1} className="shrink font-semibold text-foreground">
              {nameIsHash ? friend.hashId : friend.displayName}
            </Text>
            {nameIsHash ? null : (
              <Text className="shrink-0 text-xs text-muted-foreground">{friend.hashId}</Text>
            )}
          </View>
          {friend.lastActiveAt ? (
            <Text className="shrink-0 text-[11px] text-muted-foreground">
              {relativeTime(friend.lastActiveAt)}
            </Text>
          ) : null}
        </View>
        {/* Соглашение списка чатов (BUG-25): вторая строка — последнее
            сообщение, если оно есть; «в сети»/«был…» стоит там только до
            первого сообщения. */}
        <Text
          numberOfLines={1}
          className={`text-sm ${
            !friend.lastMessage && friend.online ? 'text-online' : 'text-muted-foreground'
          }`}>
          {friend.lastMessage || (friend.online ? 'в сети' : friend.lastSeen ?? '')}
        </Text>
      </View>

      <View className="shrink-0 flex-row items-center gap-2">
        {unread > 0 ? (
          <View className="h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5">
            <Text className="text-[11px] font-semibold text-primary-foreground">
              {capBadge(unread)}
            </Text>
          </View>
        ) : null}
        <ChevronRightIcon size={20} color="#9a9aa0" />
      </View>
    </Pressable>
  );
}

export function ContactList({ mode }: { mode: 'chats' | 'friends' }) {
  const isChats = mode === 'chats';
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const storeFriends = useAnoonStore((s) => s.friends);
  const setChatTarget = useAnoonStore((s) => s.setChatTarget);
  const startContacts = useAnoonStore((s) => s.startContacts);

  useEffect(() => {
    void startContacts();
  }, [startContacts]);

  // Свежие сверху — обычный порядок списка чатов (BUG-25).
  const all = useMemo(
    () => [...storeFriends].sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)),
    [storeFriends],
  );
  // «Чаты» — только начатые переписки; «Контакты» — весь список (BUG-36).
  const friends = isChats ? all.filter((f) => !!f.lastMessage) : all;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return friends;
    return friends.filter(
      (f) =>
        f.displayName.toLowerCase().includes(needle) || f.hashId.toLowerCase().includes(needle),
    );
  }, [friends, query]);

  const openFriend = (friend: Friend) => {
    // Кладём цель в стор и даём экрану чата открыть её своим эффектом на
    // монтировании: открытие здесь гоняется с его же размонтированием.
    setChatTarget(friend);
    router.push('/private-chat');
  };

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-5 pb-2 pt-3">
        <Text className="text-2xl font-bold text-foreground">
          {isChats ? 'Чаты' : 'Контакты'}
        </Text>
        <View className="flex-row items-center gap-4">
          {searchOpen ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Пригласить друга"
              onPress={() => router.push('/invite')}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              className="p-1.5">
              <ForwardIcon size={24} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={searchOpen ? 'Закрыть поиск' : 'Поиск друзей'}
            onPress={() => {
              setSearchOpen((open) => !open);
              setQuery('');
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            className="p-1.5">
            {searchOpen ? <CloseIcon size={24} /> : <SearchIcon size={24} />}
          </Pressable>
        </View>
      </View>

      {searchOpen ? (
        <View className="px-5 pb-2">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Поиск среди друзей"
            placeholderTextColor="#9a9aa0"
            autoFocus
            autoCorrect={false}
            className="rounded-full bg-muted px-4 py-2 text-sm text-foreground"
          />
        </View>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(f) => f.id}
        renderItem={({ item }) => <ContactRow friend={item} onPress={() => openFriend(item)} />}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query.trim() ? (
            // Поиск сузил список до нуля — это не то же самое, что «чатов нет»
            // вообще (BUG-25): «Чаты» — стартовый экран после входа.
            <Empty Icon={SearchIcon} title="Никого не нашлось" hint="Попробуйте другой ник или #ID">
              {/* На вебе экран поиска по #ID открывался тем же тапом по лупе,
                  что и локальный фильтр. На телефоне это взаимоисключающие
                  вещи, поэтому вход в него — отсюда. */}
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/friend-search')}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                className="mt-4 rounded-full bg-secondary px-4 py-2">
                <Text className="text-sm font-semibold text-foreground">Найти по #ID</Text>
              </Pressable>
            </Empty>
          ) : isChats ? (
            <Empty
              Icon={ChatIcon}
              title="Пока нет чатов"
              hint="Начните рулетку или добавьте друга по #ID"
            />
          ) : (
            <Empty
              Icon={ForwardIcon}
              title="Пока нет друзей"
              hint="Добавьте друга по #ID или через рулетку"
            />
          )
        }
      />

      {/* «Заявки» — плавающая кнопка только на «Контактах» (на вебе её рисует
          оболочка приложения, здесь оболочки нет). */}
      {isChats ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/friend-requests')}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          className="absolute bottom-4 right-4 rounded-full bg-primary px-4 py-2.5">
          <Text className="text-sm font-semibold text-primary-foreground">Заявки</Text>
        </Pressable>
      )}
    </View>
  );
}
