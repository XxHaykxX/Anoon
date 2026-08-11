import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Composer, MessageActions, ReplyPreview, pickAndUpload } from '@/components/chat/composer';
import { CHAT_COLORS, MoreIcon, ReportIcon } from '@/components/chat/icons';
import { Banner, ChatMenu, ChatMenuItem } from '@/components/chat/overlays';
import { Thread, toRows, type ChatRow } from '@/components/chat/thread';
import { ChevronLeftIcon, PhoneIcon, VideoIcon } from '@/components/icons';
import { AnoonAvatar } from '@/components/shared';
import { avatarUrlFor } from '@/lib/media-url';
import { useAnoonStore } from '@/store';

/**
 * Чат с другом (`AnoonPrivateChat.tsx`). Лента, композер, меню сообщения и
 * оверлеи — общие с анон-чатом (`components/chat/*`): вся разница между двумя
 * экранами в шапке и в том, какие методы стора они дёргают, поэтому второй
 * копии тут нет.
 *
 * Чего нет и почему — ровно как в анон-чате: звонки (нужен
 * `react-native-webrtc`) и запись голоса (нужен `expo-audio`) видимо выключены.
 */
export default function PrivateChatScreen() {
  const activeChat = useAnoonStore((s) => s.activeChat);
  const storeMsgs = useAnoonStore((s) => s.chatMessages);
  const peerTyping = useAnoonStore((s) => s.chatPeerTyping);
  const storePeerActivity = useAnoonStore((s) => s.peerActivity);
  const chatPeerOnline = useAnoonStore((s) => s.chatPeerOnline);
  const chatPeerLastSeen = useAnoonStore((s) => s.chatPeerLastSeen);
  const chatViewed = useAnoonStore((s) => s.chatViewed);
  const sendChatMessage = useAnoonStore((s) => s.sendChatMessage);
  const sendFriendMedia = useAnoonStore((s) => s.sendFriendMedia);
  const sendChatReaction = useAnoonStore((s) => s.sendChatReaction);
  const editChatMessage = useAnoonStore((s) => s.editChatMessage);
  const deleteChatMessage = useAnoonStore((s) => s.deleteChatMessage);
  const markChatViewed = useAnoonStore((s) => s.markChatViewed);
  const notifyTyping = useAnoonStore((s) => s.notifyTyping);
  const openChat = useAnoonStore((s) => s.openChat);
  const closeChat = useAnoonStore((s) => s.closeChat);
  const chatTargetId = useAnoonStore((s) => s.chatTarget?.id);

  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionFor, setActionFor] = useState<ChatRow | null>(null);
  const [replyTarget, setReplyTarget] = useState<{ seq?: number; text: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{ seq: number; text: string } | null>(null);
  const [viewOnceArmed, setViewOnceArmed] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const lastKpAt = useRef(0);

  // Топик открывается на монтировании и закрывается на размонтировании —
  // симметрично, чтобы повторный монтаж переоткрыл его, а не оставил
  // `activeChat` пустым. Цель (`chatTarget`) переживает `closeChat` ровно
  // затем, чтобы это было возможно.
  useEffect(() => {
    const target = useAnoonStore.getState().chatTarget;
    if (target) void openChat(target);
    return () => closeChat();
  }, [chatTargetId, openChat, closeChat]);

  const flash = useCallback((text: string) => {
    setBanner(text);
    setTimeout(() => setBanner(null), 2200);
  }, []);

  const peerName = activeChat?.displayName ?? 'Чат';
  const peerInitials = (activeChat?.displayName.trim()[0] ?? '?').toUpperCase();
  const peerAvatarUrl = avatarUrlFor(activeChat?.topic);
  const activity: 'typing' | 'media' | null = storePeerActivity ?? (peerTyping ? 'typing' : null);
  const subtitle = chatPeerOnline ? 'в сети' : (chatPeerLastSeen ?? 'не в сети');

  const rows = toRows(storeMsgs);

  const send = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (editTarget) {
      void editChatMessage(editTarget.seq, trimmed);
      setEditTarget(null);
      setDraft('');
      return;
    }
    const reply = replyTarget?.seq != null ? { seq: replyTarget.seq, text: replyTarget.text } : undefined;
    void sendChatMessage(trimmed, reply);
    setDraft('');
    setReplyTarget(null);
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    // «печатает» шлём не чаще раза в 3 секунды.
    if (Date.now() - lastKpAt.current > 3000) {
      lastKpAt.current = Date.now();
      notifyTyping();
    }
  };

  const attach = async () => {
    const armed = viewOnceArmed;
    setViewOnceArmed(false);
    try {
      // Пир видит «отправляет медиа…», пока идёт загрузка.
      useAnoonStore.getState().notifyMediaSending();
      const picked = await pickAndUpload();
      if (!picked) return;
      await sendFriendMedia(
        picked.up,
        picked.kind,
        picked.extra,
        armed && picked.kind === 'image' ? { viewOnce: true } : undefined,
      );
    } catch {
      flash('Не удалось отправить');
    }
  };

  const leave = () => {
    closeChat();
    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="flex-row items-center gap-2.5 border-b border-border px-3 py-2.5">
          <Pressable accessibilityRole="button" accessibilityLabel="Назад" onPress={leave}>
            <ChevronLeftIcon size={24} />
          </Pressable>

          <View className="shrink-0">
            <AnoonAvatar
              initials={peerInitials}
              tone={activeChat?.avatarTone ?? 0}
              size={38}
              photoUrl={peerAvatarUrl}
            />
            {chatPeerOnline ? (
              <View className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background bg-online" />
            ) : null}
          </View>

          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-sm font-semibold text-foreground">
              {peerName}
            </Text>
            <Text
              numberOfLines={1}
              className={`text-xs ${chatPeerOnline || activity ? 'text-online' : 'text-muted-foreground'}`}>
              {activity === 'media' ? 'отправляет медиа…' : activity === 'typing' ? 'печатает…' : subtitle}
            </Text>
          </View>

          {/* Звонки: нет react-native-webrtc — кнопки видимо выключены. */}
          <View accessibilityState={{ disabled: true }} className="opacity-40">
            <PhoneIcon size={20} color={CHAT_COLORS.muted} />
          </View>
          <View accessibilityState={{ disabled: true }} className="opacity-40">
            <VideoIcon size={20} color={CHAT_COLORS.muted} />
          </View>

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
          viewed={chatViewed}
          activity={activity}
          top={
            rows.length === 0 ? (
              <View className="items-center">
                <Text className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
                  Нет сообщений — напишите первым
                </Text>
              </View>
            ) : undefined
          }
          onLongPressRow={setActionFor}
          onDoubleTapRow={(row) => {
            if (row.seq) void sendChatReaction(row.seq, '❤️');
          }}
          onViewOnceOpen={(seq) => seq != null && markChatViewed(seq)}
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
        />
      </KeyboardAvoidingView>

      <ChatMenu visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <ChatMenuItem
          label="Пожаловаться"
          icon={<ReportIcon size={18} color={CHAT_COLORS.muted} />}
          onPress={() => {
            setMenuOpen(false);
            router.push('/report');
          }}
        />
      </ChatMenu>

      <MessageActions
        row={actionFor}
        onReact={(row, emoji) => row.seq && void sendChatReaction(row.seq, emoji)}
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
        onDeleteMine={(row) => row.seq && void deleteChatMessage(row.seq, false)}
        onDeleteAll={(row) => row.seq && void deleteChatMessage(row.seq, true)}
        onClose={() => setActionFor(null)}
      />
    </SafeAreaView>
  );
}
