"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/avatar";
import { ChatComposer } from "@/components/chat-composer";
import { MediaLightbox, type LightboxItem } from "@/components/media-lightbox";
import { MessageRow } from "@/components/message-row";
import { isOnline, presenceLabel } from "@/lib/last-seen";
import { useRequireAccount } from "@/lib/use-require-account";
import { useChat, type Msg, type ReplyRef } from "@/store/chat";
import { useModeration } from "@/store/moderation";
import { useSession } from "@/store/session";

// Постоянная личка друзей. Те же компоненты, что и чат рулетки, но: канал anoon:dm:,
// kind="friend", без rating/end (личку не завершают), header всегда раскрыт (друг виден).
export default function DmPage() {
  const gate = useRequireAccount();
  const params = useParams<{ id: string }>();
  const peer = params.id;
  const router = useRouter();

  const { byPeer, seed, connect, deleteMsg, markViewed, peerOnline, peerTyping, peerRecording, friend, peerIdentity, setReaction } = useChat();
  const myPublicId = useSession((s) => s.publicId);
  const ensureProfile = useSession((s) => s.ensureProfile);
  const blocked = useModeration((s) => s.isBlocked(peer));

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [onceItem, setOnceItem] = useState<LightboxItem | null>(null);
  const [reply, setReply] = useState<ReplyRef | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Личка живёт в отдельном бакете истории (dm:${peer}) — не смешивается с рулеткой той же пары.
  const msgs = byPeer[`dm:${peer}`] ?? [];

  const fullName = [peerIdentity?.firstName, peerIdentity?.lastName].filter(Boolean).join(" ").trim();
  const title = fullName || peerIdentity?.nickname || `#${peer}`;
  // Онлайн — из ЖИВОГО presence канала лички (peerOnline), с фолбэком на снапшот lastSeen.
  const online = peerOnline || isOnline(peerIdentity?.lastSeen);
  const statusText = peerOnline ? "в сети" : presenceLabel(peerIdentity?.lastSeen);

  const quote = (m: Msg): string =>
    m.text ?? (m.kind === "image" ? "📷 Фото" : m.kind === "video" ? "🎬 Видео" : "🎤 Голос");

  useEffect(() => {
    if (blocked) router.replace("/friends");
  }, [blocked, router]);

  useEffect(() => {
    seed(peer, "friend");
  }, [peer, seed]);

  useEffect(() => {
    void ensureProfile();
  }, [ensureProfile]);

  // Подключение к каналу лички (kind=friend). Сервер гейтит историю по Friendship.accepted.
  useEffect(() => {
    if (gate !== "ready" || blocked) return;
    const disconnect = connect(peer, myPublicId, { kind: "friend" });
    return disconnect;
  }, [gate, peer, myPublicId, blocked, connect]);

  // Расфренд/не-друг: после гидрации статус не accepted → личка недоступна (unfriend-гейт).
  // friend.status приходит из fetchHistory; редиректим на список друзей.
  useEffect(() => {
    if (gate === "ready" && (friend.status === "none" || friend.status === "pending_me" || friend.status === "pending_peer")) {
      // даём кадр на гидрацию: если реально не друг — уводим
      const t = setTimeout(() => {
        if (useChat.getState().friend.status !== "accepted") router.replace("/friends");
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [gate, friend.status, router]);

  const mediaItems: LightboxItem[] = msgs
    .filter((m) => (m.kind === "image" || m.kind === "video") && m.url && !m.once)
    .map((m) => ({ kind: m.kind as "image" | "video", url: m.url! }));

  const openMedia = (item: LightboxItem) => {
    const i = mediaItems.findIndex((x) => x.url === item.url);
    setLightboxIndex(i >= 0 ? i : null);
  };

  const onView = (m: Msg) => {
    if (!m.url) return;
    setOnceItem({ kind: m.kind === "video" ? "video" : "image", url: m.url });
    if (!m.mine) markViewed(peer, m.id);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const toBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    requestAnimationFrame(() => requestAnimationFrame(toBottom));
  }, [msgs.length, peerTyping, peerRecording]);

  if (gate !== "ready" || blocked) return null;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-border pb-3 pl-[calc(env(safe-area-inset-left)+1rem)] pr-[calc(env(safe-area-inset-right)+1rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <button
          onClick={() => router.push("/friends")}
          className="flex h-9 w-9 items-center justify-center rounded-full text-fg-secondary hover:bg-surface-2"
          aria-label="Назад"
        >
          <ArrowLeft size={20} />
        </button>
        <Avatar avatarUrl={peerIdentity?.avatarUrl ?? undefined} name={fullName} publicId={peer} size={36} online={online} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="truncate text-xs" aria-live="polite">
            {peerRecording ? (
              <span className="text-accent">записывает голос…</span>
            ) : peerTyping ? (
              <span className="text-accent">печатает…</span>
            ) : (
              <span className={online ? "text-success" : "text-fg-muted"}>{statusText}</span>
            )}
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-4 py-4">
        {msgs.length === 0 ? (
          <p className="pt-10 text-center text-sm text-fg-muted">Начните переписку с {title}</p>
        ) : null}
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
                onReact={(msg, emoji) => setReaction(peer, msg.id, emoji)}
                myPublicId={myPublicId}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <ChatComposer peer={peer} reply={reply} onClearReply={() => setReply(null)} />

      <MediaLightbox items={mediaItems} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onIndex={setLightboxIndex} />
      <MediaLightbox items={onceItem ? [onceItem] : []} index={onceItem ? 0 : null} onClose={() => setOnceItem(null)} onIndex={() => {}} />
    </div>
  );
}
