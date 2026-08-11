import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AnoonButton, AnoonInput, AnoonLogo, AnoonNotice } from '@/components/shared';
import { googleDisabledReason, promptGoogleIdToken } from '@/lib/google-auth';
import { useAnoonStore } from '@/store';
import { NeedsGenderError } from '@/store/slices';

/** Логотип Google — локальный, как принято для одноразовых иконок. */
const GoogleGlyph = ({ size = 20 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      fill="#4285F4"
      d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.64v3.02h3.88c2.27-2.09 3.54-5.17 3.54-8.9z"
    />
    <Path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.95-2.91l-3.88-3.02c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.12A11.99 11.99 0 0 0 12 24z"
    />
    <Path
      fill="#FBBC05"
      d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54V6.61H1.29a12 12 0 0 0 0 10.78l3.98-3.12z"
    />
    <Path
      fill="#EA4335"
      d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.61l4.01 3.12C6.22 6.88 8.87 4.77 12 4.77z"
    />
  </Svg>
);

/**
 * Вход (`AnoonLogin.tsx`). Логика — та же из общего стора: `signInWithBasic`
 * логинит СУЩЕСТВУЮЩИЙ Tinode-аккаунт (isNew:false), тянет профиль из
 * companion, отдаёт токен и поднимает события.
 *
 * Вход через Google идёт не через браузерный GIS, как на вебе, а через
 * `@/lib/google-auth` — системный браузер и PKCE. Токен на выходе тот же самый,
 * поэтому дальше работает тот же `signInWithGoogle` из общего стора: первый вход
 * поднимает `NeedsGenderError`, и человек уходит на экран выбора пола, где
 * `pendingGoogleToken` уже ждёт. Без client id в сборке кнопка видимо выключена
 * и показывает причину — как на вебе без `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
 */
export default function LoginScreen() {
  const signInWithBasic = useAnoonStore((s) => s.signInWithBasic);
  const signInWithGoogle = useAnoonStore((s) => s.signInWithGoogle);
  const authError = useAnoonStore((s) => s.authError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  // Своя строка ошибки: падение самого Google-флоу до companion не доходит,
  // поэтому в `authError` из стора его не будет.
  const [googleError, setGoogleError] = useState<string | null>(null);
  const googleOff = googleDisabledReason();

  // Tinode-логин «basic» — это обычный юзернейм (без @ и точек), поэтому
  // принимаем и почту, и голый ник от 3 символов: значение уходит как есть.
  const emailValid = /\S+@\S+\.\S+/.test(email) || /^[a-z0-9_.\-]{3,}$/i.test(email.trim());
  const canSubmit = emailValid && password.length >= 6 && !submitting;

  /**
   * Вернувшийся пользователь попадает сразу в приложение. Первый вход требует
   * пола — это отдельный экран: выбор необратим, и задавать его карточкой под
   * рядом провайдеров значило бы создавать аккаунт прямо в форме входа.
   */
  const handleGoogle = async () => {
    setGoogleBusy(true);
    setGoogleError(null);
    try {
      const idToken = await promptGoogleIdToken();
      if (!idToken) return; // окно закрыли — молча
      await signInWithGoogle(idToken);
      router.replace('/(tabs)/chats');
    } catch (err) {
      if (err instanceof NeedsGenderError) {
        router.push('/auth-gender');
        return;
      }
      // Ошибки companion уже в authError; сюда попадает всё до него.
      setGoogleError(err instanceof Error ? err.message : 'Не удалось войти через Google');
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleLogin = async () => {
    setSubmitting(true);
    try {
      await signInWithBasic({ email, password, isNew: false });
      router.replace('/(tabs)/chats');
    } catch {
      // authError показан ниже.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerClassName="grow px-6 pb-8" keyboardShouldPersistTaps="handled">
        <View className="mt-12 items-center">
          <View className="h-16 w-16 items-center justify-center rounded-2xl bg-primary">
            <Text className="text-3xl font-bold text-primary-foreground">a</Text>
          </View>
          <Text className="mt-5 text-2xl font-bold text-foreground">Добро пожаловать в Anoon</Text>
          <Text className="mt-1 text-sm text-muted-foreground">Войдите, чтобы продолжить</Text>
        </View>

        <View className="mt-8 gap-3">
          <AnoonInput
            placeholder="Почта или ник"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
          />
          <AnoonInput
            placeholder="Пароль"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            textContentType="password"
            onSubmitEditing={() => canSubmit && void handleLogin()}
          />

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/auth-forgot-password')}
            className="self-end py-1">
            <Text className="text-sm font-medium text-primary">Забыли пароль?</Text>
          </Pressable>

          <AnoonButton
            label="Войти"
            loading={submitting}
            disabled={!canSubmit}
            onPress={() => void handleLogin()}
            className="mt-1"
          />

          <AnoonNotice message={authError} />
        </View>

        <View className="mt-7 flex-row items-center gap-3">
          <View className="h-px flex-1 bg-border" />
          <Text className="text-xs text-muted-foreground">или продолжить с</Text>
          <View className="h-px flex-1 bg-border" />
        </View>

        {/* Google работает, если в сборке есть client id под эту платформу;
            Apple и Facebook не заведены и на бэкенде, поэтому честно выключены. */}
        <View className="mt-4 flex-row items-center justify-center gap-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={googleOff ?? 'Войти через Google'}
            accessibilityState={{ disabled: !!googleOff || googleBusy || submitting }}
            disabled={!!googleOff || googleBusy || submitting}
            onPress={() => void handleGoogle()}
            style={({ pressed }) => ({
              opacity: googleOff || googleBusy || submitting ? 0.5 : pressed ? 0.85 : 1,
            })}
            className="h-12 w-12 items-center justify-center rounded-full border border-border bg-card">
            <GoogleGlyph />
          </Pressable>
          {['Apple', 'Facebook'].map((name) => (
            <View
              key={name}
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              accessibilityLabel={`Войти через ${name} — скоро`}
              className="h-12 w-12 items-center justify-center rounded-full border border-border opacity-50">
              <Text className="text-base font-semibold text-muted-foreground">{name[0]}</Text>
            </View>
          ))}
        </View>
        <Text className="mt-2 text-center text-[11px] text-muted-foreground">
          {googleOff ?? 'Apple и Facebook — скоро'}
        </Text>
        {googleError ? (
          <View className="mt-3">
            <AnoonNotice message={googleError} />
          </View>
        ) : null}

        <View className="mt-auto pt-8">
          <View className="flex-row items-center justify-center gap-1.5">
            <Text className="text-sm text-muted-foreground">Нет аккаунта?</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push('/auth-register')}>
              <Text className="text-sm font-medium text-primary">Зарегистрироваться</Text>
            </Pressable>
          </View>
          <Text className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">
            Продолжая, вы подтверждаете, что вам 18+ и принимаете условия использования.
          </Text>
          <View className="mt-6 items-center">
            <AnoonLogo size={18} />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
