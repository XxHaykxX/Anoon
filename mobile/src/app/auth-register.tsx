import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { ChevronLeftIcon, type IconProps } from '@/components/icons';
import { AnoonLogo } from '@/components/shared';
import { useAnoonStore } from '@/store';

// Локальные иконки экрана — как на вебе, где они лежат в файле компонента,
// а не в общем `icons.tsx`.
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

type Gender = 'male' | 'female' | null;

/**
 * Регистрация (`AnoonRegister.tsx`). Создаёт Tinode-аккаунт через общий стор
 * (`signInWithBasic` с `isNew: true`) и уводит на «Чаты».
 *
 * Мок-ветки (`!USE_TINODE` → экран подтверждения почты) здесь нет: нативный
 * адаптер платформы жёстко задаёт `useTinode: true`, мока на телефоне не бывает,
 * и ветка была бы мёртвым кодом.
 *
 * Поля ввода написаны здесь, а не через `AnoonInput`: у пароля внутри рамки
 * живёт кнопка-глаз, а у общего компонента нет слота под неё.
 */
export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<Gender>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const signInWithBasic = useAnoonStore((s) => s.signInWithBasic);
  const authError = useAnoonStore((s) => s.authError);

  // Какие поля не заполнены — и что именно про них сказать. Пустая форма сама
  // по себе не объясняет, чего от человека хотят.
  const [showErrors, setShowErrors] = useState(false);
  const ageNum = Number(age);
  const ageValid = Number.isInteger(ageNum) && ageNum >= 18 && ageNum <= 100;
  const emailValid = /\S+@\S+\.\S+/.test(email);
  const errors = {
    email: emailValid ? null : 'Введите почту в виде you@example.com',
    password: password.length >= 6 ? null : 'Пароль от 6 символов',
    name: name.trim().length > 0 ? null : 'Введите имя',
    age: ageValid ? null : 'Возраст от 18 до 100',
    gender: gender ? null : 'Выберите пол',
  };
  const complete = !Object.values(errors).some(Boolean);
  const canSubmit = complete && !submitting;

  const errorFor = (key: keyof typeof errors) =>
    showErrors && errors[key] ? (
      <Text accessibilityRole="alert" className="mt-1 text-xs text-destructive">
        {errors[key]}
      </Text>
    ) : null;

  /** Рамка поля краснеет ровно тогда же, когда появляется его сообщение. */
  const fieldBorder = (key: keyof typeof errors) =>
    showErrors && errors[key] ? 'border-destructive' : 'border-transparent';

  const handleSubmit = async () => {
    // Кнопка остаётся живой при неполной форме — мёртвая ничего не объясняет.
    if (!complete) {
      setShowErrors(true);
      return;
    }
    setSubmitting(true);
    try {
      await signInWithBasic({
        email,
        password,
        isNew: true,
        displayName: name.trim(),
        gender: gender ?? undefined,
        age: ageNum,
      });
      router.replace('/(tabs)/chats');
    } catch {
      // authError показан ниже.
    } finally {
      setSubmitting(false);
    }
  };

  // Экран открывается и по прямой ссылке, когда возвращаться некуда.
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

      <ScrollView contentContainerClassName="px-6 pb-6" keyboardShouldPersistTaps="handled">
        <Text className="mt-5 text-2xl font-bold text-foreground">Регистрация</Text>
        <Text className="mt-1 text-sm text-muted-foreground">Создайте аккаунт по email</Text>

        <View className="mt-7 gap-3">
          <View>
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
              className={`rounded-xl border bg-muted px-4 py-3 text-base text-foreground ${fieldBorder('email')}`}
            />
            {errorFor('email')}
          </View>

          <View>
            <Text className="mb-1.5 text-xs text-muted-foreground">Пароль</Text>
            <View
              className={`flex-row items-center gap-2 rounded-xl border bg-muted px-4 ${fieldBorder('password')}`}>
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
            {errorFor('password')}
          </View>

          <View>
            <Text className="mb-1.5 text-xs text-muted-foreground">Имя</Text>
            <TextInput
              placeholder="Как вас зовут"
              placeholderTextColor="#9a9aa0"
              value={name}
              onChangeText={setName}
              className={`rounded-xl border bg-muted px-4 py-3 text-base text-foreground ${fieldBorder('name')}`}
            />
            {errorFor('name')}
          </View>

          <View>
            <Text className="mb-1.5 text-xs text-muted-foreground">Возраст</Text>
            <TextInput
              placeholder="18+"
              placeholderTextColor="#9a9aa0"
              value={age}
              onChangeText={setAge}
              keyboardType="number-pad"
              className={`rounded-xl border bg-muted px-4 py-3 text-base text-foreground ${fieldBorder('age')}`}
            />
            {errorFor('age')}
          </View>

          <View>
            <Text className="mb-1.5 text-xs text-muted-foreground">Пол</Text>
            <View className={`flex-row gap-2 rounded-xl border bg-muted p-1 ${fieldBorder('gender')}`}>
              {(
                [
                  { id: 'male', label: 'Мужчина' },
                  { id: 'female', label: 'Женщина' },
                ] as const
              ).map((g) => {
                const active = gender === g.id;
                return (
                  <Pressable
                    key={g.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setGender(g.id)}
                    style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                    className={`flex-1 items-center rounded-lg py-2.5 ${active ? 'bg-primary' : ''}`}>
                    <Text
                      className={`text-sm font-medium ${active ? 'text-primary-foreground' : 'text-muted-foreground'}`}>
                      {g.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {errorFor('gender')}
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          // Блокирует только запрос в полёте: неполная форма оставляет кнопку
          // живой, чтобы нажатие показало, чего не хватает.
          disabled={submitting}
          onPress={() => void handleSubmit()}
          style={({ pressed }) => ({ opacity: canSubmit ? (pressed ? 0.85 : 1) : 0.5 })}
          className="mt-7 items-center rounded-xl bg-primary py-3.5">
          <Text className="text-base font-semibold text-primary-foreground">
            {submitting ? 'Создаём аккаунт…' : 'Зарегистрироваться'}
          </Text>
        </Pressable>

        {authError ? <Text className="mt-3 text-center text-sm text-destructive">{authError}</Text> : null}

        <View className="mt-4 flex-row items-center justify-center gap-1.5">
          <Text className="text-sm text-muted-foreground">Уже есть аккаунт?</Text>
          <Pressable accessibilityRole="button" onPress={goBack}>
            <Text className="text-sm font-medium text-primary">Войти</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
