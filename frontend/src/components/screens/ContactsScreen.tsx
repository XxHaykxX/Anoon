"use client";

import { useState } from "react";
import SwipeableRow from "@/components/SwipeableRow";
import {
  PlusIcon,
  SearchIcon,
  SlidersIcon,
  ChatIcon,
  PhoneIcon,
  PeopleIcon,
  GridIcon,
  BlockIcon,
  LockIcon,
  TrashIcon,
  ForwardIcon,
  BellOffIcon,
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

interface FilterPill {
  id: string;
  label: string;
  count: number;
}

const filterPills: FilterPill[] = [
  { id: "all", label: "All", count: 392 },
  { id: "family", label: "Family", count: 7 },
  { id: "friends", label: "Friends", count: 34 },
  { id: "clients", label: "Clients", count: 12 },
];

interface ContactRow {
  id: string;
  name: string;
  initials: string;
  seen: string;
  secret?: boolean;
  tone: number;
  groups: string[];
}

const sectionA: ContactRow[] = [
  { id: "a1", name: "Adrian Solis", initials: "AS", seen: "Seen 5 minutes ago", tone: 0, groups: ["friends"] },
  {
    id: "a2",
    name: "Aisha Novak",
    initials: "AN",
    seen: "Seen 2 minutes ago",
    secret: true,
    tone: 2,
    groups: ["family"],
  },
  { id: "a3", name: "Ana Ferreira", initials: "AF", seen: "Seen 1 hour ago", tone: 4, groups: ["clients"] },
];

const sectionB: ContactRow[] = [
  { id: "b1", name: "Bianca Torres", initials: "BT", seen: "Seen 30 minutes ago", tone: 1, groups: ["friends"] },
  {
    id: "b2",
    name: "Bruno Mercer",
    initials: "BM",
    seen: "Seen 1 hour ago",
    secret: true,
    tone: 5,
    groups: ["clients"],
  },
  { id: "b3", name: "Bettina Kessler", initials: "BK", seen: "Seen 10 minutes ago", tone: 3, groups: ["family"] },
];

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

function ContactRowContent({ row }: { row: ContactRow }) {
  return (
    <div className="flex items-center gap-3 px-5 py-2.5">
      <ContactAvatar initials={row.initials} tone={row.tone} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate font-semibold">{row.name}</span>
          {row.secret ? (
            <LockIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
        </div>
        <p className="truncate text-sm text-muted-foreground">{row.seen}</p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <ChatIcon
          className="size-5 cursor-pointer text-muted-foreground transition-transform hover:text-foreground active:scale-95"
          onClick={(event) => {
            event.stopPropagation();
          }}
        />
        <PhoneIcon
          className="size-5 cursor-pointer text-muted-foreground transition-transform hover:text-foreground active:scale-95"
          onClick={(event) => {
            event.stopPropagation();
          }}
        />
      </div>
    </div>
  );
}

/** Contact row with a real swipe-to-reveal action strip (drag left). */
function SwipeableContactRow({ row }: { row: ContactRow }) {
  return (
    <SwipeableRow
      actions={[
        {
          icon: (
            <TrashIcon className="size-5 cursor-pointer transition-transform active:scale-95" />
          ),
          label: "Delete",
          color: "danger",
        },
        {
          icon: (
            <BlockIcon className="size-5 cursor-pointer text-destructive transition-transform active:scale-95" />
          ),
          label: "Block",
        },
        {
          icon: (
            <ForwardIcon className="size-5 cursor-pointer text-foreground transition-transform active:scale-95" />
          ),
          label: "Forward",
        },
        {
          icon: (
            <BellOffIcon className="size-5 cursor-pointer text-foreground transition-transform active:scale-95" />
          ),
          label: "Mute",
        },
      ]}
    >
      <ContactRowContent row={row} />
    </SwipeableRow>
  );
}

function SectionHeader({ letter }: { letter: string }) {
  return (
    <div className="px-5 py-1 text-xs font-semibold text-muted-foreground">
      {letter}
    </div>
  );
}

interface BottomNavItemProps {
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}

function BottomNavItem({ icon, active = false, onClick }: BottomNavItemProps) {
  return (
    <div
      onClick={onClick}
      className={
        active
          ? "cursor-pointer text-primary transition-transform active:scale-95"
          : "cursor-pointer text-muted-foreground transition-transform active:scale-95"
      }
    >
      {icon}
    </div>
  );
}

type SubNavId = "people" | "grid" | "blocked";

function filterByQuery(rows: ContactRow[], query: string): ContactRow[] {
  if (!query.trim()) return rows;
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => row.name.toLowerCase().includes(needle));
}

function filterByGroup(rows: ContactRow[], filterId: string): ContactRow[] {
  if (filterId === "all") return rows;
  return rows.filter((row) => row.groups.includes(filterId));
}

export default function ContactsScreen() {
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeSubNav, setActiveSubNav] = useState<SubNavId>("people");
  const [sortOpen, setSortOpen] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);

  const applySort = (rows: ContactRow[]): ContactRow[] =>
    sortAsc ? [...rows].sort((a, b) => a.name.localeCompare(b.name)) : rows;

  const visibleSectionA = applySort(filterByQuery(filterByGroup(sectionA, activeFilter), query));
  const visibleSectionB = applySort(filterByQuery(filterByGroup(sectionB, activeFilter), query));

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted" />

      <div className="flex items-center justify-between px-5 pt-2">
        <h1 className="text-3xl font-bold">Contacts</h1>
        <div className="flex items-center gap-4">
          <PlusIcon className="size-6 cursor-pointer text-foreground transition-transform active:scale-95" />
          <div className="relative">
            <SlidersIcon
              className="size-6 cursor-pointer text-foreground transition-transform active:scale-95"
              onClick={() => setSortOpen((v) => !v)}
            />
            {sortOpen && (
              <div className="absolute right-0 top-8 z-20 w-44 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
                {[
                  { id: false, label: "По умолчанию" },
                  { id: true, label: "По имени (А–Я)" },
                ].map((opt) => (
                  <button
                    key={String(opt.id)}
                    type="button"
                    onClick={() => {
                      setSortAsc(opt.id);
                      setSortOpen(false);
                    }}
                    className={
                      "flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-muted " +
                      (sortAsc === opt.id ? "text-primary font-medium" : "text-foreground")
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {searchOpen ? (
            <CloseIcon
              className="size-6 cursor-pointer text-foreground transition-transform active:scale-95"
              onClick={() => {
                setSearchOpen(false);
                setQuery("");
              }}
            />
          ) : (
            <SearchIcon
              className="size-6 cursor-pointer text-foreground transition-transform active:scale-95"
              onClick={() => setSearchOpen(true)}
            />
          )}
          <div
            className="flex size-6 cursor-pointer flex-col items-center justify-center gap-[3px] transition-transform active:scale-95"
          >
            <span className="size-1 rounded-full bg-foreground" />
            <span className="size-1 rounded-full bg-foreground" />
            <span className="size-1 rounded-full bg-foreground" />
          </div>
        </div>
      </div>

      {searchOpen ? (
        <div className="flex items-center gap-2 px-5 pt-3">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search contacts"
            autoFocus
            className="flex-1 rounded-full bg-muted px-4 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <CloseIcon
            className="size-5 shrink-0 cursor-pointer text-muted-foreground transition-transform active:scale-95"
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
            }}
          />
        </div>
      ) : null}

      <div className="flex gap-2 overflow-x-auto px-5 py-3 [scrollbar-width:none]">
        {filterPills.map((pill) => {
          const isActive = pill.id === activeFilter;
          return (
            <span
              key={pill.id}
              onClick={() => setActiveFilter(pill.id)}
              className={
                isActive
                  ? "shrink-0 cursor-pointer whitespace-nowrap rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-transform active:scale-95"
                  : "shrink-0 cursor-pointer whitespace-nowrap rounded-full bg-muted px-4 py-1.5 text-sm font-medium text-muted-foreground transition-transform active:scale-95"
              }
            >
              {pill.label} {pill.count}
            </span>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {visibleSectionA.length > 0 ? (
          <>
            <SectionHeader letter="A" />
            {visibleSectionA.map((row) => (
              <SwipeableContactRow key={row.id} row={row} />
            ))}
          </>
        ) : null}

        {visibleSectionB.length > 0 ? (
          <>
            <SectionHeader letter="B" />
            {visibleSectionB.map((row) => (
              <SwipeableContactRow key={row.id} row={row} />
            ))}
          </>
        ) : null}

        {visibleSectionA.length === 0 && visibleSectionB.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">
            No contacts found
          </p>
        ) : null}
      </div>

      <div className="mt-auto flex justify-around border-t border-border py-2.5">
        <BottomNavItem
          icon={<PeopleIcon className="size-6" />}
          active={activeSubNav === "people"}
          onClick={() => setActiveSubNav("people")}
        />
        <BottomNavItem
          icon={<GridIcon className="size-6" />}
          active={activeSubNav === "grid"}
          onClick={() => setActiveSubNav("grid")}
        />
        <BottomNavItem
          icon={<BlockIcon className="size-6" />}
          active={activeSubNav === "blocked"}
          onClick={() => setActiveSubNav("blocked")}
        />
      </div>
    </div>
  );
}
