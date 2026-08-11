import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { CheckIcon, type IconProps } from '@/components/icons';
import { AnoonLogo } from '@/components/shared';
import { useAnoonStore } from '@/store';

// Локальные иконки экрана — как на вебе.
const MaleIcon = ({ size = 40, color = '#9a9aa0' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx="10" cy="14" r="6" />
    <Path d="M15 9l5-5" />
    <Path d="M15 4h5v5" />
  </Svg>
);
const FemaleIcon = ({ size = 40, color = '#9a9aa0' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx="12" cy="8" r="6" />
    <Path d="M12 14v8" />
    <Path d="M9 19h6" />
  </Svg>
);

type Gender = 'male' | 'female' | null;

/** Цвета токенов, которых иконкам не достать через className. */
const PRIMARY = '#fdbf2d';
const MUTED_FOREGROUND = '#9a9aa0';

/**
 * Выбор пола (`AnoonGenderSelect.tsx`). Пол задаёт подбор собеседников и потом
 * не меняется, поэтому продолжить можно только с явным подтверждением.
 *
 * Ветка `pendingGoogleToken` — первый вход через Google: `auth-login.tsx`
 * получает токен нативным флоу (`@/lib/google-auth`), стор поднимает
 * `NeedsGenderError` и держит токен, а здесь он предъявляется вместе с полом.
 */
export default function GenderScreen() {
  const [gender, setGender] = useState<Gender>(null);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const pendingGoogleToken = useAnoonStore((s) => s.pendingGoogleToken);
  const signInWithGoogle = useAnoonStore((s) => s.signInWithGoogle);
  const authError = useAnoonStore((s) => s.authError);

  const canContinue = !!gender && understood && !busy;

  const submit = async () => {
    if (!gender) return;
    if (!pendingGoogleToken) {
      router.replace('/auth-profile-setup');
      return;
    }
    setBusy(true);
    try {
      await signInWithGoogle(pendingGoogleToken, gender);
      router.replace('/(tabs)/chats');
    } catch {
      // authError показан ниже; человек остаётся здесь и может повторить.
    } finally {
      setBusy(false);
    }
  };

  const options = [
    { id: 'male' as const, label: 'Мужчина', Icon: MaleIcon },
    { id: 'female' as const, label: 'Женщина', Icon: FemaleIcon },
  ];

  return (
    <View className="flex-1 bg-background">
      <View className="px-6 pt-6">
        <AnoonLogo size={20} />
      </View>

      <ScrollView contentContainerClassName="px-6 pb-6" keyboardShouldPersistTaps="handled">
        <Text className="mt-6 text-2xl font-bold text-foreground">Выберите пол</Text>
        <Text className="mt-2 text-sm text-muted-foreground">
          По полу подбираются собеседники. Выберите свой.
        </Text>

        <View className="mt-7 flex-row gap-3">
          {options.map(({ id, label, Icon }) => {
            const active = gender === id;
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setGender(id)}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, aspectRatio: 1 })}
                className={`flex-1 items-center justify-center gap-3 rounded-2xl border ${
                  active ? 'border-primary bg-primary/15' : 'border-border bg-card'
                }`}>
                <Icon color={active ? PRIMARY : MUTED_FOREGROUND} />
                <Text className="text-base font-semibold text-foreground">{label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View className="mt-6 flex-row items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
          <Text className="text-lg">⚠️</Text>
          <Text className="flex-1 text-sm text-foreground">
            Пол потом изменить нельзя. Убедитесь, что выбрали правильно.
          </Text>
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: understood }}
          onPress={() => setUnderstood((v) => !v)}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          className="mt-4 w-full flex-row items-center gap-3">
          <View
            className={`h-6 w-6 items-center justify-center rounded-md border ${
              understood ? 'border-primary bg-primary' : 'border-border bg-card'
            }`}>
            {understood && <CheckIcon size={16} color="#000000" />}
          </View>
          <Text className="flex-1 text-sm text-foreground">Понимаю, что пол изменить будет нельзя</Text>
        </Pressable>
      </ScrollView>

      <View className="border-t border-border px-6 py-4">
        {authError ? <Text className="mb-3 text-center text-sm text-destructive">{authError}</Text> : null}
        {/* `replace`, не `push`: пол подтверждён необратимо — возвращаться некуда. */}
        <Pressable
          accessibilityRole="button"
          disabled={!canContinue}
          onPress={() => void submit()}
          style={({ pressed }) => ({ opacity: canContinue ? (pressed ? 0.85 : 1) : 0.5 })}
          className="items-center rounded-xl bg-primary py-3.5">
          <Text className="text-base font-semibold text-primary-foreground">
            {busy ? 'Входим…' : 'Продолжить'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
