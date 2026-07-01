"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Flag, LogOut, MoreVertical, ShieldBan } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ReportDialog } from "@/components/report-dialog";
import { useChat } from "@/store/chat";
import { useModeration } from "@/store/moderation";

// Меню чата (три точки в хедере): «Пожаловаться» (диалог с причиной) и
// «Заблокировать» (confirm). Пишет в мок-стор src/store/moderation.ts.
export function ChatMenu({ peer }: { peer: string }) {
  const router = useRouter();
  const blockPeer = useModeration((s) => s.blockPeer);
  const endChat = useChat((s) => s.endChat);
  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onBlock = () => {
    setOpen(false);
    const ok = window.confirm("Заблокировать собеседника? Вы больше не будете видеть сообщения друг друга.");
    if (!ok) return;
    blockPeer(peer);
    router.push("/");
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Меню чата"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-2 hover:text-fg"
      >
        <MoreVertical size={20} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 top-12 z-20 w-56 overflow-hidden rounded-xl border border-border bg-surface-1 py-1 shadow-2xl"
          >
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                endChat(peer);
              }}
              className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left text-sm text-fg transition hover:bg-surface-2"
            >
              <LogOut size={16} /> Завершить разговор
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setReportOpen(true);
              }}
              className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left text-sm text-fg transition hover:bg-surface-2"
            >
              <Flag size={16} /> Пожаловаться
            </button>
            <button
              role="menuitem"
              onClick={onBlock}
              className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left text-sm text-danger transition hover:bg-surface-2"
            >
              <ShieldBan size={16} /> Заблокировать
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <ReportDialog peer={peer} open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}
