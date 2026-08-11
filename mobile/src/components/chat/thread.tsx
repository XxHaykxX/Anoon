import { Image } from 'expo-image';
import { useRef, useState, type ReactNode } from 'react';
import { FlatList, Linking, Modal, Pressable, Text, View } from 'react-native';

import { CheckIcon, DoubleCheckIcon, PlayIcon } from '@/components/icons';
import { fileUrl } from '@/lib/media-url';
import type { MediaPart } from '@/lib/tinode';
import type { TinodeMessageLite } from '@/store';

import { CHAT_COLORS, ChevronDownIcon, DocumentIcon, EyeIcon, EyeOffIcon } from './icons';

/**
 * Лента сообщений — общая часть анон-чата и чата с другом. На вебе это два
 * почти одинаковых куска внутри `AnoonAnonChat`/`AnoonPrivateChat`; здесь один
 * компонент, потому что вся разница между экранами — в шапке и в оверлеях.
 *
 * Главное отличие от веба: `FlatList inverted` вместо скролл-контейнера. Веб
 * держит ленту у низа руками (ResizeObserver + MutationObserver + repin, ~80
 * строк на то, чтобы догруженная картинка не оставила нить висеть выше низа) —
 * перевёрнутый список приклеен к последнему сообщению по устройству, поэтому
 * всё это здесь просто не нужно.
 */

/** Строка ленты — плоская вью-модель поверх `TinodeMessageLite`. */
export type ChatRow = {
  key: string;
  /** Реальный Tinode seq: по нему идут реакции/правка/удаление. */
  seq?: number;
  own: boolean;
  text: string;
  time: string;
  ts: number;
  status?: 'sending' | 'sent' | 'delivered' | 'read';
  reactions?: { emoji: string; mine: boolean }[];
  replyTo?: { seq?: number; text: string };
  edited?: boolean;
  deleted?: boolean;
  media?: MediaPart[];
  viewOnce?: boolean;
  /** Системная строка, вброшенная стором (например «Собеседник покинул чат»). */
  system?: boolean;
};

export function toRows(messages: TinodeMessageLite[]): ChatRow[] {
  return messages.map((m) => {
    const seq = Number.isFinite(Number(m.id)) ? Number(m.id) : undefined;
    return {
      key: m.id,
      seq,
      own: m.mine,
      text: m.text,
      time: formatTs(m.ts),
      ts: m.ts,
      status: m.mine ? m.status : undefined,
      reactions: m.reactions,
      replyTo: m.replyTo,
      edited: m.edited,
      deleted: m.deleted,
      media: m.media,
      viewOnce: m.viewOnce,
      system: m.system,
    };
  });
}

