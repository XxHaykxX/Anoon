import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { CheckIcon, ChevronLeftIcon } from '@/components/icons';
import { AnoonLogo } from '@/components/shared';
import { getCompanionClient } from '@/lib/companion';

/** Токен `--color-online`: иконке его не достать через className. */
const ONLINE = '#32d74b';

/**
 * Восстановление пароля (`AnoonForgotPassword.tsx`): почта → письмо со ссылкой.
 *
 * Отправка писем на бэкенде пока заглушена — ответ `{queued: true}` значит лишь,
 * что запрос дошёл. Экран всё равно показывает обычное «проверьте почту»:
 * ждать по эту сторону границы больше нечего.
 */
export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = /\S+@\S+\.\S+/.test(email);

  async function handleSend() {
    if (!emailValid || sending) return;
    setSending(true);
    setError(null);
    try {
      await getCompanionClient().requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить письмо');
    } finally {
      setSending(false);
    }
  }

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/auth-login'));

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View className="flex-row items-center gap-1 px-6 pt-6">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Назад"
          onPress={goBack}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          className="-ml-5 h-12 w-12 items-center justify-center rounded-full">
          <ChevronLeftIcon size={24} />
        </Pressable>
        <AnoonLogo size={20} />
      </View>

      {sent ? (
        <ScrollView contentContainerClassName="items-center px-6 pt-16 pb-6" keyboardShouldPersistTaps="handled">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-online/15">
            <CheckIcon size={40} color={ONLINE} />
          </View>
          <Text className="mt-6 text-2xl font-bold text-foreground">Ссылка отправлена</Text>
          <Text className="mt-2 max-w-[288px] text-center text-sm text-muted-foreground">
            Мы отправили ссылку для восстановления пароля на
          </Text>
          <Text className="mt-1 font-medium text-foreground">{email}</Text>
          <Text className="mt-4 max-w-[288px] text-center text-xs text-muted-foreground">
            Перейдите по ссылке из письма, чтобы задать новый пароль. Проверьте папку «Спам», если письма нет.
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/auth-reset-password')}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            className="mt-8 w-full items-center rounded-xl bg-primary py-3.5">
            <Text className="text-base font-semibold text-primary-foreground">Ввести новый пароль</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setSent(false)}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            className="mt-3 w-full items-center rounded-xl border border-border bg-card py-3.5">
            <Text className="text-base font-medium text-foreground">Отправить снова</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView contentContainerClassName="px-6 pt-8 pb-6" keyboardShouldPersistTaps="handled">
          <Text className="text-2xl font-bold text-foreground">Восстановление пароля</Text>
          <Text className="mt-2 text-sm text-muted-foreground">
            Введите почту от аккаунта — мы пришлём ссылку для сброса пароля.
          </Text>

          <View className="mt-7">
            <Text className="mb-1.5 text-xs text-muted-foreground">Почта</Text>
            <TextInput
              placeholder="you@example.com"
              placeholderTextColor="#9a9aa0"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              onSubmitEditing={() => void handleSend()}
              className="rounded-xl bg-muted px-4 py-3 text-base text-foreground"
            />
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={!emailValid || sending}
            onPress={() => void handleSend()}
            style={({ pressed }) => ({
              opacity: emailValid && !sending ? (pressed ? 0.85 : 1) : 0.5,
            })}
            className="mt-6 items-center rounded-xl bg-primary py-3.5">
            <Text className="text-base font-semibold text-primary-foreground">
              {sending ? 'Отправка…' : 'Отправить ссылку'}
            </Text>
          </Pressable>

          {error ? <Text className="mt-3 text-center text-sm text-destructive">{error}</Text> : null}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
