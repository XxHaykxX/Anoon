import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';

import { CameraIcon, CheckIcon, ChevronRightIcon, LockIcon } from '@/components/icons';
import { AnoonAvatar } from '@/components/shared';
import { avatarUrlFor } from '@/lib/media-url';
import { getTinodeClient } from '@/lib/tinode';
import { useAnoonStore } from '@/store';

/**
 * Профиль (`AnoonProfile.tsx`): аватар, редактируемые поля, ссылка на себя и
 * выходы в настройки / из аккаунта.
 *
 * Два отличия от веба, оба вынужденные:
 *   • «Скопировать ссылку» → «Поделиться»: буфера обмена в RN нет, а
 *     `expo-clipboard` не установлен. Штатный системный шэр решает ровно ту же
 *     задачу и на телефоне уместнее.
 *   • «Монеты и подписка» (`AnoonWallet`) не портирован — экрана кошелька в
 *     мобильном клиенте пока нет; строка показана недоступной, а не молча
 *     мёртвой.
 */

/** Собственный топик аккаунта — аватар и профиль лежат на `me`. */
const MY_TOPIC = 'me';

/** Инициалы (2 буквы) из имени: одно слово — первые две буквы. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Поле-карточка: подпись сверху, ввод снизу. */
function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'numeric';
}) {
  return (
    <View className="mb-3 rounded-2xl border border-border bg-card px-4 py-2.5">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9a9aa0"
        keyboardType={keyboardType}
        className="text-base text-foreground"
      />
    </View>
  );
}

