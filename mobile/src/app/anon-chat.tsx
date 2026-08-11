import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Composer,
  MessageActions,
  ReplyPreview,
  pickAndUpload,
  uploadVoice,
  type RecordedVoice,
} from '@/components/chat/composer';
import { CHAT_COLORS, MoreIcon, ReportIcon } from '@/components/chat/icons';
import {
  Banner,
  ChatMenu,
  ChatMenuItem,
  ConversationEnded,
  RevealPrompt,
} from '@/components/chat/overlays';
import { Thread, toRows, type ChatRow } from '@/components/chat/thread';
import {
  BlockIcon,
  ChevronLeftIcon,
  CloseIcon,
  PhoneIcon,
  UserCircleIcon,
  VideoIcon,
} from '@/components/icons';
import { AnoonAvatar } from '@/components/shared';
import { placeCall } from '@/lib/calls';
import { getCompanionClient } from '@/lib/companion';
import { avatarUrlFor } from '@/lib/media-url';
import { useAnoonStore } from '@/store';

/**
 * Анонимный чат рулетки (`AnoonAnonChat.tsx`). Вся логика — из общего стора:
 * матч, лента, «печатает», раскрытие профиля, завершение и оценка.
 *
 * Чего здесь нет: mock-режима — на телефоне `useTinode` всегда true
 * (`platform.ts`), поэтому ветки веба «если не real» просто отсутствуют, а не
 * спрятаны за флаг.
 */
