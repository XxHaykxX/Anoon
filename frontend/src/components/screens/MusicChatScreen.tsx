"use client";

import { useState } from "react";
import CallScreen from "@/components/CallScreen";
import RecordingBar from "@/components/RecordingBar";
import EmojiPicker from "@/components/EmojiPicker";
import {
  ChevronLeftIcon,
  PhoneIcon,
  VideoIcon,
  PlayIcon,
  PauseIcon,
  DownloadIcon,
  PlusIcon,
  EmojiIcon,
  MicIcon,
  CameraIcon,
  SendIcon,
} from "@/components/icons";

/* Calm, desaturated avatar gradient — shared visual language across screens. */
const AVATAR_GRADIENT_ROSE = "linear-gradient(135deg, #CE93A6 0%, #AC6C86 100%)";

const PRESS_FX = "active:scale-95 transition-transform cursor-pointer";

type TrackId = "midnight-signal" | "paper-boats" | "glass-orchard" | "low-tide-radio";

type TrackInfo = {
  name: string;
  artist: string;
};

const TRACKS: Record<TrackId, TrackInfo> = {
  "midnight-signal": { name: "Midnight Signal", artist: "The Corva" },
  "paper-boats": { name: "Paper Boats", artist: "Nils Vega" },
  "glass-orchard": { name: "Glass Orchard", artist: "Wren & Halcyon" },
  "low-tide-radio": { name: "Low Tide Radio", artist: "Sable June" },
};

const DEFAULT_NOW_PLAYING: TrackId = "midnight-signal";

type OutgoingMessage = {
  id: number;
  text: string;
  time: string;
};