/** Карточка «только чтение» с замком: #ID и пол не меняются. */
function LockedField({ label, note, value }: { label: string; note: string; value: string }) {
  return (
    <View className="mb-3 rounded-2xl border border-border bg-card px-4 py-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-muted-foreground">{label}</Text>
        <View className="flex-row items-center gap-1">
          <LockIcon size={14} color="#9a9aa0" />
          <Text className="text-[11px] text-muted-foreground">{note}</Text>
        </View>
      </View>
      <Text className="mt-0.5 text-lg font-semibold text-foreground">{value}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const user = useAnoonStore((s) => s.user);
  const setUser = useAnoonStore((s) => s.setUser);
  const signOut = useAnoonStore((s) => s.signOut);

  const hashId = user?.hashId ?? '—';
  const profileLink = `anoon.chat/u/${hashId}`;
  const genderLabel = user?.gender === 'female' ? 'Женский' : 'Мужской';

  const [nick, setNick] = useState(() => user?.displayName ?? '');
  const [firstName, setFirstName] = useState(() => user?.displayName.split(' ')[0] ?? '');
  const [lastName, setLastName] = useState(
    () => user?.displayName.split(' ').slice(1).join(' ') ?? '',
  );
  const [age, setAge] = useState(() => (user ? String(user.age) : ''));
  const [saved, setSaved] = useState(false);
  // Локальный uri выбранного файла — показываем сразу, пока идёт загрузка.
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // Ref читаем на каждом рендере, а не кладём в состояние один раз: `user`
  // приезжает асинхронно, и разовое чтение при монтировании навсегда залипло бы
  // на null. Перерисовку после загрузки даёт сброс `avatarPreview`.
  const avatarRef = avatarUrlFor(MY_TOPIC);

  const handleSave = () => {
    if (user) {
      const displayName = `${firstName} ${lastName}`.trim() || user.displayName;
      setUser({ ...user, displayName, age: Number(age) || user.age });
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setAvatarError('Нет доступа к галерее');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setAvatarPreview(asset.uri);
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      // React Native не знает `File`. Форма `{ uri, name, type }` — это то, что
      // понимает здешний FormData, а SDK кладёт объект в него как есть
      // (`form.append("file", file)`), так что до сети доедет правильный файл.
      const name = asset.fileName ?? 'avatar.jpg';
      const nativeFile = {
        uri: asset.uri,
        name,
        type: asset.mimeType ?? 'image/jpeg',
        size: asset.fileSize ?? 0,
      } as unknown as File;
      await getTinodeClient().setAvatar(nativeFile);
      // Ref перечитается сам на следующем рендере, который вызывает этот сброс.
      setAvatarPreview(null);
    } catch {
      setAvatarError('Не удалось загрузить фото');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleLogout = () => {
    signOut();
    router.replace('/onboarding');
  };

  return (
    <View className="flex-1 bg-background">
      <View className="px-5 pb-2 pt-4">
        <Text className="text-2xl font-bold text-foreground">Профиль</Text>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-6">
        <View className="items-center gap-3 py-4">
          <View>
            <AnoonAvatar
              initials={initialsOf(user?.displayName ?? '')}
              tone={user?.avatarTone ?? 0}
              size={92}
              photoUrl={avatarPreview ?? avatarRef}
            />
            {avatarUploading ? (
              <View className="absolute inset-0 items-center justify-center rounded-full bg-black/40">
                <Text className="text-xs font-medium text-white">Загрузка…</Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Сменить фото"
              onPress={() => void pickPhoto()}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              className="absolute -bottom-1 -right-1 h-8 w-8 items-center justify-center rounded-full border-4 border-background bg-primary">
              <CameraIcon size={14} color="#000000" />
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void pickPhoto()}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
            <Text className="text-sm font-medium text-primary">Сменить фото</Text>
          </Pressable>
          {avatarError ? <Text className="text-xs text-destructive">{avatarError}</Text> : null}
        </View>

        <LockedField label="#ID" note="не меняется" value={`#${hashId}`} />
        <Field label="Ник" value={nick} onChangeText={setNick} placeholder="Придумайте ник" />
        <Field label="Имя" value={firstName} onChangeText={setFirstName} placeholder="Имя" />
        <Field label="Фамилия" value={lastName} onChangeText={setLastName} placeholder="Фамилия" />
        <Field
          label="Возраст"
          value={age}
          onChangeText={(v) => setAge(v.replace(/\D/g, '').slice(0, 3))}
          placeholder="Возраст"
          keyboardType="numeric"
        />
        <LockedField label="Пол" note="нельзя изменить" value={genderLabel} />

        <Pressable
          accessibilityRole="button"
          onPress={handleSave}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          className="mt-1 h-12 flex-row items-center justify-center gap-2 rounded-full bg-primary">
          {saved ? <CheckIcon size={20} color="#000000" /> : null}
          <Text className="font-semibold text-primary-foreground">
            {saved ? 'Сохранено' : 'Сохранить'}
          </Text>
        </Pressable>

        <View className="mt-6 rounded-2xl border border-border bg-card p-4">
          <Text className="text-sm font-semibold text-foreground">Поделиться профилем</Text>
          <View className="mt-3 flex-row items-center justify-between gap-2 rounded-xl bg-muted px-4 py-3">
            <View className="min-w-0 flex-1">
              <Text className="text-xs text-muted-foreground">Ваша ссылка</Text>
              <Text className="font-medium text-foreground">{profileLink}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => void Share.share({ message: profileLink })}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              className="shrink-0 rounded-full bg-card px-3 py-1.5">
              <Text className="text-sm font-medium text-foreground">Поделиться</Text>
            </Pressable>
          </View>
        </View>

        <View className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <View
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            className="flex-row items-center justify-between px-4 py-3.5 opacity-50">
            <Text className="text-foreground">Монеты и подписка</Text>
            <Text className="text-xs text-muted-foreground">скоро</Text>
          </View>
          <View className="h-px bg-border" />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings')}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            className="flex-row items-center justify-between px-4 py-3.5">
            <Text className="text-foreground">Настройки</Text>
            <ChevronRightIcon size={16} color="#9a9aa0" />
          </Pressable>
          <View className="h-px bg-border" />
          <Pressable
            accessibilityRole="button"
            onPress={handleLogout}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            className="flex-row items-center justify-between px-4 py-3.5">
            <Text className="font-medium text-destructive">Выйти</Text>
            <ChevronRightIcon size={16} color="#ff453a" />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
