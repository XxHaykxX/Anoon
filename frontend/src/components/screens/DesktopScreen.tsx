"use client";

import { useState } from "react";
import TypingDots from "@/components/TypingDots";
import CallScreen from "@/components/CallScreen";
import RecordingBar from "@/components/RecordingBar";
import EmojiPicker from "@/components/EmojiPicker";
import {
  SearchIcon,
  PlusIcon,
  UserCircleIcon,
  BookmarkIcon,
  PhoneIcon,
  VideoIcon,
  EmojiIcon,
  MicIcon,
  CameraIcon,
  PinIcon,
  ChatIcon,
  BotIcon,
  MegaphoneIcon,
  BoltIcon,
  LockIcon,
  DoubleCheckIcon,
} from "@/components/icons";

/* Calm, desaturated avatar gradients — shared visual language across screens. */
const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #8E9BC0 0%, #5F6F9E 100%)", // slate
  "linear-gradient(135deg, #93BEA0 0%, #64977B 100%)", // sage
  "linear-gradient(135deg, #CE93A6 0%, #AC6C86 100%)", // rose
  "linear-gradient(135deg, #E7B75F 0%, #C98F3B 100%)", // amber
  "linear-gradient(135deg, #A995C9 0%, #7F68A8 100%)", // violet
  "linear-gradient(135deg, #86B7BD 0%, #5D939B 100%)", // teal
] as const;

/* Shared press-feedback classes for clickable icons/tabs. */
const PRESSABLE = "active:scale-95 transition-transform cursor-pointer";

interface DesktopChatRow {
  id: string;
  name: string;
  secret?: boolean;
  preview: string;
  typing?: boolean;
  time: string;
  initials: string;
  tone: number;
  unread?: number;
  pinned?: boolean;
  selected?: boolean;
}

interface OutgoingMessage {
  id: string;
  text: string;
  time: string;
}

const chatRows: DesktopChatRow[] = [
  {
    id: "1",
    name: "Maya Whitfield",
    preview: "You: sounds good, see you at 7",
    time: "26 mins",
    initials: "MW",
    tone: 0,
    unread: 6,
    selected: true,
  },
  {
    id: "2",
    name: "Dev Team Standup",
    preview: "Oren: pushed the fix, can you review?",
    time: "10:48 pm",
    initials: "DT",
    tone: 5,
    pinned: true,
  },
  {
    id: "3",
    name: "Priya Nakamura",
    preview: "typing",
    typing: true,
    time: "12:02 pm",
    initials: "PN",
    tone: 2,
  },
  {
    id: "4",
    name: "Family Circle",
    preview: "Grandma: don't forget the cake!",
    time: "Sun",
    initials: "FC",
    tone: 3,
    unread: 2,
  },
  {
    id: "5",
    name: "Confidential Client",
    secret: true,
    preview: "Voice message",
    time: "Sat",
    initials: "CC",
    tone: 4,
  },
  {
    id: "6",
    name: "Lucas Bergman",
    preview: "Missed Call",
    time: "9:14 am",
    initials: "LB",
    tone: 1,
  },
  {
    id: "7",
    name: "Weekend Hikers",
    preview: "You: I'll bring the extra water bottles",
    time: "Fri",
    initials: "WH",
    tone: 5,
  },
  {
    id: "8",
    name: "Amara Costa",
    preview: "Just landed, calling you in a bit",
    time: "Thu",
    initials: "AC",
    tone: 2,
    unread: 1,
  },
];

function getCurrentTime(): string {
  return new Date()
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
}