function formatTs(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/** Разделитель дня: «Сегодня» / «Вчера» / «5 июля». */
function dayLabel(ms: number): string {
  const d = new Date(ms);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/**
 * Элемент списка. Текст и каждое вложение — отдельные элементы: на вебе они
 * тоже рисуются соседними блоками, а плоский список избавляет FlatList от
 * вложенных списков и делает `keyExtractor` тривиальным.
 */
type Item =
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'system'; key: string; text: string }
  | { kind: 'text'; key: string; row: ChatRow }
  | { kind: 'media'; key: string; row: ChatRow; part: MediaPart; index: number };

function buildItems(rows: ChatRow[]): Item[] {
  const out: Item[] = [];
  let lastDay = '';
  for (const r of rows) {
    const d = new Date(r.ts);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (dayKey !== lastDay) {
      out.push({ kind: 'divider', key: `${r.key}-day`, label: dayLabel(r.ts) });
      lastDay = dayKey;
    }
    if (r.system) {
      out.push({ kind: 'system', key: r.key, text: r.text });
      continue;
    }
    if (r.text || r.deleted) out.push({ kind: 'text', key: r.key, row: r });
    r.media?.forEach((part, index) =>
      out.push({ kind: 'media', key: `${r.key}-media-${index}`, row: r, part, index }),
    );
  }
  return out;
}

/** Галочки статуса доставки на своём пузыре. */
function StatusTicks({ status }: { status?: ChatRow['status'] }) {
  if (!status) return null;
  if (status === 'sending' || status === 'sent') {
    return <CheckIcon size={14} color={CHAT_COLORS.onBubbleOut} opacity={0.6} />;
  }
  const read = status === 'read';
  return (
    <DoubleCheckIcon
      size={16}
      color={read ? CHAT_COLORS.readTickOnPrimary : CHAT_COLORS.onBubbleOut}
      opacity={read ? 1 : 0.6}
    />
  );
}

function DayDivider({ label }: { label: string }) {
  return (
    <View className="my-2 items-center">
      <Text className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
        {label}
      </Text>
    </View>
  );
}

function SystemLine({ text }: { text: string }) {
  return (
    <View className="my-1 items-center">
      <Text className="max-w-[80%] rounded-full bg-muted px-3 py-1 text-center text-[11px] text-muted-foreground">
        {text}
      </Text>
    </View>
  );
}

/** Текстовый пузырь: цитата, тело, время, галочки и реакции под ним. */
function TextBubble({
  row,
  onLongPress,
  onDoubleTap,
}: {
  row: ChatRow;
  onLongPress: (row: ChatRow) => void;
  onDoubleTap: (row: ChatRow) => void;
}) {
  const lastTap = useRef(0);
  const align = row.own ? 'self-end items-end' : 'self-start items-start';

  if (row.deleted) {
    return (
      <View className={`max-w-[78%] ${align}`}>
        <Text className="rounded-2xl bg-muted px-3.5 py-2 text-sm italic text-muted-foreground">
          сообщение удалено
        </Text>
      </View>
    );
  }

  // Двойной тап — ❤️. У Pressable нет onDoubleTap, поэтому сравниваем время
  // между нажатиями сами: отдельный жест-детектор ради одного действия избыточен.
  const handlePress = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      onDoubleTap(row);
      return;
    }
    lastTap.current = now;
  };

  return (
    <View className={`max-w-[78%] ${align}`}>
      <Pressable
        onPress={handlePress}
        onLongPress={() => onLongPress(row)}
        delayLongPress={420}
        className={`rounded-2xl px-3.5 py-2 ${row.own ? 'bg-bubble-out' : 'bg-bubble-in'}`}>
        {row.replyTo ? (
          <View
            className={`mb-1 rounded-md border-l-2 px-2 py-1 ${
              row.own ? 'border-black/40 bg-black/10' : 'border-primary/50 bg-primary/10'
            }`}>
            <Text
              numberOfLines={2}
              className={`text-xs ${
                row.own ? 'text-bubble-out-foreground/80' : 'text-bubble-in-foreground/80'
              }`}>
              {row.replyTo.text}
            </Text>
          </View>
        ) : null}
        <Text
          className={`text-sm ${row.own ? 'text-bubble-out-foreground' : 'text-bubble-in-foreground'}`}>
          {row.text}
        </Text>
        <View className="mt-0.5 flex-row items-center justify-end gap-1">
          {row.edited ? (
            <Text
              className={`text-[11px] italic ${
                row.own ? 'text-bubble-out-foreground/60' : 'text-bubble-in-foreground/50'
              }`}>
              изменено
            </Text>
          ) : null}
          <Text
            className={`text-[11px] ${
              row.own ? 'text-bubble-out-foreground/60' : 'text-bubble-in-foreground/50'
            }`}>
            {row.time}
          </Text>
          {row.own ? <StatusTicks status={row.status} /> : null}
        </View>
      </Pressable>

      {row.reactions && row.reactions.length > 0 ? (
        <View className={`-mt-1.5 flex-row gap-1 ${row.own ? 'flex-row-reverse' : ''}`}>
          {row.reactions.map((r) => (
            <Pressable
              key={r.emoji}
              onPress={() => onLongPress(row)}
              className={`rounded-full border px-1.5 py-0.5 ${
                r.mine ? 'border-primary bg-primary/15' : 'border-border bg-card'
              }`}>
              <Text className="text-xs">{r.emoji}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const MEDIA_WIDTH = 260;

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(sec?: number): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, '0')}`;
}

/**
 * Вложение в ленте. Что портировано честно: фото (включая «на один просмотр»)
 * и превью-плитки видео/голоса/файла.
 *
 * Чего нет и почему: инлайн-проигрывателя видео и голосовых. Для них нужны
 * `expo-video` / `expo-audio`, которых в зависимостях нет, а рисовать плеер,
 * который не играет, — хуже, чем открыть файл системным приложением. Поэтому
 * тап по видео/голосу/файлу уходит в `Linking.openURL` с тем же авторизованным
 * URL, что и картинка.
 */
function MediaBubble({
  row,
  part,
  viewed,
  onOpenImage,
  onViewOnceOpen,
}: {
  row: ChatRow;
  part: MediaPart;
  viewed: boolean;
  onOpenImage: (uri: string) => void;
  onViewOnceOpen: (seq: number | undefined) => void;
}) {
  const align = row.own ? 'self-end' : 'self-start';
  // `part.url` непустой по построению (`parseMediaParts` пустые ref'ы отбрасывает).
  const uri = fileUrl(part.url) ?? '';
  const ratio = part.width && part.height ? part.width / part.height : 4 / 3;

  // Гейт «на один просмотр» — только у получателя: своё фото отправитель видит
  // как обычное.
  const gated = Boolean(row.viewOnce) && !row.own && (part.kind === 'image' || part.kind === 'video');
  if (gated) {
    const noun = part.kind === 'image' ? 'Фото' : 'Видео';
    if (viewed) {
      return (
        <View
          className={`${align} w-[260px] flex-row items-center gap-2 rounded-2xl bg-bubble-in px-3.5 py-3`}>
          <EyeOffIcon size={16} color={CHAT_COLORS.muted} />
          <Text className="text-xs text-bubble-in-foreground/60">{noun} просмотрено</Text>
        </View>
      );
    }
    return (
      <Pressable
        onPress={() => {
          onViewOnceOpen(row.seq);
          if (part.kind === 'image') onOpenImage(uri);
          else void Linking.openURL(uri);
        }}
        className={`${align} overflow-hidden rounded-2xl`}
        style={{ width: MEDIA_WIDTH, aspectRatio: 4 / 5 }}>
        {part.kind === 'image' ? (
          <Image source={{ uri }} blurRadius={40} style={{ flex: 1 }} contentFit="cover" />
        ) : (
          <View className="flex-1 bg-secondary" />
        )}
        <View className="absolute inset-0 items-center justify-center gap-2 bg-black/45 px-4">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-white/15">
            <EyeIcon size={24} color="#ffffff" />
          </View>
          <Text className="text-sm font-semibold text-white">{noun} на один просмотр</Text>
          <Text className="text-[11px] text-white/70">Нажми, чтобы посмотреть</Text>
        </View>
      </Pressable>
    );
  }

  if (part.kind === 'image') {
    return (
      <Pressable
        onPress={() => onOpenImage(uri)}
        className={`${align} overflow-hidden rounded-2xl`}
        style={{ width: MEDIA_WIDTH, maxHeight: 320 }}>
        <Image
          source={{ uri }}
          style={{ width: MEDIA_WIDTH, aspectRatio: ratio, maxHeight: 320 }}
          contentFit="cover"
          transition={120}
        />
        <MediaMetaChip row={row} />
      </Pressable>
    );
  }

  if (part.kind === 'video') {
    return (
      <Pressable
        onPress={() => void Linking.openURL(uri)}
        className={`${align} items-center justify-center overflow-hidden rounded-2xl bg-secondary`}
        style={{ width: MEDIA_WIDTH, aspectRatio: 4 / 3 }}>
        <View className="h-14 w-14 items-center justify-center rounded-full bg-black/50">
          <PlayIcon size={24} color="#ffffff" />
        </View>
        <Text className="mt-2 text-[11px] text-muted-foreground">
          {formatDuration(part.duration) ?? 'Видео'}
        </Text>
        <MediaMetaChip row={row} />
      </Pressable>
    );
  }

  if (part.kind === 'audio') {
    return (
      <Pressable
        onPress={() => void Linking.openURL(uri)}
        className={`${align} w-[260px] flex-row items-center gap-2.5 rounded-2xl px-3 py-2.5 ${
          row.own ? 'bg-bubble-out' : 'bg-bubble-in'
        }`}>
        <View
          className={`h-9 w-9 items-center justify-center rounded-full ${
            row.own ? 'bg-black/10' : 'bg-primary/15'
          }`}>
          <PlayIcon size={18} color={row.own ? CHAT_COLORS.onBubbleOut : CHAT_COLORS.primary} />
        </View>
        <View className="flex-1">
          <Text
            className={`text-sm font-medium ${
              row.own ? 'text-bubble-out-foreground' : 'text-bubble-in-foreground'
            }`}>
            Голосовое сообщение
          </Text>
          <Text
            className={`text-[11px] ${
              row.own ? 'text-bubble-out-foreground/60' : 'text-bubble-in-foreground/50'
            }`}>
            {formatDuration(part.duration) ?? part.name}
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => void Linking.openURL(uri)}
      className={`${align} w-[260px] flex-row items-center gap-2.5 rounded-2xl px-3 py-2.5 ${
        row.own ? 'bg-bubble-out' : 'bg-bubble-in'
      }`}>
      <View
        className={`h-9 w-9 items-center justify-center rounded-full ${
          row.own ? 'bg-black/10' : 'bg-primary/15'
        }`}>
        <DocumentIcon size={20} color={row.own ? CHAT_COLORS.onBubbleOut : CHAT_COLORS.primary} />
      </View>
      <View className="flex-1">
        <Text
          numberOfLines={1}
          className={`text-sm font-medium ${
            row.own ? 'text-bubble-out-foreground' : 'text-bubble-in-foreground'
          }`}>
          {part.name || 'Файл'}
        </Text>
        <Text
          className={`text-[11px] ${
            row.own ? 'text-bubble-out-foreground/60' : 'text-bubble-in-foreground/50'
          }`}>
          {formatSize(part.size)}
        </Text>
      </View>
    </Pressable>
  );
}

/** Время (и галочка на своём) поверх правого нижнего угла медиа-плитки. */
function MediaMetaChip({ row }: { row: ChatRow }) {
  return (
    <View className="absolute bottom-2 right-2 flex-row items-center gap-1 rounded-full bg-black/55 px-2 py-0.5">
      <Text className="text-[10px] font-medium text-white">{row.time}</Text>
      {row.own ? (
        <DoubleCheckIcon
          size={14}
          color={row.status === 'read' ? '#3898ff' : '#ffffff'}
          opacity={row.status === 'read' ? 1 : 0.8}
        />
      ) : null}
    </View>
  );
}

/** «печатает…» / «отправляет медиа…» — три точки без анимации (см. отчёт). */
function ActivityRow({ activity }: { activity: 'typing' | 'media' }) {
  return (
    <View className="flex-row items-center gap-2 self-start">
      <View className="flex-row items-center gap-1 rounded-2xl bg-bubble-in px-3.5 py-3">
        {[0, 1, 2].map((i) => (
          <View key={i} className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        ))}
      </View>
      <Text className="text-[11px] text-muted-foreground">
        {activity === 'media' ? 'отправляет медиа…' : 'печатает…'}
      </Text>
    </View>
  );
}

export function Thread({
  rows,
  viewed,
  activity,
  top,
  bottom,
  onLongPressRow,
  onDoubleTapRow,
  onViewOnceOpen,
}: {
  rows: ChatRow[];
  /** seq → фото «на один просмотр» уже открыто. */
  viewed: Record<number, true>;
  activity: 'typing' | 'media' | null;
  /** Шапка ленты — самый верх (плашка «Вы общаетесь анонимно», «нет сообщений»). */
  top?: ReactNode;
  /** Низ ленты, под последним сообщением — карточка раскрытия и системные заметки. */
  bottom?: ReactNode;
  onLongPressRow: (row: ChatRow) => void;
  onDoubleTapRow: (row: ChatRow) => void;
  onViewOnceOpen: (seq: number | undefined) => void;
}) {
  const listRef = useRef<FlatList<Item>>(null);
  const [showJump, setShowJump] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  // Перевёрнутый список: данные идут от новых к старым, а `ListHeaderComponent`
  // рисуется у НИЗА экрана — туда и уходит «печатает…» с нижними карточками.
  const items = buildItems(rows).reverse();

  return (
    <View className="flex-1">
      <FlatList
        ref={listRef}
        inverted
        data={items}
        keyExtractor={(it) => it.key}
        contentContainerClassName="gap-2 px-3 py-3"
        keyboardDismissMode="on-drag"
        onScroll={(e) => setShowJump(e.nativeEvent.contentOffset.y > 240)}
        scrollEventThrottle={64}
        ListHeaderComponent={
          <View className="gap-2">
            {activity ? <ActivityRow activity={activity} /> : null}
            {bottom}
          </View>
        }
        ListFooterComponent={top ? <View className="gap-2 pb-2">{top}</View> : null}
        renderItem={({ item }) => {
          if (item.kind === 'divider') return <DayDivider label={item.label} />;
          if (item.kind === 'system') return <SystemLine text={item.text} />;
          if (item.kind === 'text') {
            return (
              <TextBubble row={item.row} onLongPress={onLongPressRow} onDoubleTap={onDoubleTapRow} />
            );
          }
          return (
            <MediaBubble
              row={item.row}
              part={item.part}
              viewed={item.row.seq != null && Boolean(viewed[item.row.seq])}
              onOpenImage={setViewerUri}
              onViewOnceOpen={onViewOnceOpen}
            />
          );
        }}
      />

      {showJump ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="К последнему сообщению"
          onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
          className="absolute bottom-4 right-3 h-9 w-9 items-center justify-center rounded-full border border-border bg-card">
          <ChevronDownIcon size={20} />
        </Pressable>
      ) : null}

      {/* Просмотр фото во весь экран. Без зума и свайпов по галерее: это
          отдельный экран веба (`media-viewer`), а здесь нужен только сам
          снимок — жестовый вьюер потребовал бы отдельной библиотеки. */}
      <Modal visible={viewerUri != null} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <Pressable className="flex-1 bg-black" onPress={() => setViewerUri(null)}>
          {viewerUri ? (
            <Image source={{ uri: viewerUri }} style={{ flex: 1 }} contentFit="contain" />
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}
