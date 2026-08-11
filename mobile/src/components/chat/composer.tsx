import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import { CloseIcon, MicIcon, PlusIcon, SendIcon, TrashIcon } from '@/components/icons';
import { copyText } from '@/lib/clipboard';
import { uploadFile, type MediaKind, type UploadedMedia } from '@/lib/tinode';

import { CHAT_COLORS, CopyIcon, EditIcon, ReplyIcon } from './icons';
import type { ChatRow } from './thread';

/** Быстрые реакции — тот же набор и порядок, что в `ReactionBar` на вебе. */
const QUICK_EMOJIS = ['\u{1F44D}', '❤️', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F525}'];

/**
 * Выбрать фото/видео в галерее и загрузить на Tinode. Возвращает всё, что
 * нужно `sendAnonMedia`/`sendFriendMedia`, или `null`, если пользователь
 * отменил выбор либо не дал доступ.
 *
 * Камеры здесь нет намеренно: `expo-camera` не установлен, а
 * `launchCameraAsync` из image-picker — это ещё одно разрешение и отдельная
 * ветка обработки; галереи хватает, чтобы отправка медиа работала.
 */
export async function pickAndUpload(): Promise<{
  up: UploadedMedia;
  kind: MediaKind;
  extra: { width?: number; height?: number; duration?: number };
} | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    quality: 0.8,
  });
  if (res.canceled || !res.assets[0]) return null;

  const asset = res.assets[0];
  const kind: MediaKind = asset.type === 'video' ? 'video' : 'image';
  const mime = asset.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg');
  const name = asset.fileName ?? `${kind}-${Date.now()}.${kind === 'video' ? 'mp4' : 'jpg'}`;
  // Tinode-загрузчик умеет File | Blob; у телефона есть только `file://`-путь,
  // поэтому читаем его в Blob — единственный способ отдать байты, не трогая
  // общий `lib/tinode.ts`.
  const blob = await (await fetch(asset.uri)).blob();
  const up = await uploadFile(blob, name, mime);
  return {
    up,
    kind,
    extra: {
      width: asset.width,
      height: asset.height,
      // expo-image-picker отдаёт длительность в миллисекундах, Drafty ждёт секунды.
      duration: asset.duration ? Math.round(asset.duration / 1000) : undefined,
    },
  };
}

/** Записанное голосовое: путь к файлу на устройстве и его длительность. */
export interface RecordedVoice {
  uri: string;
  /** Целые секунды — ровно то, что Drafty кладёт в `duration` (см. `buildMediaDraft`). */
  sec: number;
}

/**
 * Загрузить записанное голосовое на Tinode — тем же `uploadFile`, что и фото с
 * видео, чтобы формат и путь совпадали с вебом.
 *
 * `RecordingPresets.HIGH_QUALITY` пишет `.m4a`/AAC на обеих системах — это тот
 * же контейнер, что отдаёт `MediaRecorder` в Safari (`audio/mp4`), так что
 * записанное на телефоне открывается в вебе и в админке, а записанное в вебе —
 * на телефоне. Расширение читаем у самого файла, а не подставляем: врать про
 * mime — значит сломать воспроизведение у получателя.
 */
export async function uploadVoice(rec: RecordedVoice): Promise<UploadedMedia> {
  const ext = rec.uri.split('.').pop()?.toLowerCase() || 'm4a';
  const mime = ext === 'm4a' || ext === 'mp4' ? 'audio/mp4' : `audio/${ext}`;
  // У телефона есть только `file://`-путь; читаем его в Blob — единственный
  // способ отдать байты, не трогая общий `lib/tinode.ts`.
  const blob = await (await fetch(rec.uri)).blob();
  return uploadFile(blob, `voice-${Date.now()}.${ext}`, mime);
}

