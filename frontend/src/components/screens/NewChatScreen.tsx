"use client";

import { useState } from "react";
import {
  ChevronLeftIcon,
  CloseIcon,
  SearchIcon,
  PeopleIcon,
  MegaphoneIcon,
  UserCircleIcon,
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

interface ActionItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const actionItems: ActionItem[] = [
  { id: "new-group", label: "New Group", icon: <PeopleIcon className="size-5" /> },
  { id: "new-channel", label: "New Channel", icon: <MegaphoneIcon className="size-5" /> },
  { id: "new-contact", label: "New Contact", icon: <UserCircleIcon className="size-5" /> },
];

interface ContactRow {
  id: string;
  name: string;
  initials: string;
  detail: string;
  tone: number;
}

const sectionA: ContactRow[] = [
  { id: "a1", name: "Adrian Solis", initials: "AS", detail: "Seen 5 minutes ago", tone: 0 },
  { id: "a2", name: "Aisha Novak", initials: "AN", detail: "@aisha.novak", tone: 2 },
  { id: "a3", name: "Ana Ferreira", initials: "AF", detail: "Seen 1 hour ago", tone: 4 },
];

const sectionB: ContactRow[] = [
  { id: "b1", name: "Bianca Torres", initials: "BT", detail: "Seen just now", tone: 1 },
  { id: "b2", name: "Bruno Mercer", initials: "BM", detail: "@bruno.m", tone: 5 },
];

const sectionC: ContactRow[] = [
  { id: "c1", name: "Carla Dumont", initials: "CD", detail: "Seen 2 days ago", tone: 3 },
  { id: "c2", name: "Caleb Okafor", initials: "CO", detail: "@caleb.okafor", tone: 0 },
];

interface ContactSection {
  letter: string;
  rows: ContactRow[];
}

const sections: ContactSection[] = [
  { letter: "A", rows: sectionA },
  { letter: "B", rows: sectionB },
  { letter: "C", rows: sectionC },
];

function filterByQuery(rows: ContactRow[], query: string): ContactRow[] {
  if (!query.trim()) return rows;
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => row.name.toLowerCase().includes(needle));
}

function ContactAvatar({ initials, tone }: { initials: string; tone: number }) {
  return (
    <div
      className="flex size-12 shrink-0 items-center justify-center rounded-full"
      style={{ background: AVATAR_GRADIENTS[tone % AVATAR_GRADIENTS.length] }}
    >
      <span className="text-sm font-semibold text-white/95">{initials}</span>
    </div>
  );
}

function ContactListRow({ row }: { row: ContactRow }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        /* no-op */
      }}
      className="flex cursor-pointer items-center gap-3 px-5 py-2.5 transition-transform hover:bg-muted active:scale-95"
    >
      <ContactAvatar initials={row.initials} tone={row.tone} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{row.name}</p>
        <p className="truncate text-sm text-muted-foreground">{row.detail}</p>
      </div>
    </div>
  );
}

function SectionHeader({ letter }: { letter: string }) {
  return (
    <div className="px-5 py-1 text-xs font-semibold text-muted-foreground">{letter}</div>
  );
}

function ActionRow({ item }: { item: ActionItem }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        /* no-op */
      }}
      className="flex cursor-pointer items-center gap-3 px-5 py-2.5 transition-transform hover:bg-muted active:scale-95"
    >
      <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        {item.icon}
      </div>
      <span className="font-semibold">{item.label}</span>
    </div>
  );
}

export default function NewChatScreen() {
  const [query, setQuery] = useState("");

  const visibleSections = sections
    .map((section) => ({ letter: section.letter, rows: filterByQuery(section.rows, query) }))
    .filter((section) => section.rows.length > 0);

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <div className="flex items-center justify-between px-5 pt-4">
        <ChevronLeftIcon
          className="size-6 cursor-pointer text-foreground transition-transform active:scale-95"
          onClick={() => {
            /* no-op */
          }}
        />
        <h1 className="text-lg font-bold">New Chat</h1>
        <CloseIcon
          className="size-6 cursor-pointer text-foreground transition-transform active:scale-95"
          onClick={() => {
            /* no-op */
          }}
        />
      </div>

      <div className="px-5 pt-3">
        <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-2">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search contacts"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-border py-1">
          {actionItems.map((item) => (
            <ActionRow key={item.id} item={item} />
          ))}
        </div>

        {visibleSections.map((section) => (
          <div key={section.letter}>
            <SectionHeader letter={section.letter} />
            {section.rows.map((row) => (
              <ContactListRow key={row.id} row={row} />
            ))}
          </div>
        ))}

        {visibleSections.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">
            No contacts found
          </p>
        ) : null}
      </div>
    </div>
  );
}
