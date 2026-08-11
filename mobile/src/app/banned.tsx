import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChevronLeftIcon, LockIcon, ShieldIcon } from '@/components/icons';

/** Экран блокировки (`AnoonBanned.tsx`). Чистая презентация, логики нет. */
export default function BannedScreen() {
  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-background px-8" edges={['top', 'bottom']}>
      {/* Выход «назад» — в настоящем бане идти пользователю некуда. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Назад"
        onPress={() => router.back()}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        className="absolute left-1 top-2 h-12 w-12 items-center justify-center rounded-full">
        <ChevronLeftIcon size={24} />
      </Pressable>

      <View className="mb-7">
        <View className="h-28 w-28 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10">
          <ShieldIcon size={56} color="#ff453a" />
        </View>
        <View className="absolute -bottom-1 -right-1 h-11 w-11 items-center justify-center rounded-full border-4 border-background bg-destructive">
          <LockIcon size={20} />
        </View>
      </View>

      <Text className="text-2xl font-bold text-foreground">Доступ заблокирован</Text>

      <Text className="mt-3 max-w-[18rem] text-center text-sm leading-relaxed text-muted-foreground">
        Ваш аккаунт заблокирован администрацией за нарушение правил сообщества. Чат и поиск
        собеседников больше недоступны.
      </Text>

      <View className="mt-8 w-full max-w-[19rem] gap-2.5">
        <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <LockIcon size={20} color="#9a9aa0" />
          <Text className="text-sm text-muted-foreground">Отправка сообщений недоступна</Text>
        </View>
        <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <LockIcon size={20} color="#9a9aa0" />
          <Text className="text-sm text-muted-foreground">Поиск собеседников недоступен</Text>
        </View>
      </View>

      <Text className="mt-8 max-w-[18rem] text-center text-xs text-muted-foreground/70">
        Если вы считаете, что произошла ошибка, обратитесь в поддержку.
      </Text>
    </SafeAreaView>
  );
}
