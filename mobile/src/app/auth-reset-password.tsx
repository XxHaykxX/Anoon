import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { CheckIcon, ChevronLeftIcon, type IconProps } from '@/components/icons';
import { AnoonLogo } from '@/components/shared';
import { getCompanionClient } from '@/lib/companion';

const EyeIcon = ({ size = 20, color = '#9a9aa0' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <Circle cx="12" cy="12" r="3" />
  </Svg>
);
const EyeOffIcon = ({ size = 20, color = '#9a9aa0' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.6 18.6 0 0 1 4.22-5.06M9.9 4.24A10.4 10.4 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <Path d="M1 1l22 22" />
  </Svg>
);

/** Токен `--color-online`: иконке его не достать через className. */
const ONLINE = '#32d74b';

/**
 * Новый пароль (`AnoonResetPassword.tsx`). Код из письма вводится руками:
 * SMTP на бэкенде заглушён, переходить по ссылке из почты пока не по чему.
 */
export default function ResetPasswordScreen() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const longEnough = password.length >= 6;
  const matches = confirm.length > 0 && password === confirm;
  const canSave = token.trim().length > 0 && longEnough && matches && !saving;
  const mismatch = confirm.length > 0 && password !== confirm;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await getCompanionClient().resetPassword(token.trim(), password);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить пароль');
    } finally {
      setSaving(false);
    }
  }

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/auth-login'));

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Кнопка «назад» — только у формы: после сохранения позади лишь она сама. */}
      <View className="flex-row items-center gap-1 px-6 pt-6">
        {!saved && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Назад"
            onPress={goBack}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            className="-ml-5 h-12 w-12 items-center justify-center rounded-full">
            <ChevronLeftIcon size={24} />
          </Pressable>
        )}
        <AnoonLogo size={20} />
      </View>

      {saved ? (
        <ScrollView contentContainerClassName="items-center px-6 pt-16 pb-6">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-online/15">
            <CheckIcon size={40} color={ONLINE} />
          </View>
          <Text className="mt-6 text-2xl font-bold text-foreground">Пароль сохранён</Text>
          <Text className="mt-2 max-w-[288px] text-center text-sm text-muted-foreground">
            Теперь вы можете войти в аккаунт с новым паролем.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/auth-login')}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            className="mt-8 w-full items-center rounded-xl bg-primary py-3.5">
            <Text className="text-base font-semibold text-primary-foreground">Войти</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView contentContainerClassName="px-6 pt-8 pb-6" keyboardShouldPersistTaps="handled">
          <Text className="text-2xl font-bold text-foreground">Новый пароль</Text>
          <Text className="mt-2 text-sm text-muted-foreground">
            Придумайте новый пароль для входа в аккаунт.
          </Text>

          <View className="mt-7 gap-3">
            <View>
              <Text className="mb-1.5 text-xs text-muted-foreground">Код из письма</Text>
              <TextInput
                placeholder="Вставьте код из письма"
                placeholderTextColor="#9a9aa0"
                value={token}
                onChangeText={setToken}
                autoCapitalize="none"
                autoCorrect={false}
                className="rounded-xl bg-muted px-4 py-3 text-base text-foreground"
              />
            </View>

            <View>
              <Text className="mb-1.5 text-xs text-muted-foreground">Новый пароль</Text>
              <View className="flex-row items-center gap-2 rounded-xl bg-muted px-4">
                <TextInput
                  placeholder="Минимум 6 символов"
                  placeholderTextColor="#9a9aa0"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="newPassword"
                  className="min-w-0 flex-1 py-3 text-base text-foreground"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  onPress={() => setShowPassword((v) => !v)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </Pressable>
              </View>
            </View>

            <View>
              <Text className="mb-1.5 text-xs text-muted-foreground">Повторите пароль</Text>
              <View
                className={`flex-row items-center gap-2 rounded-xl border bg-muted px-4 ${
                  mismatch ? 'border-destructive' : 'border-transparent'
                }`}>
                <TextInput
                  placeholder="Ещё раз"
                  placeholderTextColor="#9a9aa0"
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="min-w-0 flex-1 py-3 text-base text-foreground"
                />
              </View>
              {mismatch ? <Text className="mt-1.5 text-xs text-destructive">Пароли не совпадают</Text> : null}
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={!canSave}
            onPress={() => void handleSave()}
            style={({ pressed }) => ({ opacity: canSave ? (pressed ? 0.85 : 1) : 0.5 })}
            className="mt-6 items-center rounded-xl bg-primary py-3.5">
            <Text className="text-base font-semibold text-primary-foreground">
              {saving ? 'Сохранение…' : 'Сохранить пароль'}
            </Text>
          </Pressable>

          {error ? <Text className="mt-3 text-center text-sm text-destructive">{error}</Text> : null}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