function formatNow(): string {
  const d = new Date();
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const suffix = hours >= 12 ? "pm" : "am";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${suffix}`;
}

export default function MusicChatScreen() {
  const [playingId, setPlayingId] = useState<TrackId | null>(DEFAULT_NOW_PLAYING);
  const [draft, setDraft] = useState<string>("");
  const [messages, setMessages] = useState<OutgoingMessage[]>([]);
  const [call, setCall] = useState<null | "audio" | "video">(null);
  const [recording, setRecording] = useState<boolean>(false);
  const [emojiOpen, setEmojiOpen] = useState<boolean>(false);

  const togglePlay = (id: TrackId) => {
    setPlayingId((prev) => (prev === id ? null : id));
  };

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), text: trimmed, time: formatNow() },
    ]);
    setDraft("");
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  const nowPlayingId = playingId ?? DEFAULT_NOW_PLAYING;
  const nowPlayingTrack = TRACKS[nowPlayingId];
  const isBarPlaying = playingId !== null;

  return (
    <div className="relative w-full bg-background text-foreground flex flex-col h-full">
      {/* Top bar */}
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-3">
        <ChevronLeftIcon className={`size-6 text-foreground shrink-0 ${PRESS_FX}`} />
        <div
          className="size-9 rounded-full shrink-0 flex items-center justify-center"
          style={{ background: AVATAR_GRADIENT_ROSE }}
        >
          <span className="text-[11px] font-semibold text-white/95">PO</span>
        </div>
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-sm truncate">Priya Osei</span>
          <span className="text-xs text-online">online</span>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <PhoneIcon className={`size-6 text-foreground ${PRESS_FX}`} onClick={() => setCall("audio")} />
          <VideoIcon className={`size-6 text-foreground ${PRESS_FX}`} onClick={() => setCall("video")} />
        </div>
      </div>

      {/* Now playing bar */}
      <div className="px-4 py-2 bg-muted flex items-center gap-3">
        <div
          className={`size-9 shrink-0 rounded-full bg-primary grid place-items-center ${PRESS_FX}`}
          onClick={() => togglePlay(nowPlayingId)}
        >
          {isBarPlaying ? (
            <PauseIcon className="size-4 text-primary-foreground" />
          ) : (
            <PlayIcon className="size-4 text-primary-foreground" />
          )}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-medium truncate">{nowPlayingTrack.name}</span>
          <span className="text-xs text-muted-foreground truncate">{nowPlayingTrack.artist}</span>
          <div className="mt-1.5 w-full h-1 rounded-full bg-border overflow-hidden">
            <div
              className={`h-full w-[40%] rounded-full ${isBarPlaying ? "bg-primary" : "bg-muted-foreground/30"}`}
            />
          </div>
        </div>
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {/* incoming text */}
        <div className="self-start max-w-[260px] bg-bubble-in text-bubble-in-foreground rounded-2xl px-3.5 py-2">
          <span className="text-sm">have you heard the new Corva record yet?</span>
        </div>

        {/* outgoing text */}
        <div className="self-end max-w-[260px] bg-bubble-out text-bubble-out-foreground rounded-2xl px-3.5 py-2">
          <span className="text-sm">not yet, send me a track</span>
        </div>

        {/* incoming music card - active playing */}
        <div className="self-start w-[250px] rounded-2xl bg-bubble-in p-3 flex items-center gap-3">
          <div
            className={`relative size-11 shrink-0 rounded-lg bg-muted grid place-items-center ${PRESS_FX}`}
            onClick={() => togglePlay("midnight-signal")}
          >
            {playingId === "midnight-signal" ? (
              <PauseIcon className="size-4 text-foreground" />
            ) : (
              <PlayIcon className="size-4 text-foreground" />
            )}
          </div>
          <div className="flex flex-col min-w-0 flex-1 gap-1">
            <span className="text-sm font-medium truncate">Midnight Signal</span>
            <span className="text-xs text-muted-foreground truncate">The Corva</span>
            <div className="w-full h-0.5 rounded-full bg-border overflow-hidden">
              <div
                className={`h-full w-[40%] rounded-full ${playingId === "midnight-signal" ? "bg-primary" : "bg-muted-foreground/30"}`}
              />
            </div>
          </div>
          <span className="text-[11px] text-muted-foreground shrink-0">3:42</span>
        </div>

        {/* outgoing text */}
        <div className="self-end max-w-[260px] bg-bubble-out text-bubble-out-foreground rounded-2xl px-3.5 py-2">
          <span className="text-sm">this one is so good, listen to the bridge</span>
        </div>

        {/* incoming music card */}
        <div className="self-start w-[250px] rounded-2xl bg-bubble-in p-3 flex items-center gap-3">
          <div
            className={`relative size-11 shrink-0 rounded-lg bg-muted grid place-items-center ${PRESS_FX}`}
            onClick={() => togglePlay("paper-boats")}
          >
            {playingId === "paper-boats" ? (
              <PauseIcon className="size-4 text-foreground" />
            ) : (
              <PlayIcon className="size-4 text-foreground" />
            )}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-medium truncate">Paper Boats</span>
            <span className="text-xs text-muted-foreground truncate">Nils Vega</span>
            {playingId === "paper-boats" && (
              <div className="mt-1 w-full h-0.5 rounded-full bg-border overflow-hidden">
                <div className="h-full w-[40%] rounded-full bg-primary" />
              </div>
            )}
          </div>
          <button
            type="button"
            className={`size-8 shrink-0 rounded-full bg-muted grid place-items-center ${PRESS_FX}`}
          >
            <DownloadIcon className="size-4 text-foreground" />
          </button>
        </div>

        {/* date chip */}
        <span className="self-center my-1 text-xs text-muted-foreground bg-muted rounded-full px-3 py-1">
          Today
        </span>

        {/* outgoing music card (shared) */}
        <div className="self-end w-[250px] rounded-2xl bg-card border border-border p-3 flex items-center gap-3">
          <div
            className={`relative size-11 shrink-0 rounded-lg bg-muted grid place-items-center ${PRESS_FX}`}
            onClick={() => togglePlay("glass-orchard")}
          >
            {playingId === "glass-orchard" ? (
              <PauseIcon className="size-4 text-foreground" />
            ) : (
              <PlayIcon className="size-4 text-foreground" />
            )}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-medium truncate">Glass Orchard</span>
            <span className="text-xs text-muted-foreground truncate">Wren &amp; Halcyon</span>
            <span className="text-[11px] text-muted-foreground">2:58</span>
            {playingId === "glass-orchard" && (
              <div className="mt-1 w-full h-0.5 rounded-full bg-border overflow-hidden">
                <div className="h-full w-[40%] rounded-full bg-primary" />
              </div>
            )}
          </div>
          <button
            type="button"
            className={`size-8 shrink-0 rounded-full bg-primary grid place-items-center ${PRESS_FX}`}
            onClick={() => togglePlay("glass-orchard")}
          >
            {playingId === "glass-orchard" ? (
              <PauseIcon className="size-4 text-primary-foreground" />
            ) : (
              <PlayIcon className="size-4 text-primary-foreground" />
            )}
          </button>
        </div>

        {/* incoming text */}
        <div className="self-start max-w-[260px] bg-bubble-in text-bubble-in-foreground rounded-2xl px-3.5 py-2">
          <span className="text-sm">okay this one is going straight to my playlist</span>
        </div>

        {/* outgoing music card */}
        <div className="self-end w-[250px] rounded-2xl bg-card border border-border p-3 flex items-center gap-3">
          <div
            className={`relative size-11 shrink-0 rounded-lg bg-muted grid place-items-center ${PRESS_FX}`}
            onClick={() => togglePlay("low-tide-radio")}
          >
            {playingId === "low-tide-radio" ? (
              <PauseIcon className="size-4 text-foreground" />
            ) : (
              <PlayIcon className="size-4 text-foreground" />
            )}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-medium truncate">Low Tide Radio</span>
            <span className="text-xs text-muted-foreground truncate">Sable June</span>
            <span className="text-[11px] text-muted-foreground">4:07</span>
            {playingId === "low-tide-radio" && (
              <div className="mt-1 w-full h-0.5 rounded-full bg-border overflow-hidden">
                <div className="h-full w-[40%] rounded-full bg-primary" />
              </div>
            )}
          </div>
          <button
            type="button"
            className={`size-8 shrink-0 rounded-full bg-muted grid place-items-center ${PRESS_FX}`}
          >
            <DownloadIcon className="size-4 text-foreground" />
          </button>
        </div>

        {/* newly-sent outgoing messages */}
        {messages.map((message) => (
          <div
            key={message.id}
            className="anoon-msg-in self-end max-w-[260px] bg-bubble-out text-bubble-out-foreground rounded-2xl px-3.5 py-2 flex items-end gap-1.5"
          >
            <span className="text-sm">{message.text}</span>
            <span className="text-[11px] text-bubble-out-foreground/60 shrink-0">{message.time}</span>
          </div>
        ))}
      </div>

      {/* Composer (or recording bar) */}
      {recording ? (
        <RecordingBar
          onSend={(durationSec) => {
            setMessages((prev) => [
              ...prev,
              { id: Date.now(), text: `🎤 Voice message (${durationSec}s)`, time: formatNow() },
            ]);
            setRecording(false);
          }}
          onCancel={() => setRecording(false)}
        />
      ) : (
        <div className="border-t border-border px-3 py-2.5 flex items-center gap-2">
          <PlusIcon className={`size-6 text-muted-foreground shrink-0 ${PRESS_FX}`} />
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Message"
            className="flex-1 rounded-full bg-muted px-4 py-2 text-foreground text-sm placeholder:text-muted-foreground outline-none"
          />
          <EmojiIcon
            className={`size-6 text-muted-foreground shrink-0 ${PRESS_FX}`}
            onClick={() => setEmojiOpen((v) => !v)}
          />
          {draft.trim().length > 0 ? (
            <button
              type="button"
              onClick={handleSend}
              className={`size-6 shrink-0 text-primary ${PRESS_FX}`}
              aria-label="Send message"
            >
              <SendIcon className="size-6" />
            </button>
          ) : (
            <MicIcon
              className={`size-6 text-muted-foreground shrink-0 ${PRESS_FX}`}
              onClick={() => setRecording(true)}
            />
          )}
          <CameraIcon className={`size-6 text-muted-foreground shrink-0 ${PRESS_FX}`} />
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

      {call !== null && (
        <CallScreen name="Priya Osei" video={call === "video"} onEnd={() => setCall(null)} />
      )}
    </div>
  );
}
