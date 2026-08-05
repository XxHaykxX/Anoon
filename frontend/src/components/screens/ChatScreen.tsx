"use client";

import { useState } from "react";
import VoiceMessage from "@/components/VoiceMessage";
import MediaBubble from "@/components/MediaBubble";
import RecordingBar from "@/components/RecordingBar";
import CallScreen from "@/components/CallScreen";
import EmojiPicker from "@/components/EmojiPicker";
import AttachMenu from "@/components/AttachMenu";
import ImageViewer from "@/components/ImageViewer";
import MediaPreview from "@/components/MediaPreview";
import {
  ChevronLeftIcon,
  PhoneIcon,
  VideoIcon,
  PlusIcon,
  EmojiIcon,
  MicIcon,
  CameraIcon,
  DownloadIcon,
  CloseIcon,
  DoubleCheckIcon,
  MissedCallIcon,
  SendIcon,
  CheckIcon,
  PlayIcon,
  SortLinesIcon,
} from "@/components/icons";

/* Calm, desaturated avatar gradient — shared visual language across screens. */
const AVATAR_GRADIENT_SLATE = "linear-gradient(135deg, #8E9BC0 0%, #5F6F9E 100%)";

const PRESS_FX = "active:scale-95 transition-transform cursor-pointer";

type OutgoingMessage = {
  id: number;
  text: string;
  time: string;
};

type FileKey = "resources" | "design" | "app";

type FileDownloadState = "idle" | "downloading" | "paused" | "done";

