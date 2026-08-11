import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import {
  BellIcon,
  BlockIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LockIcon,
  ShieldIcon,
  TrashIcon,
} from '@/components/icons';
import { AnoonAvatar, AnoonButton, AnoonInput } from '@/components/shared';
import { getCompanionClient, type BlockedFriend } from '@/lib/companion';
import { isNotifySoundEnabled, setNotifySoundEnabled } from '@/lib/notify';
import { changePassword, deleteMyAccount } from '@/lib/tinode';
import { useAnoonStore } from '@/store';

/** Стабильный цвет аватара из #ID — бэкенд для блок-листа его не присылает. */
function toneFor(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return sum % 6;
}

/**
 * Настройки (`AnoonSettings.tsx`).
 *
 * Что здесь отличается от веба:
 *   • Тумблер — нативный `Switch` из react-native вместо кнопки с `role="switch"`.
 *   • Подтверждение удаления — системный `Alert`, а не свой модал: на телефоне
 *     это и привычнее, и меньше кода.
 *   • Пуши. Веб-версия ходит в Service Worker + Push API (`@/lib/push`), которых
 *     на телефоне нет; нативные пуши — это expo-notifications + APNs/FCM, то
 *     есть отдельная задача, а не шим. Строка показана честно выключенной, без
 *     тумблера: мёртвый переключатель хуже видимо недоступного.
 */