export default function AnonChatScreen() {
  const activeMatch = useAnoonStore((s) => s.activeMatch);
  const storeMessages = useAnoonStore((s) => s.messages);
  const peerTyping = useAnoonStore((s) => s.peerTyping);
  const anonPeerActivity = useAnoonStore((s) => s.anonPeerActivity);
  const anonRevealState = useAnoonStore((s) => s.anonRevealState);
  const anonRevealPending = useAnoonStore((s) => s.anonRevealPending);
  const anonRevealAsksLeft = useAnoonStore((s) => s.anonRevealAsksLeft);
  const anonViewed = useAnoonStore((s) => s.anonViewed);
  const anonPeerLeft = useAnoonStore((s) => s.anonPeerLeft);
  const sendAnonMessage = useAnoonStore((s) => s.sendAnonMessage);
  const sendAnonMedia = useAnoonStore((s) => s.sendAnonMedia);
  const sendAnonReaction = useAnoonStore((s) => s.sendAnonReaction);
  const editAnonMessage = useAnoonStore((s) => s.editAnonMessage);
  const deleteAnonMessage = useAnoonStore((s) => s.deleteAnonMessage);
  const markAnonViewed = useAnoonStore((s) => s.markAnonViewed);
  const notifyAnonTyping = useAnoonStore((s) => s.notifyAnonTyping);
  const requestReveal = useAnoonStore((s) => s.requestReveal);
  const respondReveal = useAnoonStore((s) => s.respondReveal);
  const resyncAnonReveal = useAnoonStore((s) => s.resyncAnonReveal);
  const rateMatch = useAnoonStore((s) => s.rateMatch);
  const endMatch = useAnoonStore((s) => s.endMatch);
  const closeAnon = useAnoonStore((s) => s.closeAnon);
  const joinQueue = useAnoonStore((s) => s.joinQueue);

  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionFor, setActionFor] = useState<ChatRow | null>(null);
  const [replyTarget, setReplyTarget] = useState<{ seq?: number; text: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{ seq: number; text: string } | null>(null);
  const [viewOnceArmed, setViewOnceArmed] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  // Аватар собеседника хранится ВМЕСТЕ с топиком, которому принадлежит. Иначе
  // при переходе к следующей паре здесь на мгновение оставался бы URL прежнего
  // собеседника — а это ровно та утечка, ради предотвращения которой анонимная
  // фаза и существует.
  const [peerAvatar, setPeerAvatar] = useState<{ topic: string; url: string } | null>(null);
  const lastKpAt = useRef(0);

  // `ended` важнее: он означает, что ЭТОТ пользователь нажал «Завершить
  // разговор» и смотрит на свой экран оценки. Уход собеседника прилетает
  // мгновением позже (он тоже покидает мёртвый чат), и без этой защиты экран
  // переименовывался бы под пальцем.
  const peerLeft = !!anonPeerLeft && !ended;
  const revealed = anonRevealState === 'revealed';
  const revealAsksExhausted = anonRevealAsksLeft === 0;
  const partnerId = activeMatch?.peerHashId
    ? `#${activeMatch.peerHashId.replace(/^#/, '')}`
    : (activeMatch?.peerAlias ?? '');
  const headerName = revealed ? (activeMatch?.peerDisplayName ?? 'Собеседник') : 'Собеседник';
  const peerInitials = (activeMatch?.peerDisplayName?.trim()[0] ?? '?').toUpperCase();
  const activity: 'typing' | 'media' | null = anonPeerActivity ?? (peerTyping ? 'typing' : null);
  // Показываем фото, только если оно от ТЕКУЩЕЙ пары и профили уже раскрыты.
  // Оба условия — вычисление, а не состояние: сбрасывать их через setState в
  // эффекте значило бы лишний рендер и окно, в котором старое фото ещё видно.
  const peerAvatarUrl =
    revealed && peerAvatar && activeMatch?.topic && peerAvatar.topic === activeMatch.topic
      ? peerAvatar.url
      : null;

  const flash = useCallback((text: string) => {
    setBanner(text);
    setTimeout(() => setBanner(null), 2200);
  }, []);

  // Разовое подтверждение в МОМЕНТ раскрытия профилей.
  //
  // Подписка на стор, а не эффект по `revealed`: баннер — реакция на переход,
  // которого в состоянии экрана нет, и вычислить его из `revealed` нельзя.
  // Эффект же вдобавок показывал баннер при каждом входе на уже раскрытую пару
  // — например после перезапуска приложения, когда открывать нечего.
  useEffect(
    () =>
      useAnoonStore.subscribe((s, prev) => {
        if (s.anonRevealState === 'revealed' && prev.anonRevealState !== 'revealed') {
          flash('Профили открыты — вы теперь друзья');
        }
      }),
    [flash],
  );

  // Лечим рукопожатие раскрытия при возврате приложения на передний план: кадры
  // reveal_request/declined идут по тому же best-effort сокету, и свёрнутое
  // приложение может пропустить один — тогда экран навсегда залипал бы на
  // «Ожидание…». Веб делает то же самое на `visibilitychange`.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void resyncAnonReveal();
    });
    return () => sub.remove();
  }, [resyncAnonReveal]);

  // После раскрытия показываем настоящий аватар собеседника. Ссылка на фото
  // едет в `public` анон-топика и может прийти чуть позже самого раскрытия —
  // поэтому несколько попыток, а потом молча остаются инициалы.
  useEffect(() => {
    const topic = activeMatch?.topic;
    // До раскрытия аватар не показываем — но гасим его вычислением ниже, а не
    // setState прямо в эффекте: сброс состояния здесь давал лишний каскадный
    // рендер на каждую смену пары.
    if (!revealed || !topic) return;
    let tries = 0;
    const read = () => {
      const url = avatarUrlFor(topic);
      if (url) setPeerAvatar({ topic, url });
      return Boolean(url);
    };
    if (read()) return;
    const iv = setInterval(() => {
      if (read() || ++tries > 6) clearInterval(iv);
    }, 500);
    return () => clearInterval(iv);
  }, [revealed, activeMatch?.topic]);

  const rows = toRows(storeMessages);

  const send = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (editTarget) {
      void editAnonMessage(editTarget.seq, trimmed);
      setEditTarget(null);
      setDraft('');
      return;
    }
    const reply = replyTarget?.seq != null ? { seq: replyTarget.seq, text: replyTarget.text } : undefined;
    void sendAnonMessage(trimmed, reply);
    setDraft('');
    setReplyTarget(null);
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    // «печатает» шлём не чаще раза в 3 секунды.
    if (Date.now() - lastKpAt.current > 3000) {
      lastKpAt.current = Date.now();
      notifyAnonTyping();
    }
  };

  const attach = async () => {
    const armed = viewOnceArmed;
    setViewOnceArmed(false);
    try {
      // Пир видит «отправляет медиа…», пока идёт загрузка.
      useAnoonStore.getState().notifyAnonMediaSending();
      const picked = await pickAndUpload();
      if (!picked) return;
      await sendAnonMedia(
        picked.up,
        picked.kind,
        picked.extra,
        armed && picked.kind === 'image' ? { viewOnce: true } : undefined,
      );
    } catch {
      flash('Не удалось отправить');
    }
  };

  const sendVoice = async (rec: RecordedVoice) => {
    try {
      useAnoonStore.getState().notifyAnonMediaSending();
      const up = await uploadVoice(rec);
      await sendAnonMedia(up, 'audio', { duration: rec.sec });
    } catch {
      flash('Не удалось отправить');
    }
  };

  // Звоним тем хендлом, который у нас законно есть: настоящий #ID после
  // раскрытия, по-матчевый алиас пока анонимно (companion разрешает алиас
  // только внутри породившего его матча) — ровно как на вебе.
  const startCall = (media: 'audio' | 'video') => {
    const to = activeMatch?.peerHashId
      ? `#${activeMatch.peerHashId.replace(/^#/, '')}`
      : activeMatch?.peerAlias;
    if (!to) return;
    placeCall(to, headerName, media);
  };

  // Завершение → оценка → выход. `rateMatch` читает activeMatch синхронно до
  // первого await, поэтому вызывается ДО closeAnon(), который его обнуляет —
  // порядок здесь несущий.
  const finishRating = (rating?: number) => {
    setEnded(false);
    if (rating) void rateMatch(rating);
    closeAnon();
    router.replace('/(tabs)/home');
  };

  // «Новый собеседник» на экране ухода пира: выйти из матча и сразу встать в
  // очередь с уже выбранными фильтрами. Если фильтров нет (перезапуск
  // приложения в чате) — честно домой, а не искать с выдуманными.
  const startNextMatch = (rating?: number) => {
    finishRating(rating);
    const prefs = getCompanionClient().getLastPrefs();
    if (!prefs) return;
    void joinQueue(prefs).catch(() => router.replace('/(tabs)/home'));
    router.push('/searching');
  };

  // Блокировка — действие безопасности: уходим, только когда она реально
  // прошла. Иначе пользователь считал бы себя защищённым, а матчер мог бы
  // свести его с тем же человеком снова.
  const blockPeer = async () => {
    setMenuOpen(false);
    const topic = activeMatch?.topic;
    if (topic) {
      try {
        await getCompanionClient().blockAnonPeer(topic);
      } catch {
        flash('Не удалось заблокировать. Попробуйте ещё раз.');
        return;
      }
    }
    void endMatch();
    closeAnon();
    router.replace('/(tabs)/home');
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="flex-row items-center gap-2.5 border-b border-border px-3 py-2.5">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Назад"
            onPress={() => {
              closeAnon();
              router.back();
            }}>
            <ChevronLeftIcon size={24} />
          </Pressable>

          {revealed && peerAvatarUrl ? (
            <AnoonAvatar initials={peerInitials} size={36} photoUrl={peerAvatarUrl} />
          ) : revealed ? (
            <AnoonAvatar initials={peerInitials} size={36} />
          ) : (
            <View className="h-9 w-9 items-center justify-center rounded-full bg-muted">
              <UserCircleIcon size={24} color={CHAT_COLORS.muted} />
            </View>
          )}

          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-sm font-semibold text-foreground">
              {headerName}
            </Text>
            <View className="flex-row items-center gap-1.5">
              {/* Пока хендл неизвестен (перезапуск в чате, `/roulette/status` ещё
                  не ответил) не показываем ничего: «—» читалось бы как имя. */}
              {partnerId ? (
                <Text className="text-xs text-muted-foreground">{partnerId}</Text>
              ) : null}
              {activity ? (
                <Text numberOfLines={1} className="text-xs text-online">
                  {activity === 'media' ? 'отправляет медиа…' : 'печатает…'}
                </Text>
              ) : null}
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Аудиозвонок"
            onPress={() => startCall('audio')}>
            <PhoneIcon size={20} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Видеозвонок"
            onPress={() => startCall('video')}>
            <VideoIcon size={20} />
          </Pressable>

          {!revealed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: anonRevealPending || revealAsksExhausted }}
              disabled={anonRevealPending || revealAsksExhausted}
              onPress={() =>
                void requestReveal().catch(() =>
                  flash('Не удалось отправить запрос. Попробуйте ещё раз.'),
                )
              }
              className={`rounded-full bg-primary px-2.5 py-1.5 ${
                anonRevealPending || revealAsksExhausted ? 'opacity-60' : ''
              }`}>
              <Text className="text-xs font-semibold text-primary-foreground">
                {anonRevealPending ? 'Ожидание…' : 'Раскрыть'}
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Меню чата"
            onPress={() => setMenuOpen(true)}>
            <MoreIcon size={20} />
          </Pressable>
        </View>

        <Banner message={banner} />

        <Thread
          rows={rows}
          viewed={anonViewed}
          activity={activity}
          top={
            <View className="items-center">
              <Text className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
                {revealed
                  ? 'Профили открыты — вы теперь друзья'
                  : partnerId
                    ? `Вы общаетесь анонимно · ${partnerId}`
                    : 'Вы общаетесь анонимно'}
              </Text>
            </View>
          }
          bottom={
            <>
              {/* Отказ — не приговор: предложить можно позже, кнопка снова активна. */}
              {anonRevealState === 'declined' && !revealAsksExhausted ? (
                <Text className="max-w-[320px] self-center rounded-2xl bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
                  Собеседник пока не готов открыть профиль. Можно предложить позже.
                </Text>
              ) : null}
              {/* Обе попытки истрачены — эта строка ЗАМЕНЯЕТ предыдущую, та стала
                  бы неправдой. Дверь не закрыта: у собеседника свой лимит. */}
              {revealAsksExhausted ? (
                <Text className="max-w-[320px] self-center rounded-2xl bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
                  Вы уже дважды предлагали раскрыть профиль. Больше предложить нельзя — но
                  собеседник всё ещё может предложить сам.
                </Text>
              ) : null}
              {anonRevealState === 'peer_requested' ? (
                <RevealPrompt
                  partnerId={partnerId}
                  onOpen={() =>
                    void respondReveal(true).catch(() =>
                      flash('Не удалось раскрыть профиль. Попробуйте ещё раз.'),
                    )
                  }
                  onDecline={() =>
                    void respondReveal(false).catch(() =>
                      flash('Не удалось отправить ответ. Попробуйте ещё раз.'),
                    )
                  }
                  // «Заблокировать» здесь действительно блокирует: блокировка
                  // завершает матч, что отвечает на запрос определённее отказа.
                  onBlock={() => void blockPeer()}
                />
              ) : null}
            </>
          }
          onLongPressRow={setActionFor}
          onDoubleTapRow={(row) => {
            if (row.seq) void sendAnonReaction(row.seq, '❤️');
          }}
          onViewOnceOpen={(seq) => seq != null && markAnonViewed(seq)}
        />

        {editTarget ? (
          <ReplyPreview
            text={editTarget.text}
            mode="edit"
            onCancel={() => {
              setEditTarget(null);
              setDraft('');
            }}
          />
        ) : replyTarget ? (
          <ReplyPreview text={replyTarget.text} onCancel={() => setReplyTarget(null)} />
        ) : null}

        {viewOnceArmed ? (
          <View className="flex-row items-center gap-2 border-t border-border bg-card px-3 py-2">
            <Text className="text-xs text-primary">📷 Следующее фото — на один просмотр</Text>
            <Pressable className="ml-auto" onPress={() => setViewOnceArmed(false)}>
              <Text className="text-xs text-muted-foreground">Отменить</Text>
            </Pressable>
          </View>
        ) : null}

        <Composer
          draft={draft}
          onDraftChange={onDraftChange}
          onSend={send}
          editing={editTarget != null}
          onAttach={() => void attach()}
          viewOnceArmed={viewOnceArmed}
          onToggleViewOnce={() => setViewOnceArmed((v) => !v)}
          onVoice={(rec) => void sendVoice(rec)}
          onVoiceError={flash}
        />
      </KeyboardAvoidingView>

      <ChatMenu visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <ChatMenuItem
          label="Завершить разговор"
          icon={<CloseIcon size={18} color={CHAT_COLORS.muted} />}
          onPress={() => {
            setMenuOpen(false);
            void endMatch();
            setEnded(true);
          }}
        />
        <ChatMenuItem
          label="Пожаловаться"
          icon={<ReportIcon size={18} color={CHAT_COLORS.muted} />}
          onPress={() => {
            setMenuOpen(false);
            router.push('/report');
          }}
        />
        <ChatMenuItem
          label="Заблокировать"
          destructive
          icon={<BlockIcon size={18} color={CHAT_COLORS.destructive} />}
          onPress={() => void blockPeer()}
        />
      </ChatMenu>

      <MessageActions
        row={actionFor}
        onReact={(row, emoji) => row.seq && void sendAnonReaction(row.seq, emoji)}
        onReply={(row) => {
          setReplyTarget({ seq: row.seq, text: row.text || 'вложение' });
          setEditTarget(null);
        }}
        onEdit={(row) => {
          if (row.seq == null) return;
          setEditTarget({ seq: row.seq, text: row.text });
          setReplyTarget(null);
          setDraft(row.text);
        }}
        onCopied={flash}
        onDeleteMine={(row) => row.seq && void deleteAnonMessage(row.seq, false)}
        onDeleteAll={(row) => row.seq && void deleteAnonMessage(row.seq, true)}
        onClose={() => setActionFor(null)}
      />

      {ended || peerLeft ? (
        <ConversationEnded
          peerLeft={peerLeft}
          onSubmit={finishRating}
          onSkip={finishRating}
          onNext={startNextMatch}
        />
      ) : null}
    </SafeAreaView>
  );
}