function ChatListRow({
  row,
  selected,
  onSelect,
}: {
  row: DesktopChatRow;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      onClick={() => onSelect(row.id)}
      className={`flex items-center gap-3 px-4 py-3 ${PRESSABLE} ${
        selected ? "bg-muted" : ""
      }`}
    >
      <div
        className="shrink-0 size-11 rounded-full flex items-center justify-center"
        style={{ background: AVATAR_GRADIENTS[row.tone % AVATAR_GRADIENTS.length] }}
      >
        <span className="text-sm font-semibold text-white/95">
          {row.initials}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          {row.secret ? (
            <LockIcon className="size-3.5 text-muted-foreground shrink-0" />
          ) : null}
          <span className="font-semibold truncate">{row.name}</span>
        </div>
        {row.typing ? (
          <span className="flex h-5 items-center gap-1.5 text-primary">
            <TypingDots className="text-primary" />
            <span className="text-xs font-medium">typing</span>
          </span>
        ) : (
          <p className="text-sm text-muted-foreground truncate">{row.preview}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-xs text-muted-foreground">{row.time}</span>
        {row.unread ? (
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold">
            {row.unread}
          </span>
        ) : row.pinned ? (
          <PinIcon className="size-4 text-muted-foreground" />
        ) : (
          <div className="h-5" />
        )}
      </div>
    </div>
  );
}

type ThreadItem =
  | { kind: "day"; label: string }
  | { kind: "msg"; side: "in" | "out"; text: string; time?: string };

function genericThread(first: string): ThreadItem[] {
  return [
    { kind: "day", label: "Today" },
    { kind: "msg", side: "in", text: `Hey, it's ${first} — you around?` },
    { kind: "msg", side: "out", text: "Yep, what's up?", time: "9:12 am" },
    { kind: "msg", side: "in", text: "Wanted to check in on the plan for later." },
    { kind: "msg", side: "out", text: "All set on my end 👍", time: "9:16 am" },
  ];
}

const THREADS: Record<string, ThreadItem[]> = {
  "1": [
    { kind: "day", label: "Today" },
    { kind: "msg", side: "in", text: "Hey! Did you get a chance to look at the deck?" },
    { kind: "msg", side: "out", text: "Yep, just finished. Looks really solid overall.", time: "9:12 am" },
    { kind: "msg", side: "in", text: "Nice. Any changes needed before the client call?" },
    { kind: "msg", side: "out", text: "Maybe tighten up slide 4, the numbers feel a bit cramped.", time: "9:14 am" },
    { kind: "msg", side: "in", text: "Good call, I'll clean that up now." },
    { kind: "msg", side: "in", text: "Sending you the updated version in a bit." },
    { kind: "msg", side: "out", text: "Perfect, thank you!", time: "9:16 am" },
    { kind: "day", label: "11:40 am" },
    { kind: "msg", side: "in", text: "Deck's updated, take a look whenever you're free." },
    { kind: "msg", side: "out", text: "On it now, sounds good, see you at 7", time: "11:42 am" },
  ],
  "2": [
    { kind: "day", label: "Today" },
    { kind: "msg", side: "in", text: "Oren: pushed the fix for the flaky test." },
    { kind: "msg", side: "in", text: "Oren: can you review when you get a sec?" },
    { kind: "msg", side: "out", text: "Looking now.", time: "10:41 pm" },
    { kind: "msg", side: "out", text: "LGTM, merging. Nice one 🚀", time: "10:48 pm" },
  ],
  "3": [
    { kind: "day", label: "Today" },
    { kind: "msg", side: "out", text: "Did the venue confirm for Saturday?", time: "11:58 am" },
    { kind: "msg", side: "in", text: "Yes! Just got the email." },
    { kind: "msg", side: "in", text: "Sending over the details now…" },
  ],
  "4": [
    { kind: "day", label: "Sunday" },
    { kind: "msg", side: "in", text: "Grandma: don't forget the cake! 🎂" },
    { kind: "msg", side: "out", text: "Already ordered it 😄", time: "4:12 pm" },
    { kind: "msg", side: "in", text: "You're the best ❤️" },
  ],
};

export default function DesktopScreen() {
  const defaultSelectedId =
    chatRows.find((row) => row.selected)?.id ?? chatRows[0].id;

  const [selectedId, setSelectedId] = useState<string>(defaultSelectedId);
  const [input, setInput] = useState<string>("");
  const [messages, setMessages] = useState<OutgoingMessage[]>([]);
  const [call, setCall] = useState<null | "audio" | "video">(null);
  const [recording, setRecording] = useState<boolean>(false);
  const [emojiOpen, setEmojiOpen] = useState<boolean>(false);

  const selectedRow =
    chatRows.find((row) => row.id === selectedId) ?? chatRows[0];

  const selectedThread =
    THREADS[selectedId] ?? genericThread(selectedRow.name.split(" ")[0]);

  function selectChat(id: string) {
    setSelectedId(id);
    setMessages([]);
    setEmojiOpen(false);
  }

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}`, text: trimmed, time: getCurrentTime() },
    ]);
    setInput("");
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      handleSend();
    }
  }

  return (
    <div className="relative w-[1100px] h-[720px] flex overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-2xl">
      {/* LEFT SIDEBAR */}
      <div className="w-[340px] shrink-0 border-r border-border flex flex-col">
        <div className="px-5 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Chats</h1>
          <div className="flex items-center gap-4">
            <PlusIcon className={`size-5 text-foreground ${PRESSABLE}`} />
            <UserCircleIcon className={`size-5 text-foreground ${PRESSABLE}`} />
            <BookmarkIcon className={`size-5 text-foreground ${PRESSABLE}`} />
            <SearchIcon className={`size-5 text-foreground ${PRESSABLE}`} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {chatRows.map((row) => (
            <ChatListRow
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={selectChat}
            />
          ))}
        </div>

        <div className="border-t border-border flex justify-around py-2.5">
          <ChatIcon className={`size-6 text-primary ${PRESSABLE}`} />
          <BotIcon className={`size-6 text-muted-foreground ${PRESSABLE}`} />
          <MegaphoneIcon className={`size-6 text-muted-foreground ${PRESSABLE}`} />
          <BoltIcon className={`size-6 text-muted-foreground ${PRESSABLE}`} />
          <div
            className={`size-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground ${PRESSABLE}`}
          >
            Me
          </div>
        </div>
      </div>

      {/* RIGHT CHAT PANE */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-6 py-3 border-b border-border flex items-center gap-3">
          <div
            className="size-10 rounded-full flex items-center justify-center shrink-0"
            style={{
              background:
                AVATAR_GRADIENTS[selectedRow.tone % AVATAR_GRADIENTS.length],
            }}
          >
            <span className="text-sm font-semibold text-white/95">
              {selectedRow.initials}
            </span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold truncate">{selectedRow.name}</span>
            <span className="text-xs text-online">online</span>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <PhoneIcon
              className={`size-5 text-foreground ${PRESSABLE}`}
              onClick={() => setCall("audio")}
            />
            <VideoIcon
              className={`size-5 text-foreground ${PRESSABLE}`}
              onClick={() => setCall("video")}
            />
            <SearchIcon className={`size-5 text-foreground ${PRESSABLE}`} />
          </div>
        </div>

        <div key={selectedId} className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-2">
          {selectedThread.map((item, index) =>
            item.kind === "day" ? (
              <span
                key={index}
                className="self-center text-xs text-muted-foreground bg-muted rounded-full px-3 py-1 my-1"
              >
                {item.label}
              </span>
            ) : item.side === "in" ? (
              <div
                key={index}
                className="self-start bg-bubble-in text-bubble-in-foreground rounded-2xl px-3.5 py-2 max-w-[55%]"
              >
                <p className="text-sm">{item.text}</p>
              </div>
            ) : (
              <div
                key={index}
                className="self-end bg-bubble-out text-bubble-out-foreground rounded-2xl px-3.5 py-2 max-w-[55%] flex items-end gap-1.5"
              >
                <span className="text-sm">{item.text}</span>
                {item.time && (
                  <span className="flex items-center gap-1 text-[11px] text-bubble-out-foreground/60 shrink-0">
                    {item.time}
                    <DoubleCheckIcon className="size-4" />
                  </span>
                )}
              </div>
            ),
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className="anoon-msg-in self-end bg-bubble-out text-bubble-out-foreground rounded-2xl px-3.5 py-2 max-w-[55%] flex items-end gap-1.5"
            >
              <span className="text-sm">{message.text}</span>
              <span className="flex items-center gap-1 text-[11px] text-bubble-out-foreground/60 shrink-0">
                {message.time}
                <DoubleCheckIcon className="size-4" />
              </span>
            </div>
          ))}
        </div>

        {recording ? (
          <RecordingBar
            onSend={() => setRecording(false)}
            onCancel={() => setRecording(false)}
          />
        ) : (
          <div className="px-4 py-3 border-t border-border flex items-center gap-2">
            <PlusIcon className={`size-6 text-muted-foreground shrink-0 ${PRESSABLE}`} />
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Message"
              className="flex-1 rounded-full bg-muted px-4 py-2.5 text-foreground placeholder:text-muted-foreground text-sm outline-none"
            />
            <EmojiIcon
              onClick={() => setEmojiOpen((v) => !v)}
              className={`size-6 text-muted-foreground shrink-0 ${PRESSABLE}`}
            />
            <MicIcon
              onClick={() => setRecording(true)}
              className={`size-6 text-muted-foreground shrink-0 ${PRESSABLE}`}
            />
            <CameraIcon className={`size-6 text-muted-foreground shrink-0 ${PRESSABLE}`} />
          </div>
        )}

        {emojiOpen && (
          <div className="absolute bottom-20 right-6 z-30">
            <EmojiPicker
              onSelect={(emoji) => setInput((d) => d + emoji)}
              onClose={() => setEmojiOpen(false)}
            />
          </div>
        )}
      </div>

      {call !== null && (
        <CallScreen
          name={selectedRow?.name ?? "Maya Whitfield"}
          video={call === "video"}
          onEnd={() => setCall(null)}
        />
      )}
    </div>
  );
}
