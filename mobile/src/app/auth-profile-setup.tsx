import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { CameraIcon, PlusIcon } from '@/components/icons';
import { AnoonAvatar, AnoonLogo, AnoonNotice } from '@/components/shared';

const AGE_RANGES = ['18–21', '22–25', '26–35', '36+'] as const;

/**
 * Заполнение профиля (`AnoonProfileSetup.tsx`). Как и на вебе, экран пока
 * ничего не сохраняет: данные живут в локальном состоянии, «Готово» просто
 * уводит на главную. Появится запись в стор — менять надо будет оба экрана.
 *
 * Фото выбирается через expo-image-picker вместо `<input type=file>`; на вебе
 * кнопка вообще только притворялась, что фото есть.
 */
export default function ProfileSetupScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [ageRange, setAgeRange] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const canFinish = firstName.trim().length > 0;

  const handlePhoto = async () => {
    // Повторное нажатие по уже выбранному фото убирает его — как тумблер на вебе.
    if (photoUri) {
      setPhotoUri(null);
      return;
    }
    setPickError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPickError('Нет доступа к галерее. Разрешите его в настройках телефона.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  };

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View className="px-6 pt-6">
        <AnoonLogo size={20} />
      </View>

      <ScrollView contentContainerClassName="px-6 pb-6" keyboardShouldPersistTaps="handled">
        <Text className="mt-5 text-2xl font-bold text-foreground">Заполните профиль</Text>
        <Text className="mt-1 text-sm text-muted-foreground">Всё, кроме имени, можно пропустить.</Text>

        <View className="mt-7 items-center">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={photoUri ? 'Убрать фото' : 'Добавить фото'}
            onPress={() => void handlePhoto()}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
            {photoUri ? (
              <AnoonAvatar
                initials={(firstName.trim()[0] ?? 'A').toUpperCase()}
                tone={3}
                size={96}
                photoUrl={photoUri}
              />
            ) : (
              <View className="h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-border bg-card">
                <CameraIcon size={32} color="#9a9aa0" />
              </View>
            )}
            {/* Вместо `ring-4 ring-background` — рамка цвета фона: колец в RN нет. */}
            <View className="absolute bottom-0 right-0 h-8 w-8 items-center justify-center rounded-full border-4 border-background bg-primary">
              <PlusIcon size={16} color="#000000" />
            </View>
          </Pressable>
          <Text className="mt-2 text-xs text-muted-foreground">
            {photoUri ? 'Фото добавлено' : 'Добавить фото · необязательно'}
          </Text>
          <View className="mt-2 w-full">
            <AnoonNotice message={pickError} />
          </View>
        </View>

        <View className="mt-8 gap-3">
          <View>
            <Text className="mb-1.5 text-xs text-muted-foreground">Имя</Text>
            <TextInput
              placeholder="Ваше имя"
              placeholderTextColor="#9a9aa0"
              value={firstName}
              onChangeText={setFirstName}
              className="rounded-xl bg-muted px-4 py-3 text-base text-foreground"
            />
          </View>

          <View>
            <Text className="mb-1.5 text-xs text-muted-foreground">Фамилия · необязательно</Text>
            <TextInput
              placeholder="Ваша фамилия"
              placeholderTextColor="#9a9aa0"
              value={lastName}
              onChangeText={setLastName}
              className="rounded-xl bg-muted px-4 py-3 text-base text-foreground"
            />
          </View>

          <View>
            <Text className="mb-1.5 text-xs text-muted-foreground">Возраст · необязательно</Text>
            <View className="flex-row gap-2">
              {AGE_RANGES.map((r) => {
                const active = ageRange === r;
                return (
                  <Pressable
                    key={r}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setAgeRange(active ? null : r)}
                    style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                    className={`flex-1 items-center rounded-xl py-2.5 ${active ? 'bg-primary' : 'bg-muted'}`}>
                    <Text
                      className={`text-sm font-medium ${active ? 'text-primary-foreground' : 'text-muted-foreground'}`}>
                      {r}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </ScrollView>

      <View className="border-t border-border px-6 py-4">
        <Pressable
          accessibilityRole="button"
          disabled={!canFinish}
          onPress={() => router.replace('/(tabs)/home')}
          style={({ pressed }) => ({ opacity: canFinish ? (pressed ? 0.85 : 1) : 0.5 })}
          className="items-center rounded-xl bg-primary py-3.5">
          <Text className="text-base font-semibold text-primary-foreground">Готово</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
