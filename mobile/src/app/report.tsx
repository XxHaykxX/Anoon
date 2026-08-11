import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { CheckIcon, CloseIcon } from '@/components/icons';
import { getCompanionClient, type ReportCategory } from '@/lib/companion';
import { useAnoonStore } from '@/store';

/** Причины жалобы, каждая — со своей категорией для бэкенда. */
const REASONS: { label: string; category: ReportCategory }[] = [
  { label: 'Спам / реклама', category: 'spam' },
  { label: 'Оскорбления / травля', category: 'abuse' },
  { label: 'Непристойный контент', category: 'sexual' },
  { label: 'Подозрение на несовершеннолетнего', category: 'illegal' },
  { label: 'Мошенничество', category: 'illegal' },
  { label: 'Другое', category: 'other' },
];

/**
 * Жалоба (`AnoonReport.tsx`). На вебе это шторка поверх чата; здесь — отдельный
 * маршрут, поэтому «закрыть» = `router.back()`, а состояния «шторка закрыта, но
 * экран жив» нет: закрывать нечего, экран просто уходит.
 */
export default function ReportScreen() {
  const [reason, setReason] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  // На кого жалоба: активный матч рулетки, иначе открытый приватный чат. Именно
  // так, целиком, а не по полям через `??`: у нераскрытого пира вообще нет #ID,
  // и пофайловый фолбэк молча подставил бы #ID открытого чата — жалоба ушла бы
  // на другого человека.
  const activeMatch = useAnoonStore((s) => s.activeMatch);
  const activeChat = useAnoonStore((s) => s.activeChat);
  const target = activeMatch
    ? {
        hashId: activeMatch.peerHashId,
        topic: activeMatch.topic,
        name:
          activeMatch.peerDisplayName ??
          (activeMatch.peerAlias ? `Собеседник ${activeMatch.peerAlias}` : undefined),
      }
    : { hashId: activeChat?.hashId, topic: activeChat?.topic, name: activeChat?.displayName };

  const peerHashId = (target.hashId ?? '').replace(/^#/, '');
  const peerLabel = target.name ?? (peerHashId ? `Собеседник #${peerHashId}` : 'Собеседник');

  // Ждём ответ, а не «отправил и забыл»: экран успеха обязан означать, что
  // жалоба реально принята. Тот, кто уверен, что пожаловался, второй раз
  // жаловаться не станет — и модерация не узнает ничего.
  const handleSend = async () => {
    if (!reason || sending) return;
    const category = REASONS.find((r) => r.label === reason)?.category ?? 'other';
    setSending(true);
    setFailed(false);
    try {
      await getCompanionClient().report({
        reportedHashId: peerHashId || undefined,
        category,
        topic: target.topic,
        details: comment.trim() || undefined,
      });
      setSent(true);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background px-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary">
          <CheckIcon size={32} color="#000000" />
        </View>
        <Text className="text-lg font-bold text-foreground">Спасибо, жалоба отправлена</Text>
        <Text className="max-w-[16rem] text-center text-sm text-muted-foreground">
          Мы рассмотрим обращение и примем меры, если правила были нарушены.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          className="mt-2 rounded-full bg-primary px-6 py-2.5">
          <Text className="text-sm font-semibold text-primary-foreground">Готово</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Контекст чата, поверх которого на вебе лежит шторка. */}
      <View className="border-b border-border px-5 pb-4 pt-14 opacity-40">
        <Text className="font-semibold text-foreground">{peerLabel}</Text>
        <Text className="text-xs text-muted-foreground">был(а) недавно</Text>
      </View>

      <View className="flex-1 justify-end">
        <View className="max-h-[92%] rounded-t-3xl bg-card">
          <View className="flex-row items-center justify-between px-5 pb-3 pt-4">
            <Text className="text-lg font-bold text-foreground">Пожаловаться</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              onPress={() => router.back()}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <CloseIcon size={20} color="#9a9aa0" />
            </Pressable>
          </View>

          <ScrollView className="px-5" contentContainerClassName="pb-6" keyboardShouldPersistTaps="handled">
            <Text className="pb-2 text-sm text-muted-foreground">Выберите причину</Text>
            <View className="gap-2">
              {REASONS.map((r) => {
                const selected = reason === r.label;
                return (
                  <Pressable
                    key={r.label}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => setReason(r.label)}
                    style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                    className={`w-full flex-row items-center gap-3 rounded-2xl border px-4 py-3 ${
                      selected ? 'border-primary bg-primary/10' : 'border-border bg-background'
                    }`}>
                    <View
                      className={`h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        selected ? 'border-primary' : 'border-muted-foreground/40'
                      }`}>
                      {selected ? <View className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
                    </View>
                    <Text className="text-sm font-medium text-foreground">{r.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text className="pb-2 pt-4 text-sm text-muted-foreground">Комментарий (необязательно)</Text>
            <TextInput
              value={comment}
              onChangeText={setComment}
              multiline
              numberOfLines={3}
              placeholder="Опишите, что произошло…"
              placeholderTextColor="#9a9aa0"
              className="min-h-[88px] w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
              textAlignVertical="top"
            />

            {/* Провал назван прямо, причина и комментарий остаются на месте:
                «Отправить ещё раз» — одно нажатие, перепечатывать нечего. */}
            {failed ? (
              <View className="mt-4 rounded-2xl bg-destructive/10 px-4 py-3">
                <Text className="text-sm text-destructive">
                  Не удалось отправить жалобу. Проверьте соединение и попробуйте ещё раз.
                </Text>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !reason || sending }}
              disabled={!reason || sending}
              onPress={() => void handleSend()}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              className={`mt-4 w-full items-center rounded-full py-3.5 ${
                reason && !sending ? 'bg-primary' : 'bg-muted'
              }`}>
              <Text
                className={`text-sm font-semibold ${
                  reason && !sending ? 'text-primary-foreground' : 'text-muted-foreground'
                }`}>
                {sending ? 'Отправляем…' : failed ? 'Отправить ещё раз' : 'Отправить'}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
