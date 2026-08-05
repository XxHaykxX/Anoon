"use client";

import { useState } from "react";
import TypingDots from "@/components/TypingDots";
import {
  SearchIcon,
  PlusIcon,
  UserCircleIcon,
  BookmarkIcon,
  PinIcon,
  BellOffIcon,
  ChatIcon,
  BotIcon,
  MegaphoneIcon,
  BoltIcon,
  LockIcon,
  CloseIcon,
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

type ChatRowStatus =
  | { kind: "none" }
  | { kind: "pinned" }
  | { kind: "muted" }
  | { kind: "unread"; count: number };

interface ChatRow {
  id: string;
  name: string;
  secret?: boolean;
  preview: string;
  previewVariant?: "default" | "typing" | "missedCall";
  /** Gradient tones (indices) of group members currently typing. */
  typerTones?: number[];
  time: string;
  status: ChatRowStatus;
  initials: string;
  tone: number;
}

const chatRows: ChatRow[] = [
  {
    id: "1",
    name: "Maya Whitfield",
    preview: "You: sounds good, see you at 7",
    time: "26 mins",
    status: { kind: "unread", count: 6 },
    initials: "MW",
    tone: 0,
  },
  {
    id: "2",
    name: "Dev Team Standup",
    preview: "typing",
    previewVariant: "typing",
    typerTones: [1, 4, 2],
    time: "10:48 pm",
    status: { kind: "pinned" },
    initials: "DT",
    tone: 5,
  },
  {
    id: "3",
    name: "Priya Nakamura",
    preview: "typing",
    previewVariant: "typing",
    time: "12:02 pm",
    status: { kind: "none" },
    initials: "PN",
    tone: 2,
  },
  {
    id: "4",
    name: "Family Circle",
    preview: "Grandma: don't forget the cake!",
    time: "Sun",
    status: { kind: "unread", count: 2 },
    initials: "FC",
    tone: 3,
  },
  {
    id: "5",
    name: "Confidential Client",
    secret: true,
    preview: "Voice message",
    time: "Sat",
    status: { kind: "muted" },
    initials: "CC",
    tone: 4,
  },
  {
    id: "6",
    name: "Lucas Bergman",
    preview: "Missed Call",
    previewVariant: "missedCall",
    time: "9:14 am",
    status: { kind: "none" },
    initials: "LB",
    tone: 1,
  },
  {
    id: "7",
    name: "Weekend Hikers",
    preview: "You: I'll bring the extra water bottles",
    time: "Fri",
    status: { kind: "pinned" },
    initials: "WH",
    tone: 5,
  },
  {
    id: "8",
    name: "Amara Costa",
    preview: "Just landed, calling you in a bit",
    time: "Thu",
    status: { kind: "unread", count: 1 },
    initials: "AC",
    tone: 2,
  },
];

function ChatAvatar({ initials, tone }: { initials: string; tone: number }) {
  return (
    <div
      className="relative flex size-[52px] shrink-0 items-center justify-center rounded-full"
      style={{ background: AVATAR_GRADIENTS[tone % AVATAR_GRADIENTS.length] }}
    >
      <span className="text-sm font-semibold text-white/95">{initials}</span>
    </div>
  );
}

/** 2-3 tiny overlapping circles for group members who are typing. */
function TyperCluster({ tones }: { tones: number[] }) {
  return (
    <span className="flex shrink-0 -space-x-1.5">
      {tones.slice(0, 3).map((tone, index) => (
        <span
          key={index}
          className="size-4 rounded-full ring-2 ring-background"
          style={{ background: AVATAR_GRADIENTS[tone % AVATAR_GRADIENTS.length] }}
        />
      ))}
    </span>
  );
}

function ChatPreview({
  preview,
  variant,
  typerTones,
}: {
  preview: string;
  variant?: ChatRow["previewVariant"];
  typerTones?: number[];
}) {
  if (variant === "missedCall") {
    return <p className="truncate text-sm text-destructive">{preview}</p>;
  }
  if (variant === "typing") {
    return (
      <span className="flex h-5 items-center gap-1.5 text-primary">
        {typerTones && typerTones.length > 0 ? <TyperCluster tones={typerTones} /> : null}
        <TypingDots className="text-primary" />
        <span className="text-xs font-medium">typing</span>
      </span>
    );
  }
  return <p className="truncate text-sm text-muted-foreground">{preview}</p>;
}

function ChatStatusIndicator({ status }: { status: ChatRowStatus }) {
  if (status.kind === "pinned") {
    return <PinIcon className="ml-auto size-4 text-muted-foreground" />;
  }
  if (status.kind === "muted") {
    return <BellOffIcon className="ml-auto size-4 text-muted-foreground" />;
  }
  if (status.kind === "unread") {
    return (
      <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
        {status.count}
      </span>
    );
  }
  return <div className="h-4" />;
}

function ChatListRow({ row, onSelect }: { row: ChatRow; onSelect: (id: string) => void }) {
  return (
    <div
      className="flex cursor-pointer select-none items-center gap-3 px-5 py-3 transition-transform hover:bg-muted active:scale-95"
      onClick={() => onSelect(row.id)}
      role="button"
      tabIndex={0}
    >
      <ChatAvatar initials={row.initials} tone={row.tone} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {row.secret ? (
            <LockIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          <span className="truncate font-semibold">{row.name}</span>
        </div>
        <ChatPreview
          preview={row.preview}
          variant={row.previewVariant}
          typerTones={row.typerTones}
        />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-xs text-muted-foreground">{row.time}</span>
        <ChatStatusIndicator status={row.status} />
      </div>
    </div>
  );
}

type BottomTabId = "chats" | "bot" | "updates" | "bolt" | "me";

function BottomTabItem({
  icon,
  active = false,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  active?: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <div
      className="relative flex cursor-pointer select-none flex-col items-center justify-center transition-transform active:scale-95"
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <div className={active ? "text-primary" : "text-muted-foreground"}>
        {icon}
      </div>
      {badge ? (
        <span className="absolute -right-2 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

export default function ChatsListScreen() {
  const [activeTab, setActiveTab] = useState<BottomTabId>("chats");
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const handleToggleSearch = () => {
    setSearchOpen((prev) => {
      const next = !prev;
      if (!next) {
        setSearchQuery("");
      }
      return next;
    });
  };

  const handleCloseSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
  };

  const handleSelectRow = (_id: string) => {
    // Cross-screen navigation is handled at the app level.
  };

  const filteredChatRows = chatRows.filter((row) =>
    row.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <div className="flex items-center justify-between px-5 pt-4">
        <h1 className="text-3xl font-bold">Chats</h1>
        <div className="flex items-center gap-4">
          <PlusIcon className="size-6 cursor-pointer select-none text-foreground transition-transform active:scale-95" />
          <UserCircleIcon className="size-6 cursor-pointer select-none text-foreground transition-transform active:scale-95" />
          <BookmarkIcon className="size-6 cursor-pointer select-none text-foreground transition-transform active:scale-95" />
          <SearchIcon
            className="size-6 cursor-pointer select-none text-foreground transition-transform active:scale-95"
            onClick={handleToggleSearch}
          />
        </div>
      </div>

      {searchOpen ? (
        <div className="flex items-center gap-2 px-5 pt-3">
          <input
            type="text"
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats"
            className="h-10 flex-1 rounded-full border border-border bg-muted px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <CloseIcon
            className="size-5 shrink-0 cursor-pointer select-none text-foreground transition-transform active:scale-95"
            onClick={handleCloseSearch}
          />
        </div>
      ) : null}

      <div className="mt-2 flex-1 divide-y divide-border overflow-y-auto">
        {filteredChatRows.map((row) => (
          <ChatListRow key={row.id} row={row} onSelect={handleSelectRow} />
        ))}
      </div>

      <div className="mt-auto flex justify-around border-t border-border py-2.5">
        <BottomTabItem
          icon={<ChatIcon className="size-6" />}
          active={activeTab === "chats"}
          badge="6"
          onClick={() => setActiveTab("chats")}
        />
        <BottomTabItem
          icon={<BotIcon className="size-6" />}
          active={activeTab === "bot"}
          onClick={() => setActiveTab("bot")}
        />
        <BottomTabItem
          icon={<MegaphoneIcon className="size-6" />}
          active={activeTab === "updates"}
          badge="8"
          onClick={() => setActiveTab("updates")}
        />
        <BottomTabItem
          icon={<BoltIcon className="size-6" />}
          active={activeTab === "bolt"}
          onClick={() => setActiveTab("bolt")}
        />
        <BottomTabItem
          icon={
            <div className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
              Me
            </div>
          }
          active={activeTab === "me"}
          onClick={() => setActiveTab("me")}
        />
      </div>
    </div>
  );
}
