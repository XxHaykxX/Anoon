import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { ChevronLeftIcon, type IconProps } from '@/components/icons';
import { AnoonLogo } from '@/components/shared';
import { CompanionHttpError, getCompanionClient } from '@/lib/companion';

const EnvelopeIcon = ({ size = 40, color = '#fdbf2d' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <Rect x="2" y="4" width="20" height="16" rx="3" />
    <Path d="m3 7 9 6 9-6" />
  </Svg>
);

/**
 * Подтверждение почты (`AnoonVerifyEmail.tsx`): таймер до повторной отправки,
 * ручной ввод кода из письма (SMTP на бэкенде заглушён, кликать в почте нечего).
 *
 * Отличие от веба: адрес берётся из параметра маршрута — у expo-router он есть,
 * а вебовский стек экранов полезной нагрузки не носит и показывал заглушку.
 *
 * На телефоне экран пока никто не открывает: регистрация в реальном режиме ведёт
 * сразу в «Чаты», а мок-режима на нативе нет. Портирован ради полноты набора.
 */
export default function VerifyEmailScreen() {
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const email = emailParam || 'you@example.com';
  const [seconds, setSeconds] = useState(60);
  const [resends, setResends] = useState(0);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [token, setToken] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const canResend = seconds <= 0 && !resending;

  async function handleResend() {
    if (!canResend) return;
    setResending(true);
    setResendError(null);
    try {
      await getCompanionClient().requestEmailVerify();
      setResends((r) => r + 1);
      setSeconds(60);
    } catch (err) {
      setResendError(err instanceof Error ? err.message : 'Не удалось отправить письмо');
    } finally {
      setResending(false);
    }
  }

  async function handleConfirm() {
    if (!token.trim() || confirming) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      await getCompanionClient().confirmEmailVerify(token.trim());
      // `replace`, не `push`: токен потрачен, возвращаться сюда бессмысленно.
      router.replace('/auth-gender');
    } catch (err) {
      // 409 `email_changed`: адрес сменили после отправки письма, токен мёртв —
      // повторный ввод не поможет. Сразу освобождаем кнопку «отправить снова».
      if (err instanceof CompanionHttpError && err.status === 409) {
        setConfirmError('Адрес почты изменился — эта ссылка больше не действует. Запросите новое письмо.');
        setSeconds(0);
      } else if (err instanceof CompanionHttpError) {
        // Иначе сырое сообщение вида «companion /auth/…: 400» — не для человека.
        setConfirmError('Неверный или истёкший код');
      } else {
        setConfirmError(err instanceof Error ? err.message : 'Неверный или истёкший код');
      }
    } finally {
      setConfirming(false);
    }
  }

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/auth-register'));

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

      <ScrollView contentContainerClassName="grow items-center px-6 pt-10 pb-6" keyboardShouldPersistTaps="handled">
        <View className="h-20 w-20 items-center justify-center rounded-full bg-primary/15">
          <EnvelopeIcon />
        </View>

        <Text className="mt-6 text-2xl font-bold text-foreground">Подтвердите почту</Text>
        <Text className="mt-2 max-w-[288px] text-center text-sm text-muted-foreground">
          Мы отправили письмо со ссылкой для подтверждения на адрес
        </Text>
        <Text className="mt-1 font-medium text-foreground">{email}</Text>
        <Text className="mt-4 max-w-[288px] text-center text-xs text-muted-foreground">
          Перейдите по ссылке из письма, чтобы завершить регистрацию. Не забудьте проверить папку «Спам».
        </Text>

        <Pressable
          accessibilityRole="button"
          disabled={!canResend}
          onPress={() => void handleResend()}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          className={`mt-8 w-full items-center rounded-xl py-3.5 ${canResend ? 'bg-primary' : 'bg-muted'}`}>
          <Text className={`text-base font-semibold ${canResend ? 'text-primary-foreground' : 'text-muted-foreground'}`}>
            {resending ? 'Отправка…' : canResend ? 'Отправить снова' : `Отправить снова через ${seconds} с`}
          </Text>
        </Pressable>

        {resendError ? <Text className="mt-3 text-xs text-destructive">{resendError}</Text> : null}

        {resends > 0 ? (
          <Text className="mt-4 text-xs text-online">Письмо отправлено повторно ({resends}).</Text>
        ) : null}

        <View className="mt-6 w-full">
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

        {confirmError ? <Text className="mt-2 text-xs text-destructive">{confirmError}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={!token.trim() || confirming}
          onPress={() => void handleConfirm()}
          style={({ pressed }) => ({
            opacity: !token.trim() || confirming ? 0.5 : pressed ? 0.85 : 1,
          })}
          className="mt-4 w-full items-center rounded-xl border border-border bg-card py-3.5">
          <Text className="text-base font-medium text-foreground">
            {confirming ? 'Проверка…' : 'Я подтвердил — продолжить'}
          </Text>
        </Pressable>

        <View className="mt-auto pt-6">
          <Pressable accessibilityRole="button" onPress={goBack}>
            <Text className="text-sm font-medium text-primary">Изменить почту</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
