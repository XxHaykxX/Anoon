"use client";

import { useState } from "react";
import VoiceMessage from "@/components/VoiceMessage";
import RecordingBar from "@/components/RecordingBar";
import EmojiPicker from "@/components/EmojiPicker";
import {
  ChevronLeftIcon,
  PlusIcon,
  EmojiIcon,
  MicIcon,
  SendIcon,
  DoubleCheckIcon,
} from "@/components/icons";

/* Calm, desaturated avatar gradient — shared visual language across screens. */
const AVATAR_GRADIENT_SLATE = "linear-gradient(135deg, #8E9BC0 0%, #5F6F9E 100%)";
const PRESS_FX = "active:scale-95 transition-transform cursor-pointer";

type Bubble = {
  id: number;
  text: string;
  time: string;
  own: boolean;
};

const SEED_BUBBLES: Bubble[] = [
  { id: 1, text: "ok", time: "18:02", own: false },
  { id: 2, text: "Говорить можешь?", time: "18:02", own: true },
  { id: 3, text: "не", time: "18:03", own: false },
];

function formatNow(): string {
  const d = new Date();
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function TextBubble({ bubble }: { bubble: Bubble }) {
  if (bubble.own) {
    return (
      <div className="anoon-msg-in self-end max-w-[75%] rounded-2xl bg-bubble-out px-3.5 py-2 text-bubble-out-foreground flex items-end gap-1.5">
        <span className="text-sm">{bubble.text}</span>
        <span className="flex items-center gap-1 shrink-0 text-[11px] text-bubble-out-foreground/60">
          {bubble.time}
          <DoubleCheckIcon className="size-4" />
        </span>
      </div>
    );
  }
  return (
    <div className="anoon-msg-in self-start max-w-[75%] rounded-2xl bg-bubble-in px-3.5 py-2 text-bubble-in-foreground flex items-end gap-1.5">
      <span className="text-sm">{bubble.text}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{bubble.time}</span>
    </div>
  );
}

export default function VoiceChatScreen() {
  const [draft, setDraft] = useState<string>("");
  const [recording, setRecording] = useState<boolean>(false);
  const [emojiOpen, setEmojiOpen] = useState<boolean>(false);
  const [sent, setSent] = useState<Bubble[]>([]);

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSent((prev) => [
      ...prev,
      { id: Date.now(), text: trimmed, time: formatNow(), own: true },
    ]);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      {/* Top bar — centered title, avatar on the right (design #2) */}
      <div className="relative flex items-center border-b border-border px-4 py-2.5">
        <button
          type="button"
          className={`flex items-center gap-0.5 text-foreground ${PRESS_FX}`}
          aria-label="Back to chats"
        >
          <ChevronLeftIcon className="size-6" />
          <span className="text-sm font-medium">Chats</span>
        </button>

        <div className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center leading-tight">
          <span className="text-sm font-semibold">Rudoy</span>
          <span className="text-xs text-muted-foreground">Online</span>
        </div>

        <div
          className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: AVATAR_GRADIENT_SLATE }}
        >
          <span className="text-[11px] font-semibold text-white/95">R</span>
        </div>
      </div>

      {/* Message thread */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden px-4 py-4">
        {SEED_BUBBLES.map((bubble) => (
          <TextBubble key={bubble.id} bubble={bubble} />
        ))}

        {/* prominent voice message (own, brand yellow) */}
        <VoiceMessage durationSec={10} own className="max-w-[80%]" />

        {/* newly-sent outgoing messages appear after the voice note */}
        {sent.map((bubble) => (
          <TextBubble key={bubble.id} bubble={bubble} />
        ))}
      </div>

      {/* Composer (or recording bar) */}
      {recording ? (
        <RecordingBar
          onSend={(durationSec) => {
            setSent((prev) => [
              ...prev,
              { id: Date.now(), text: `🎤 Голосовое (${durationSec}с)`, time: formatNow(), own: true },
            ]);
            setRecording(false);
          }}
          onCancel={() => setRecording(false)}
        />
      ) : (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
          <PlusIcon className={`size-6 shrink-0 text-muted-foreground ${PRESS_FX}`} />
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Сообщение"
            className="flex-1 rounded-full bg-muted px-4 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <EmojiIcon
            className={`size-6 shrink-0 text-muted-foreground ${PRESS_FX}`}
            onClick={() => setEmojiOpen((v) => !v)}
          />
          {draft.trim().length > 0 ? (
            <button
              type="button"
              onClick={handleSend}
              className={`size-6 shrink-0 text-primary ${PRESS_FX}`}
              aria-label="Отправить"
            >
              <SendIcon className="size-6" />
            </button>
          ) : (
            <MicIcon
              className={`size-6 shrink-0 text-muted-foreground ${PRESS_FX}`}
              onClick={() => setRecording(true)}
            />
          )}
        </div>
      )}

      {emojiOpen && (
        <div className="absolute bottom-16 left-2 z-30">
          <EmojiPicker
            onSelect={(emoji) => setDraft((d) => d + emoji)}
            onClose={() => setEmojiOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
