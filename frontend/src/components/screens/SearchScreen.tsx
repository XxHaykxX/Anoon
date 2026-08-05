"use client";

import { useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { ChevronLeftIcon, CloseIcon, ChatIcon, PeopleIcon } from "@/components/icons";

/* Calm, desaturated avatar gradients — shared visual language across screens. */
const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #8E9BC0 0%, #5F6F9E 100%)", // slate
  "linear-gradient(135deg, #93BEA0 0%, #64977B 100%)", // sage
  "linear-gradient(135deg, #CE93A6 0%, #AC6C86 100%)", // rose
  "linear-gradient(135deg, #E7B75F 0%, #C98F3B 100%)", // amber
  "linear-gradient(135deg, #A995C9 0%, #7F68A8 100%)", // violet
  "linear-gradient(135deg, #86B7BD 0%, #5D939B 100%)", // teal
] as const;

interface RecentContact {
  id: string;
  name: string;
  initials: string;
  tone: number;
}

interface ChatResult {
  id: string;
  name: string;
  snippet: string;
  initials: string;
  tone: number;
}

interface MessageResult {
  id: string;
  sender: string;
  snippet: string;
  initials: string;
  tone: number;
}

interface ContactResult {
  id: string;
  name: string;
  subtitle: string;
  initials: string;
  tone: number;
}

const initialRecentSearches: string[] = ["Maya Whitfield", "budget draft", "Weekend Hikers"];

const recentContacts: RecentContact[] = [
  { id: "rc1", name: "Maya", initials: "MW", tone: 0 },
  { id: "rc2", name: "Priya", initials: "PN", tone: 2 },
  { id: "rc3", name: "Lucas", initials: "LB", tone: 1 },
  { id: "rc4", name: "Amara", initials: "AC", tone: 4 },
  { id: "rc5", name: "Dev Team", initials: "DT", tone: 5 },
  { id: "rc6", name: "Bianca", initials: "BT", tone: 3 },
];

const chatResults: ChatResult[] = [
  { id: "c1", name: "Maya Whitfield", snippet: "You: sounds good, see you at 7", initials: "MW", tone: 0 },
  { id: "c2", name: "Dev Team Standup", snippet: "Priya: pushed the budget draft", initials: "DT", tone: 5 },
  { id: "c3", name: "Family Circle", snippet: "Grandma: don't forget the cake!", initials: "FC", tone: 3 },
  { id: "c4", name: "Weekend Hikers", snippet: "You: I'll bring the extra water bottles", initials: "WH", tone: 5 },
  { id: "c5", name: "Amara Costa", snippet: "Just landed, calling you in a bit", initials: "AC", tone: 2 },
];

const messageResults: MessageResult[] = [
  { id: "m1", sender: "Maya Whitfield", snippet: "Can you send the budget draft before 5?", initials: "MW", tone: 0 },
  { id: "m2", sender: "Priya Nakamura", snippet: "Meeting moved to the budget review room", initials: "PN", tone: 2 },
  { id: "m3", sender: "Lucas Bergman", snippet: "Missed call, calling you back in 10", initials: "LB", tone: 1 },
  { id: "m4", sender: "Weekend Hikers", snippet: "Anyone free this weekend for a hike?", initials: "WH", tone: 5 },
];

const contactResults: ContactResult[] = [
  { id: "p1", name: "Maya Whitfield", subtitle: "Seen 5 minutes ago", initials: "MW", tone: 0 },
  { id: "p2", name: "Priya Nakamura", subtitle: "Seen 2 hours ago", initials: "PN", tone: 2 },
  { id: "p3", name: "Bianca Torres", subtitle: "Seen yesterday", initials: "BT", tone: 1 },
  { id: "p4", name: "Bruno Mercer", subtitle: "Seen 3 days ago", initials: "BM", tone: 5 },
];

function matches(query: string, ...fields: string[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field.toLowerCase().includes(needle));
}

/** Splits text around the first case-insensitive match of query and bolds it. */
function highlightMatch(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) return text;
  const before = text.slice(0, index);
  const match = text.slice(index, index + needle.length);
  const after = text.slice(index + needle.length);
  return (
    <>
      {before}
      <span className="font-semibold text-foreground">{match}</span>
      {after}
    </>
  );
}

function Avatar({ initials, tone, size = 48 }: { initials: string; tone: number; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: AVATAR_GRADIENTS[tone % AVATAR_GRADIENTS.length],
      }}
    >
      <span className="text-sm font-semibold text-white/95">{initials}</span>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-5 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
  );
}

function RecentChip({
  label,
  onSelect,
  onRemove,
}: {
  label: string;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full bg-muted py-1.5 pl-4 pr-2 text-sm font-medium text-foreground transition-transform active:scale-95"
    >
      <span>{label}</span>
      <CloseIcon
        className="size-4 shrink-0 cursor-pointer text-muted-foreground transition-transform active:scale-95"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      />
    </div>
  );
}

