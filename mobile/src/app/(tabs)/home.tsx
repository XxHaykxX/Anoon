import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BellIcon, DownloadIcon } from '@/components/icons';
import { AnoonAvatar, AnoonLogo } from '@/components/shared';
import { avatarUrlFor } from '@/lib/media-url';
import { useAnoonStore } from '@/store';

/**
 * Рулетка (`AnoonHome.tsx`) — стартовый экран поиска собеседника.
 *
 * Показное состояние веба (моковые «Аноним» / «#00001» / бейдж 3, когда стора
 * нет) сюда не переехало: у мобильного клиента режим ровно один — живой
 * бэкенд, и рисовать выдуманный #ID вместо настоящего здесь нечему.
 */

/** Собственный топик аккаунта — аватар и профиль лежат на `me`. */
const MY_TOPIC = 'me';

const AGE_RANGES = ['18–21', '22–25', '26–35', '36+'] as const;
type AgeRange = (typeof AGE_RANGES)[number];

/** Инициалы (2 буквы) из имени: одно слово — первые две буквы. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Возраст из профиля → один из общих диапазонов. */
function ageRangeFor(age: number): AgeRange {
  if (age <= 21) return '18–21';
  if (age <= 25) return '22–25';
  if (age <= 35) return '26–35';
  return '36+';
}

export default function HomeScreen() {
  // Возраст собеседника — мультивыбор. Свой возраст здесь НЕ спрашивается
  // (BUG-21): он уже есть в профиле, заполнен при регистрации.
  const [partnerAges, setPartnerAges] = useState<AgeRange[]>([]);
  const [searching, setSearching] = useState(false);

  const joinQueue = useAnoonStore((s) => s.joinQueue);
  const user = useAnoonStore((s) => s.user);
  const unreadCount = useAnoonStore((s) => s.unreadCount);

  const ownAgeRange: AgeRange = ageRangeFor(user?.age ?? 18);

  const togglePartnerAge = (range: AgeRange) => {
    setPartnerAges((prev) =>
      prev.includes(range) ? prev.filter((r) => r !== range) : [...prev, range],
    );
  };

  const startChat = () => {
    setSearching(true);
    // Отказ в постановке в очередь (заблокированный аккаунт, лимит) раньше
    // отвечали выдуманным матчем. Теперь промис отклоняется, ждать нечего —
    // уходим с экрана поиска обратно, а не крутим спиннер вечно.
    void joinQueue({ ownAgeRange, peerAgeRanges: partnerAges }).catch(() => {
      setSearching(false);
      router.navigate('/(tabs)/home');
    });
    router.push('/searching');
  };

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-5 pt-4">
        <AnoonLogo />
        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/install')}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            className="flex-row items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5">
            <DownloadIcon size={16} />
            <Text className="text-xs font-semibold text-foreground">Установить</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Уведомления"
            onPress={() => router.navigate('/(tabs)/notifications')}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            className="h-9 w-9 items-center justify-center rounded-full border border-border bg-card">
            <BellIcon size={20} />
            {unreadCount > 0 ? (
              <View className="absolute -right-0.5 -top-0.5 h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1">
                <Text className="text-[10px] font-semibold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-4 pt-4">
        {/* Своя карточка */}
        <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-card p-3">
          <AnoonAvatar
            initials={initialsOf(user?.displayName ?? '')}
            tone={user?.avatarTone ?? 0}
            size={48}
            photoUrl={avatarUrlFor(MY_TOPIC)}
          />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="font-semibold text-foreground">
              {user?.displayName ?? 'Аноним'}
            </Text>
            <Text className="text-xs text-muted-foreground">#{user?.hashId ?? '—'}</Text>
          </View>
        </View>

        {/* Возраст собеседника — чипы, можно несколько */}
        <View className="mt-6">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-foreground">Возраст собеседника</Text>
            <Text className="text-[11px] text-muted-foreground">можно несколько</Text>
          </View>
          <View className="mt-3 flex-row flex-wrap gap-2">
            {AGE_RANGES.map((range) => {
              const active = partnerAges.includes(range);
              return (
                <Pressable
                  key={range}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => togglePartnerAge(range)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                  className={`rounded-full border px-4 py-2 ${
                    active ? 'border-primary bg-primary' : 'border-border bg-card'
                  }`}>
                  <Text
                    className={`text-xs font-semibold ${
                      active ? 'text-primary-foreground' : 'text-muted-foreground'
                    }`}>
                    {range}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text className="mt-5 rounded-xl bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          Пол собеседника подбирается автоматически — противоположный вашему.
        </Text>
      </ScrollView>

      <View className="px-5 pb-3">
        <Pressable
          accessibilityRole="button"
          onPress={startChat}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          className="w-full items-center rounded-2xl bg-primary py-4">
          <Text className="text-base font-bold text-primary-foreground">
            {searching ? 'Поиск…' : 'Начать чат'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
