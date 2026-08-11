import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { AnoonButton, AnoonInput, AnoonLogo, AnoonNotice } from '@/components/shared';
import { useAnoonStore } from '@/store';

/**
 * Вход (`AnoonLogin.tsx`). Логика — та же из общего стора: `signInWithBasic`
 * логинит СУЩЕСТВУЮЩИЙ Tinode-аккаунт (isNew:false), тянет профиль из
 * companion, отдаёт токен и поднимает события.
 *
 * Чего здесь нет и почему: вход через Google. На вебе он держится на
 * Google Identity Services — скрипте для браузера, которого на телефоне нет;
 * нативный флоу (expo-auth-session + свой client id под Android/iOS) — отдельная
 * задача, а не шим. Кнопка выключена честно, как на вебе без client id: нажимаемая
 * кнопка, которая ничего не делает, хуже видимо недоступной.
 */
export default function LoginScreen() {
  const signInWithBasic = useAnoonStore((s) => s.signInWithBasic);
  const authError = useAnoonStore((s) => s.authError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Tinode-логин «basic» — это обычный юзернейм (без @ и точек), поэтому
  // принимаем и почту, и голый ник от 3 символов: значение уходит как есть.
  const emailValid = /\S+@\S+\.\S+/.test(email) || /^[a-z0-9_.\-]{3,}$/i.test(email.trim());
  const canSubmit = emailValid && password.length >= 6 && !submitting;

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

        <View className="mt-4 flex-row items-center justify-center gap-4">
          {['Google', 'Apple', 'Facebook'].map((name) => (
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
        <Text className="mt-2 text-center text-[11px] text-muted-foreground">Вход через сервисы — скоро</Text>

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