export default function SearchScreen() {
  const [query, setQuery] = useState<string>("");
  const [recentSearches, setRecentSearches] = useState<string[]>(initialRecentSearches);

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setQuery(event.target.value);
  };

  const handleClearQuery = (): void => {
    setQuery("");
  };

  const handleBack = (): void => {
    setQuery("");
  };

  const handleSelectRecent = (label: string): void => {
    setQuery(label);
  };

  const handleRemoveRecent = (label: string): void => {
    setRecentSearches((prev) => prev.filter((item) => item !== label));
  };

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;

  const filteredChats = isSearching
    ? chatResults.filter((row) => matches(trimmedQuery, row.name, row.snippet))
    : [];
  const filteredMessages = isSearching
    ? messageResults.filter((row) => matches(trimmedQuery, row.sender, row.snippet))
    : [];
  const filteredContacts = isSearching
    ? contactResults.filter((row) => matches(trimmedQuery, row.name, row.subtitle))
    : [];

  const hasNoResults =
    isSearching &&
    filteredChats.length === 0 &&
    filteredMessages.length === 0 &&
    filteredContacts.length === 0;

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <ChevronLeftIcon
          className="size-6 shrink-0 cursor-pointer select-none text-foreground transition-transform active:scale-95"
          onClick={handleBack}
        />
        <div className="relative flex-1">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={handleQueryChange}
            placeholder="Search Anoon"
            className="h-11 w-full rounded-full border border-transparent bg-muted px-4 pr-10 text-base text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2"
          />
          {query.length > 0 ? (
            <CloseIcon
              className="absolute right-3 top-1/2 size-5 -translate-y-1/2 cursor-pointer select-none text-muted-foreground transition-transform active:scale-95"
              onClick={handleClearQuery}
            />
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-4">
        {!isSearching ? (
          <>
            {recentSearches.length > 0 ? (
              <>
                <SectionHeader label="Recent" />
                <div className="flex gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:none]">
                  {recentSearches.map((label) => (
                    <RecentChip
                      key={label}
                      label={label}
                      onSelect={() => handleSelectRecent(label)}
                      onRemove={() => handleRemoveRecent(label)}
                    />
                  ))}
                </div>
              </>
            ) : null}

            <SectionHeader label="Recent contacts" />
            <div className="flex gap-4 overflow-x-auto px-5 pb-2 pt-1 [scrollbar-width:none]">
              {recentContacts.map((contact) => (
                <div
                  key={contact.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectRecent(contact.name)}
                  className="flex shrink-0 cursor-pointer select-none flex-col items-center gap-1.5 transition-transform active:scale-95"
                >
                  <Avatar initials={contact.initials} tone={contact.tone} size={56} />
                  <span className="max-w-[64px] truncate text-xs text-muted-foreground">
                    {contact.name}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : hasNoResults ? (
          <p className="px-5 pt-10 text-center text-sm text-muted-foreground">
            No results for &apos;{trimmedQuery}&apos;
          </p>
        ) : (
          <>
            {filteredChats.length > 0 ? (
              <>
                <SectionHeader label="Chats" />
                {filteredChats.map((row) => (
                  <div
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    className="flex cursor-pointer select-none items-center gap-3 px-5 py-2.5 transition-transform active:scale-95"
                  >
                    <Avatar initials={row.initials} tone={row.tone} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {highlightMatch(row.name, trimmedQuery)}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {highlightMatch(row.snippet, trimmedQuery)}
                      </p>
                    </div>
                    <ChatIcon className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                ))}
              </>
            ) : null}

            {filteredMessages.length > 0 ? (
              <>
                <SectionHeader label="Messages" />
                {filteredMessages.map((row) => (
                  <div
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    className="flex cursor-pointer select-none items-center gap-3 px-5 py-2.5 transition-transform active:scale-95"
                  >
                    <Avatar initials={row.initials} tone={row.tone} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {highlightMatch(row.sender, trimmedQuery)}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {highlightMatch(row.snippet, trimmedQuery)}
                      </p>
                    </div>
                  </div>
                ))}
              </>
            ) : null}

            {filteredContacts.length > 0 ? (
              <>
                <SectionHeader label="Contacts" />
                {filteredContacts.map((row) => (
                  <div
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    className="flex cursor-pointer select-none items-center gap-3 px-5 py-2.5 transition-transform active:scale-95"
                  >
                    <Avatar initials={row.initials} tone={row.tone} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {highlightMatch(row.name, trimmedQuery)}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">{row.subtitle}</p>
                    </div>
                    <PeopleIcon className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                ))}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