/** Полоска над композером: цитата ответа или подсказка о правке. */
export function ReplyPreview({
  text,
  mode = 'reply',
  onCancel,
}: {
  text: string;
  mode?: 'reply' | 'edit';
  onCancel: () => void;
}) {
  const editing = mode === 'edit';
  return (
    <View className="flex-row items-center gap-2 border-t border-border bg-card px-3 py-2">
      {editing ? (
        <EditIcon size={16} color={CHAT_COLORS.primary} />
      ) : (
        <ReplyIcon size={16} color={CHAT_COLORS.primary} />
      )}
      <View className="flex-1 border-l-2 border-primary pl-2">
        <Text className="text-[11px] font-medium text-primary">
          {editing ? 'Редактирование' : 'Ответ'}
        </Text>
        <Text numberOfLines={1} className="text-xs text-muted-foreground">
          {text}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={editing ? 'Отменить редактирование' : 'Отменить ответ'}
        onPress={onCancel}
        className="h-6 w-6 items-center justify-center rounded-full">
        <CloseIcon size={16} color={CHAT_COLORS.muted} />
      </Pressable>
    </View>
  );
}

function formatElapsed(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, '0')}`;
}

/**
 * Строка ввода. Кнопка микрофона пишет голосовое через `expo-audio` — тот же
 * жест, что на вебе (`VoiceRecorder.tsx`): тап начинает запись, строка
 * превращается в «отмена · таймер · отправить».
 *
 * Единственное отличие от веба: нет кнопки эмодзи — на телефоне их даёт
 * системная клавиатура, а свой пикер занял бы пол-экрана ради того же самого.
 */
export function Composer({
  draft,
  onDraftChange,
  onSend,
  editing,
  onAttach,
  viewOnceArmed,
  onToggleViewOnce,
  onVoice,
  onVoiceError,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  editing: boolean;
  onAttach: () => void;
  viewOnceArmed: boolean;
  onToggleViewOnce: () => void;
  /** Запись закончена и отправлена пользователем — грузить и слать экрану. */
  onVoice: (rec: RecordedVoice) => void;
  onVoiceError: (message: string) => void;
}) {
  const canSend = draft.trim().length > 0;
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [recording, setRecording] = useState(false);

  // Микрофон не должен оставаться открытым, если экран закрыли посреди записи.
  useEffect(
    () => () => {
      if (recorder.isRecording) void recorder.stop();
    },
    [recorder],
  );

  const startRecording = async () => {
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      onVoiceError('Нет доступа к микрофону');
      return;
    }
    try {
      // На iOS без `allowsRecording` сессия остаётся в режиме воспроизведения и
      // запись выходит пустой; `playsInSilentMode` — чтобы переключатель звука
      // не глушил её молча.
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch {
      onVoiceError('Не удалось начать запись');
    }
  };

  const stopRecording = async (send: boolean) => {
    setRecording(false);
    // Длительность читаем ДО остановки: после неё счётчик обнуляется.
    const sec = Math.round(recorder.currentTime || state.durationMillis / 1000);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
    } catch {
      /* нечего останавливать */
    }
    if (!send) return;
    const uri = recorder.uri;
    if (!uri || sec < 1) {
      onVoiceError('Слишком короткая запись');
      return;
    }
    onVoice({ uri, sec });
  };

  if (recording) {
    return (
      <View className="flex-row items-center gap-2 border-t border-border px-3 py-2.5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Отменить запись"
          onPress={() => void stopRecording(false)}
          className="h-8 w-8 items-center justify-center rounded-full">
          <CloseIcon size={18} color={CHAT_COLORS.muted} />
        </Pressable>

        <View className="flex-1 flex-row items-center gap-2 rounded-3xl bg-muted px-4 py-2">
          <View className="h-2 w-2 rounded-full bg-destructive" />
          <Text className="text-xs text-foreground">
            {formatElapsed(state.durationMillis / 1000)}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Отправить голосовое сообщение"
          onPress={() => void stopRecording(true)}
          className="h-8 w-8 items-center justify-center rounded-full bg-primary">
          <SendIcon size={18} color={CHAT_COLORS.onBubbleOut} />
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-2 border-t border-border px-3 py-2.5">
      <Pressable accessibilityRole="button" accessibilityLabel="Прикрепить" onPress={onAttach}>
        <PlusIcon size={24} color={CHAT_COLORS.muted} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Фото на один просмотр"
        accessibilityState={{ selected: viewOnceArmed }}
        onPress={onToggleViewOnce}
        className="h-6 w-6 items-center justify-center">
        <Text className={`text-sm ${viewOnceArmed ? 'text-primary' : 'text-muted-foreground/70'}`}>
          👁
        </Text>
      </Pressable>

      <TextInput
        value={draft}
        onChangeText={onDraftChange}
        onSubmitEditing={() => canSend && onSend()}
        placeholder={editing ? 'Изменить сообщение' : 'Сообщение'}
        placeholderTextColor={CHAT_COLORS.muted}
        multiline
        className="max-h-24 flex-1 rounded-3xl bg-muted px-4 py-2 text-sm text-foreground"
      />

      {canSend ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Отправить" onPress={onSend}>
          <SendIcon size={24} color={CHAT_COLORS.primary} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Записать голосовое сообщение"
          onPress={() => void startRecording()}>
          <MicIcon size={24} color={CHAT_COLORS.muted} />
        </Pressable>
      )}
    </View>
  );
}

/**
 * Действия над сообщением. На вебе это поповер, приклеенный к пузырю; на
 * телефоне — нижний лист: попасть пальцем в маленький поповер над пузырём у
 * края экрана тяжело, а лист всегда в зоне большого пальца.
 *
 * «Копировать» кладёт текст в системный буфер через готовый `@/lib/clipboard`;
 * подтверждение показывает экран (`onCopied`) своей же плашкой, потому что
 * молчаливое копирование неотличимо от несработавшей кнопки.
 */
export function MessageActions({
  row,
  onReact,
  onReply,
  onEdit,
  onCopied,
  onDeleteMine,
  onDeleteAll,
  onClose,
}: {
  row: ChatRow | null;
  onReact: (row: ChatRow, emoji: string) => void;
  onReply: (row: ChatRow) => void;
  onEdit: (row: ChatRow) => void;
  onCopied: (message: string) => void;
  onDeleteMine: (row: ChatRow) => void;
  onDeleteAll: (row: ChatRow) => void;
  onClose: () => void;
}) {
  if (!row) return null;
  const canEdit = row.own && !!row.text && !row.media?.length && row.seq != null;
  const canCopy = !!row.text && !row.deleted;
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/50" onPress={onClose}>
        {/* Пустой onPress — чтобы тап по самому листу не закрывал его. */}
        <Pressable onPress={() => {}} className="gap-2 px-3 pb-6">
          <View className="flex-row items-center justify-around rounded-full border border-border bg-popover px-2 py-1.5">
            {QUICK_EMOJIS.map((emoji) => (
              <Pressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={`Реакция ${emoji}`}
                onPress={run(() => onReact(row, emoji))}
                className="h-11 w-11 items-center justify-center rounded-full">
                <Text className="text-2xl">{emoji}</Text>
              </Pressable>
            ))}
          </View>

          <View className="overflow-hidden rounded-2xl border border-border bg-popover">
            <Pressable
              onPress={run(() => onReply(row))}
              className="flex-row items-center gap-2.5 px-4 py-3">
              <ReplyIcon size={18} color={CHAT_COLORS.muted} />
              <Text className="text-sm text-popover-foreground">Ответить</Text>
            </Pressable>

            {canEdit ? (
              <Pressable
                onPress={run(() => onEdit(row))}
                className="flex-row items-center gap-2.5 px-4 py-3">
                <EditIcon size={18} color={CHAT_COLORS.muted} />
                <Text className="text-sm text-popover-foreground">Редактировать</Text>
              </Pressable>
            ) : null}

            {canCopy ? (
              <Pressable
                onPress={run(() => {
                  void copyText(row.text).then((ok) =>
                    onCopied(ok ? 'Скопировано' : 'Не удалось скопировать'),
                  );
                })}
                className="flex-row items-center gap-2.5 px-4 py-3">
                <CopyIcon size={18} color={CHAT_COLORS.muted} />
                <Text className="text-sm text-popover-foreground">Копировать</Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={run(() => onDeleteMine(row))}
              className="flex-row items-center gap-2.5 px-4 py-3">
              <TrashIcon size={18} color={CHAT_COLORS.muted} />
              <Text className="text-sm text-popover-foreground">Удалить у меня</Text>
            </Pressable>

            {row.own ? (
              <Pressable
                onPress={run(() => onDeleteAll(row))}
                className="flex-row items-center gap-2.5 px-4 py-3">
                <TrashIcon size={18} color={CHAT_COLORS.destructive} />
                <Text className="text-sm text-destructive">Удалить у всех</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
