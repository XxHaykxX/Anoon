"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/avatar";
import { ChatComposer } from "@/components/chat-composer";
import { ChatMenu } from "@/components/chat-menu";
import { MediaLightbox, type LightboxItem } from "@/components/media-lightbox";
import { MessageRow } from "@/components/message-row";
import { RatingModal } from "@/components/rating-modal";
import { RevealPrompt } from "@/components/reveal-prompt";
import { sendRating } from "@/lib/api";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { useChat, type Msg, type ReplyRef } from "@/store/chat";
import { useModeration } from "@/store/moderation";
import { useSession } from "@/store/session";
import { cn } from "@/lib/utils";

const GENDER_LABEL: Record<string, string> = { male: "Мужчина", female: "Женщина" };

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const peer = params.id;
  const router = useRouter();
  const {
    byPeer,
    seed,
    connect,
    deleteMsg,
    markViewed,
    peerOnline,
    peerTyping,
    peerRecording,
    ended,
    endedAtLoad,
    clearEnded,
    friend,
    peerIdentity,
    requestFriend,
    acceptFriend,
    declineFriend,
  } = useChat();
  const myPublicId = useSession((s) => s.publicId);
  const ensureProfile = useSession((s) => s.ensureProfile);
  const blocked = useModeration((s) => s.isBlocked(peer));
  const blockPeer = useModeration((s) => s.blockPeer);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [onceItem, setOnceItem] = useState<LightboxItem | null>(null);
  const [reply, setReply] = useState<ReplyRef | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevFriendStatus = useRef(friend.status);

  const revealed = friend.status === "accepted";
  const fullName = [peerIdentity?.firstName, peerIdentity?.lastName].filter(Boolean).join(" ").trim();
  const genderLabel = peerIdentity?.realGender ? GENDER_LABEL[peerIdentity.realGender] : undefined;
  const identityCard = [peerIdentity?.ageBand, genderLabel].filter(Boolean).join(" · ");

  // Тосты по переходам статуса раскрытия: успех — у обоих; отказ — только у инициатора
  // (переход pending_me→none возможен ТОЛЬКО через приход friend_decline, не через свой клик).
  useEffect(() => {
    if (prevFriendStatus.current !== "accepted" && friend.status === "accepted") {
      setToast("Профили открыты — вы теперь друзья");
    } else if (prevFriendStatus.current === "pending_me" && friend.status === "none") {
      setToast("Запрос отклонён");
    }
    prevFriendStatus.current = friend.status;
  }, [friend.status]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // «Заблокировать» из баннера раскрытия — то же действие, что в ChatMenu (не дублируем UI).
  const onBlockFromReveal = () => {
    const ok = window.confirm("Заблокировать собеседника? Вы больше не будете видеть сообщения друг друга.");
    if (!ok) return;
    blockPeer(peer);
    router.push("/");
  };

  // Краткая цитата сообщения для ответа.
  const quote = (m: Msg): string =>
    m.text ?? (m.kind === "image" ? "📷 Фото" : m.kind === "video" ? "🎬 Видео" : "🎤 Голос");

  // Заблокированного собеседника не открываем — назад на экран поиска.
  useEffect(() => {
    if (blocked) router.replace("/");
  }, [blocked, router]);

  // Завершённый диалог (endedAt в БД) не открываем по ссылке — редирект на главную.
  useEffect(() => {
    if (endedAtLoad) router.replace("/");
  }, [endedAtLoad, router]);

  useEffect(() => {
    seed(peer);
  }, [peer, seed]);

  // Досинхронизировать профиль (если синк не прошёл) — иначе медиа не загрузится.
  useEffect(() => {
    void ensureProfile();
  }, [ensureProfile]);

  // Подключение к realtime-каналу диалога (broadcast/presence).
  useEffect(() => {
    if (blocked) return;
    const disconnect = connect(peer, myPublicId);
    return disconnect;
  }, [peer, myPublicId, blocked, connect]);

  const msgs = byPeer[peer] ?? [];

  // Медиа диалога для лайтбокса (свайп между ними).
  const mediaItems: LightboxItem[] = msgs
    .filter((m) => (m.kind === "image" || m.kind === "video") && m.url && !m.once)
    .map((m) => ({ kind: m.kind as "image" | "video", url: m.url! }));

  const openMedia = (item: LightboxItem) => {
    const i = mediaItems.findIndex((x) => x.url === item.url);
    setLightboxIndex(i >= 0 ? i : null);
  };

  // Открыть одноразовое медиа: показываем в отдельном просмотрщике; получатель — «расходует» просмотр.
  const onView = (m: Msg) => {
    if (!m.url) return;
    setOnceItem({ kind: m.kind === "video" ? "video" : "image", url: m.url });
    if (!m.mine) markViewed(peer, m.id);
  };

  // Оценить собеседника (опц.) и выйти на экран поиска.
  const rateAndLeave = async (rating?: number) => {
    if (rating != null && supabaseConfigured) {
      const { data } = await supabase.auth.getSession();
      const t = data.session?.access_token;
      if (t) await sendRating(peer, rating, t);
    }
    clearEnded();
    router.replace("/");
  };

  // Автоскролл к самому низу (новые сообщения снизу). На мобиле smooth-scrollIntoView
  // прерывается клавиатурой/сменой высоты медиа → скроллим контейнер напрямую через rAF.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const toBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    // Двойной rAF — дождаться раскладки после вставки сообщения/картинки.
    requestAnimationFrame(() => requestAnimationFrame(toBottom));
  }, [msgs.length, peerTyping, peerRecording]);

  if (blocked || endedAtLoad) return null; // редирект в эффекте; не мелькаем завершённым чатом

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-border pb-3 pl-[calc(env(safe-area-inset-left)+1rem)] pr-[calc(env(safe-area-inset-right)+1rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <Link href="/" className="flex h-9 w-9 items-center justify-center rounded-full text-fg-secondary hover:bg-surface-2" aria-label="Назад">
          <ArrowLeft size={20} />
        </Link>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={revealed ? "revealed" : "anon"}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex min-w-0 items-center gap-2.5"
          >
            {revealed ? <Avatar avatarUrl={peerIdentity?.avatarUrl ?? undefined} name={fullName} publicId={peer} size={36} /> : null}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{revealed ? fullName || `#${peer}` : "Собеседник"}</div>
              <div className="truncate font-mono text-xs text-fg-muted" aria-live="polite">
                {peerRecording ? (
                  <span className="text-accent">записывает голос…</span>
                ) : peerTyping ? (
                  <span className="text-accent">печатает…</span>
                ) : revealed ? (
                  identityCard || `#${peer}`
                ) : (
                  `#${peer}`
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
        <div className="ml-auto flex items-center gap-1.5">
          {!revealed ? (
            <button
              onClick={() => requestFriend(peer)}
              disabled={friend.status === "pending_me" || friend.status === "pending_peer"}
              className="min-h-9 rounded-full border border-white/10 bg-surface-2 px-3 text-xs font-medium text-fg-secondary transition hover:bg-white/5 disabled:opacity-50"
            >
              {friend.status === "pending_me" ? "Запрос отправлен" : "Раскрыть профиль"}
            </button>
          ) : null}
          <span
            className={cn("h-2 w-2 rounded-full", peerOnline ? "bg-success" : "bg-fg-muted")}
            title={peerOnline ? "онлайн" : "оффлайн"}
          />
          <ChatMenu peer={peer} />
        </div>
      </header>

      {friend.status === "pending_peer" ? (
        <div className="px-4 pt-3">
          <RevealPrompt peerPublicId={peer} onAccept={() => acceptFriend(peer)} onDecline={() => declineFriend(peer)} onBlock={onBlockFromReveal} />
        </div>
      ) : null}

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-4 py-4">
        <AnimatePresence initial={false}>
          {msgs.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <MessageRow
                m={m}
                onOpenMedia={openMedia}
                onView={onView}
                onReply={(msg) => setReply({ id: msg.id, text: quote(msg) })}
                onDelete={(msg) => deleteMsg(peer, msg.id)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={endRef} />
      </div>

      <ChatComposer peer={peer} reply={reply} onClearReply={() => setReply(null)} />

      <MediaLightbox
        items={mediaItems}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onIndex={setLightboxIndex}
      />

      {/* Одноразовый просмотрщик (отдельно от общей галереи) */}
      <MediaLightbox
        items={onceItem ? [onceItem] : []}
        index={onceItem ? 0 : null}
        onClose={() => setOnceItem(null)}
        onIndex={() => {}}
      />

      {ended ? <RatingModal by={ended} onRate={(r) => rateAndLeave(r)} onSkip={() => rateAndLeave()} /> : null}

      <AnimatePresence>
        {toast ? (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-surface-2 px-4 py-2 text-sm text-fg shadow-2xl"
          >
            {toast}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
