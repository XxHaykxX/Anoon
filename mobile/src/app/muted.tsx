import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChevronLeftIcon, LockIcon } from '@/components/icons';
import { AnoonAvatar } from '@/components/shared';

interface Bubble {
  id: string;
  side: 'in' | 'out';
  text: string;
  time: string;
}

const thread: Bubble[] = [
  { id: 'b1', side: 'in', text: 'Привет! Как настроение сегодня?', time: '14:02' },
  { id: 'b2', side: 'out', text: 'Привет, всё отлично, а у тебя?', time: '14:03' },
  { id: 'b3', side: 'in', text: 'Тоже хорошо. Чем занимаешься на выходных?', time: '14:03' },
  { id: 'b4', side: 'out', text: 'Планирую сходить в горы, если погода позволит', time: '14:05' },
];

/**
 * Экран мьюта (`AnoonMuted.tsx`) — демонстрационный: события «мьют» у companion
 * пока нет, экран открывается только из Настроек. Переписка тут витринная, как
 * и на вебе; менять её на живую нечем.
 */
export default function MutedScreen() {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <View className="shrink-0 border-b border-border">
        <View className="flex-row items-center gap-1 px-3 py-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Назад"
            onPress={() => router.back()}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            className="-ml-2 h-12 w-12 shrink-0 items-center justify-center rounded-full">
            <ChevronLeftIcon size={24} />
          </Pressable>
          <AnoonAvatar initials="SA" tone={4} size={40} />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="font-semibold text-foreground">
              Собеседник ~SAMPLE
            </Text>
            <Text numberOfLines={1} className="text-xs text-muted-foreground">
              был(а) недавно
            </Text>
          </View>
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="gap-2 px-4 py-4">
        {thread.map((b) => (
          <View key={b.id} className={b.side === 'out' ? 'items-end' : 'items-start'}>
            <View
              className={`max-w-[78%] rounded-2xl px-3.5 py-2 ${
                b.side === 'out' ? 'bg-bubble-out' : 'bg-bubble-in'
              }`}>
              <Text
                className={`text-sm leading-snug ${
                  b.side === 'out' ? 'text-bubble-out-foreground' : 'text-bubble-in-foreground'
                }`}>
                {b.text}
              </Text>
              <Text
                className={`mt-1 text-right text-[10px] ${
                  b.side === 'out' ? 'text-bubble-out-foreground/60' : 'text-muted-foreground'
                }`}>
                {b.time}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Вместо композера — объяснение, почему писать нельзя. */}
      <View className="shrink-0 border-t border-border">
        <View className="px-4 py-4">
          <View className="flex-row items-center justify-center gap-2.5 rounded-2xl bg-muted px-4 py-3.5">
            <LockIcon size={20} color="#9a9aa0" />
            <View className="shrink">
              <Text className="text-sm font-medium text-foreground">
                Вы не можете отправлять сообщения
              </Text>
              <Text className="text-xs text-muted-foreground">
                Чтение доступно. Ограничение наложено администратором.
              </Text>
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