function formatNow(): string {
  const d = new Date();
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const suffix = hours >= 12 ? "pm" : "am";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${suffix}`;
}

export default function ChatScreen() {
  const [draft, setDraft] = useState<string>("");
  const [messages, setMessages] = useState<OutgoingMessage[]>([]);
  const [fileStates, setFileStates] = useState<Record<FileKey, FileDownloadState>>({
    resources: "downloading",
    design: "idle",
    app: "idle",
  });
  const [recording, setRecording] = useState<boolean>(false);
  const [call, setCall] = useState<null | "audio" | "video">(null);
  const [emojiOpen, setEmojiOpen] = useState<boolean>(false);
  const [attachOpen, setAttachOpen] = useState<boolean>(false);
  const [viewerOpen, setViewerOpen] = useState<boolean>(false);
  const [previewOpen, setPreviewOpen] = useState<boolean>(false);

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

  const toggleDownload = (key: FileKey) => {
    setFileStates((prev) => {
      const current = prev[key];
      let next: FileDownloadState;
      if (current === "idle") next = "downloading";
      else if (current === "downloading") next = "done";
      else if (current === "paused") next = "downloading";
      else next = "done";
      return { ...prev, [key]: next };
    });
  };

  const togglePause = (key: FileKey) => {
    setFileStates((prev) => {
      const current = prev[key];
      const next: FileDownloadState = current === "paused" ? "downloading" : "paused";
      return { ...prev, [key]: next };
    });
  };

  return (
    <div className="relative w-full bg-background text-foreground flex flex-col h-full">
      {/* Top bar (design #1 — back + unread badge, avatar, name, call actions) */}
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-3">
        <div className={`flex items-center gap-1 shrink-0 text-foreground ${PRESS_FX}`}>
          <ChevronLeftIcon className="size-6" />
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
            6
          </span>
        </div>
        <div
          className="size-9 rounded-full shrink-0 flex items-center justify-center"
          style={{ background: AVATAR_GRADIENT_SLATE }}
        >
          <span className="text-[11px] font-semibold text-white/95">NB</span>
        </div>
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-sm truncate">Nora Bennett</span>
          <span className="text-xs text-muted-foreground">last seen at 10:46 am</span>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <PhoneIcon className={`size-6 text-foreground ${PRESS_FX}`} onClick={() => setCall("audio")} />
          <VideoIcon className={`size-6 text-foreground ${PRESS_FX}`} onClick={() => setCall("video")} />
        </div>
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 flex flex-col gap-2">
        {/* incoming photo (already received) */}
        <MediaBubble
          kind="photo"
          aspectClassName="aspect-[4/3]"
          timeLabel="12:36 pm"
          initialLoaded
          onOpen={() => setViewerOpen(true)}
        />

        {/* small pill */}
        <div className="self-start bg-muted rounded-full px-3 py-1 text-xs text-muted-foreground">
          or 12:37 pm
        </div>

        {/* incoming large file / video — tap to download */}
        <MediaBubble
          kind="photo"
          aspectClassName="aspect-[4/3]"
          sizeLabel="96Mb"
          timeLabel="12:37 pm"
          onOpen={() => setViewerOpen(true)}
        />

        {/* file-row cards */}
        <div className="self-start w-[240px] rounded-2xl bg-card border border-border p-3 flex items-center gap-3">
          <div
            className={`relative size-10 shrink-0 rounded-full border border-border grid place-items-center ${PRESS_FX}`}
            onClick={() => togglePause("resources")}
          >
            {fileStates.resources === "done" ? (
              <CheckIcon className="size-5 text-primary" />
            ) : (
              <>
                <svg className="absolute inset-0 size-10 -rotate-90 text-primary" viewBox="0 0 36 36" fill="none">
                  <circle
                    cx="18"
                    cy="18"
                    r="16"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeDasharray="100"
                    strokeDashoffset="40"
                    strokeLinecap="round"
                  />
                </svg>
                {fileStates.resources === "paused" ? (
                  <PlayIcon className="size-4 text-foreground" />
                ) : (
                  <CloseIcon className="size-4 text-foreground" />
                )}
              </>
            )}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-medium truncate">Resources.zip</span>
            <span className="text-xs text-muted-foreground">
              {fileStates.resources === "done"
                ? "Downloaded"
                : fileStates.resources === "paused"
                  ? "Paused"
                  : "324Mb"}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground shrink-0">12:41 pm</span>
        </div>

        <div className="self-start w-[240px] rounded-2xl bg-card border border-border p-3 flex items-center gap-3">
          <div
            className={`size-10 shrink-0 rounded-full border border-border grid place-items-center ${PRESS_FX}`}
            onClick={() => toggleDownload("design")}
          >
            {fileStates.design === "done" ? (
              <CheckIcon className="size-5 text-primary" />
            ) : (
              <DownloadIcon className="size-5 text-foreground" />
            )}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-medium truncate">Design.zip</span>
            <span className="text-xs text-muted-foreground">
              {fileStates.design === "done"
                ? "Downloaded"
                : fileStates.design === "downloading"
                  ? "downloading…"
                  : "538Mb"}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground shrink-0">12:42 pm</span>
        </div>

        <div className="self-start w-[240px] rounded-2xl bg-card border border-border p-3 flex items-center gap-3">
          <div
            className={`size-10 shrink-0 rounded-full border border-border grid place-items-center ${PRESS_FX}`}
            onClick={() => toggleDownload("app")}
          >
            {fileStates.app === "done" ? (
              <CheckIcon className="size-5 text-primary" />
            ) : (
              <DownloadIcon className="size-5 text-foreground" />
            )}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-medium truncate">App.zip</span>
            <span className="text-xs text-muted-foreground">
              {fileStates.app === "done"
                ? "Downloaded"
                : fileStates.app === "downloading"
                  ? "downloading…"
                  : "246Mb"}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground shrink-0">12:43 pm</span>
        </div>

        {/* outgoing bubble */}
        <div className="self-end bg-bubble-out text-bubble-out-foreground rounded-2xl px-3.5 py-2 flex items-end gap-1.5">
          <span className="text-sm">Thanks!</span>
          <span className="flex items-center gap-1 text-[11px] text-bubble-out-foreground/60 shrink-0">
            12:44 pm
            <DoubleCheckIcon className="size-4" />
          </span>
        </div>

        {/* date divider */}
        <span className="text-xs text-muted-foreground self-center my-1">June 3</span>

        {/* missed-call card */}
        <div className="self-start w-full rounded-2xl bg-card border border-border px-3.5 py-2.5 flex items-center gap-3">
          <MissedCallIcon className="size-5 text-destructive shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-destructive">Missed call</span>
            <span className="text-xs text-muted-foreground">10:45 am</span>
          </div>
          <PhoneIcon className={`size-5 text-foreground ml-auto shrink-0 ${PRESS_FX}`} />
        </div>

        {/* voice messages (animated waveform) */}
        <VoiceMessage durationSec={14} />
        <VoiceMessage durationSec={9} own />

        {/* newly-sent outgoing messages */}
        {messages.map((message) => (
          <div
            key={message.id}
            className="anoon-msg-in self-end bg-bubble-out text-bubble-out-foreground rounded-2xl px-3.5 py-2 flex items-end gap-1.5"
          >
            <span className="text-sm">{message.text}</span>
            <span className="flex items-center gap-1 text-[11px] text-bubble-out-foreground/60 shrink-0">
              {message.time}
              <DoubleCheckIcon className="size-4" />
            </span>
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
          <PlusIcon className={`size-6 text-muted-foreground shrink-0 ${PRESS_FX}`} onClick={() => setAttachOpen(true)} />
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Message"
            className="flex-1 rounded-full bg-muted px-4 py-2 text-foreground text-sm placeholder:text-muted-foreground outline-none"
          />
          <EmojiIcon className={`size-6 text-muted-foreground shrink-0 ${PRESS_FX}`} onClick={() => setEmojiOpen((v) => !v)} />
          {draft.trim().length > 0 ? (
            <button
              type="button"
              onClick={handleSend}
              disabled={draft.trim().length === 0}
              className={`size-6 shrink-0 text-primary ${PRESS_FX} disabled:opacity-50 disabled:pointer-events-none`}
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
          <CameraIcon
            className={`size-6 text-muted-foreground shrink-0 ${PRESS_FX}`}
            onClick={() => setPreviewOpen(true)}
          />
          <SortLinesIcon className={`size-6 text-muted-foreground shrink-0 ${PRESS_FX}`} />
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

      {attachOpen && <AttachMenu onSelect={() => setAttachOpen(false)} onClose={() => setAttachOpen(false)} />}

      {viewerOpen && <ImageViewer index={1} total={1} onClose={() => setViewerOpen(false)} />}

      {previewOpen && (
        <MediaPreview
          onSend={() => {
            setMessages((prev) => [
              ...prev,
              { id: Date.now(), text: "📷 Photo", time: formatNow() },
            ]);
          }}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {call !== null && (
        <CallScreen
          name="Nora Bennett"
          video={call === "video"}
          onEnd={() => setCall(null)}
        />
      )}
    </div>
  );
}