export default function SettingsScreen() {
  const user = useAnoonStore((s) => s.user);
  const setUser = useAnoonStore((s) => s.setUser);
  const signOut = useAnoonStore((s) => s.signOut);

  const [nick, setNick] = useState(user?.displayName ?? '');
  const [savedNick, setSavedNick] = useState(false);
  // Ленивая инициализация читает хранилище платформы (на телефоне — keystore).
  const [soundOn, setSoundOn] = useState(isNotifySoundEnabled);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blocked, setBlocked] = useState<BlockedFriend[]>([]);
  /** Список не прочитался — это НЕ «в нём никого нет». */
  const [blocksFailed, setBlocksFailed] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const passwordMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSavePassword =
    currentPassword.length > 0 && newPassword.length >= 6 && newPassword === confirmPassword;

  const [deleteBusy, setDeleteBusy] = useState(false);

  // Отказ чтения — не пустой чёрный список. listBlocks раньше отвечал на оба
  // случая одинаково, и провал рисовал «Список пуст» — ровно тот экран, где
  // ложное «никто не заблокирован» скорее всего приведёт к действию.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    void getCompanionClient()
      .listBlocks()
      .then((rows) => {
        if (!alive) return;
        setBlocked(rows);
        setBlocksFailed(false);
      })
      .catch(() => {
        if (alive) setBlocksFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  const saveNick = () => {
    if (user) setUser({ ...user, displayName: nick });
    setSavedNick(true);
    setTimeout(() => setSavedNick(false), 1600);
  };

  const handleChangePassword = async () => {
    if (!canSavePassword || passwordBusy) return;
    setPasswordBusy(true);
    setPasswordError(null);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 1600);
    } catch {
      setPasswordError('Не удалось сменить пароль — проверьте текущий пароль.');
    } finally {
      setPasswordBusy(false);
    }
  };

  const toggleSound = (next: boolean) => {
    setSoundOn(next);
    setNotifySoundEnabled(next);
  };

  const handleLogout = () => {
    signOut();
    router.replace('/onboarding');
  };

  const doDelete = async () => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    try {
      // Сначала best-effort зачистка в companion (может ответить 404 — ещё не
      // реализовано), потом настоящее удаление на стороне Tinode.
      await getCompanionClient().deleteMe();
      await deleteMyAccount();
      signOut();
      router.replace('/onboarding');
    } catch {
      setDeleteBusy(false);
      Alert.alert('Не удалось удалить аккаунт', 'Попробуйте ещё раз.');
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Удалить аккаунт?',
      'Это необратимо: профиль, друзья и сообщения будут удалены без возможности восстановления.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => void doDelete() },
      ],
    );
  };

  const unblock = async (hashId: string) => {
    // Оптимистично — unblockFriend пробрасывает ошибку, поэтому возвращаем
    // запись на место, если он отказал.
    const prev = blocked;
    setBlocked((cur) => cur.filter((b) => b.hashId !== hashId));
    try {
      await getCompanionClient().unblockFriend(hashId);
    } catch {
      setBlocked(prev);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <View className="shrink-0 flex-row items-center gap-1 px-3 pb-2 pt-14">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Назад"
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          className="h-9 w-9 items-center justify-center rounded-full">
          <ChevronLeftIcon size={24} />
        </Pressable>
        <Text className="text-2xl font-bold text-foreground">Настройки</Text>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-10" keyboardShouldPersistTaps="handled">
        {/* Ник */}
        <View className="mt-2 rounded-2xl border border-border bg-card p-4">
          <AnoonInput label="Сменить ник" value={nick} onChangeText={setNick} placeholder="Новый ник" />
          <Pressable
            accessibilityRole="button"
            onPress={saveNick}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            className="mt-3 w-full flex-row items-center justify-center gap-2 rounded-full bg-primary py-2.5">
            {savedNick ? <CheckIcon size={20} color="#000000" /> : null}
            <Text className="font-semibold text-primary-foreground">
              {savedNick ? 'Сохранено' : 'Сохранить'}
            </Text>
          </Pressable>
        </View>

        {/* Пароль */}
        <View className="mt-4 rounded-2xl border border-border bg-card p-4">
          <Text className="text-sm font-semibold text-foreground">Сменить пароль</Text>
          <View className="mt-2 gap-2">
            <AnoonInput
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Текущий пароль"
              secureTextEntry
              autoCapitalize="none"
              textContentType="password"
            />
            <AnoonInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Новый пароль (мин. 6 символов)"
              secureTextEntry
              autoCapitalize="none"
              textContentType="newPassword"
            />
            <AnoonInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Повторите новый пароль"
              secureTextEntry
              autoCapitalize="none"
              textContentType="newPassword"
              error={passwordMismatch ? 'Пароли не совпадают' : passwordError}
            />
          </View>
          <AnoonButton
            label={passwordSaved ? 'Сохранено' : 'Сменить пароль'}
            loading={passwordBusy}
            disabled={!canSavePassword}
            onPress={() => void handleChangePassword()}
            className="mt-3 rounded-full"
          />
        </View>

        {/* Уведомления */}
        <View className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <View className="flex-row items-center gap-3 px-4 py-3">
            <View className="h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
              <BellIcon size={20} color="#000000" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-foreground">Уведомления</Text>
              <Text className="text-xs text-muted-foreground">
                Пуши в этой сборке пока недоступны
              </Text>
            </View>
          </View>
          <View className="h-px bg-border" />
          <View className="flex-row items-center gap-3 px-4 py-3">
            <View className="h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
              <BellIcon size={20} color="#000000" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-foreground">Звук и вибрация</Text>
              <Text className="text-xs text-muted-foreground">
                Новые сообщения, совпадения, заявки в друзья
              </Text>
            </View>
            <Switch
              accessibilityLabel="Звук и вибрация"
              value={soundOn}
              onValueChange={toggleSound}
              trackColor={{ false: '#2c2c2e', true: '#fdbf2d' }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        {/* Заблокированные */}
        <View className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: blockedOpen }}
            onPress={() => setBlockedOpen((o) => !o)}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            className="w-full flex-row items-center gap-3 px-4 py-3">
            <View className="h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
              <BlockIcon size={20} color="#000000" />
            </View>
            <Text className="min-w-0 flex-1 text-foreground">Заблокированные</Text>
            <Text className="text-sm text-muted-foreground">
              {blocksFailed ? '—' : blocked.length}
            </Text>
            <ChevronRightIcon size={16} color="#9a9aa0" />
          </Pressable>

          {blockedOpen ? (
            <View className="border-t border-border">
              {blocksFailed ? (
                <Text className="px-4 py-4 text-center text-sm text-destructive">
                  Не удалось загрузить список. Откройте экран заново
                </Text>
              ) : blocked.length === 0 ? (
                <Text className="px-4 py-4 text-center text-sm text-muted-foreground">Список пуст</Text>
              ) : (
                blocked.map((b) => (
                  <View
                    key={b.hashId}
                    className="flex-row items-center gap-3 border-b border-border px-4 py-2.5">
                    <AnoonAvatar initials="?" tone={toneFor(b.hashId)} size={32} />
                    <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-foreground">
                      {b.displayName || `Собеседник #${b.hashId}`}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void unblock(b.hashId)}
                      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                      className="rounded-full bg-muted px-3 py-1.5">
                      <Text className="text-xs font-medium text-foreground">Разблокировать</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          ) : null}
        </View>

        {/* Состояния модерации — демо: события «бан»/«мьют» у companion ещё нет,
            эти экраны иначе никак не открыть, а QA они нужны. */}
        <View className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <Row
            icon={<ShieldIcon size={20} color="#000000" />}
            label="Экран блокировки (демо)"
            onPress={() => router.push('/banned')}
          />
          <View className="h-px bg-border" />
          <Row
            icon={<LockIcon size={20} color="#000000" />}
            label="Экран мьюта (демо)"
            onPress={() => router.push('/muted')}
          />
        </View>

        {/* Выход */}
        <Pressable
          accessibilityRole="button"
          onPress={handleLogout}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          className="mt-4 w-full items-center rounded-2xl border border-destructive/30 bg-destructive/10 py-3">
          <Text className="font-semibold text-destructive">Выход</Text>
        </Pressable>
        <Text className="mt-2 px-2 text-center text-xs text-muted-foreground">
          Профиль будет сброшен на этом устройстве.
        </Text>

        {/* Удаление аккаунта */}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: deleteBusy }}
          disabled={deleteBusy}
          onPress={confirmDelete}
          style={({ pressed }) => ({ opacity: deleteBusy ? 0.5 : pressed ? 0.85 : 1 })}
          className="mt-3 w-full flex-row items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 py-3">
          <TrashIcon size={20} color="#ff453a" />
          <Text className="font-semibold text-destructive">
            {deleteBusy ? 'Удаляем…' : 'Удалить аккаунт'}
          </Text>
        </Pressable>
        <Text className="mt-2 px-2 text-center text-xs text-muted-foreground">
          Аккаунт и все данные будут удалены без возможности восстановления.
        </Text>
      </ScrollView>
    </View>
  );
}

function Row({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      className="w-full flex-row items-center gap-3 px-4 py-3">
      <View className="h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">{icon}</View>
      <Text className="flex-1 text-foreground">{label}</Text>
      <ChevronRightIcon size={16} color="#9a9aa0" />
    </Pressable>
  );
}
