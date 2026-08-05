"use client";

import { useState } from "react";
import {
  PlusIcon,
  BookmarkIcon,
  ChevronRightIcon,
  BellIcon,
  ShieldIcon,
  DatabaseIcon,
  SunIcon,
  GlobeIcon,
  ChatIcon,
  BotIcon,
  MegaphoneIcon,
  BoltIcon,
} from "@/components/icons";

function MoreIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

interface SettingsRow {
  id: string;
  icon: React.ReactNode;
  label: string;
  value?: string;
}

const THEME_OPTIONS = ["Evening", "Day", "Auto"] as const;
const LANGUAGE_OPTIONS = ["English", "Español", "Deutsch"] as const;

const baseSettingsRows: SettingsRow[] = [
  {
    id: "notifications",
    icon: <BellIcon className="size-5 text-primary-foreground" />,
    label: "Notifications and Sounds",
  },
  {
    id: "privacy",
    icon: <ShieldIcon className="size-5 text-primary-foreground" />,
    label: "Privacy and Security",
  },
  {
    id: "storage",
    icon: <DatabaseIcon className="size-5 text-primary-foreground" />,
    label: "Data and Storage",
  },
  {
    id: "theme",
    icon: <SunIcon className="size-5 text-primary-foreground" />,
    label: "Theme",
    value: THEME_OPTIONS[0],
  },
  {
    id: "language",
    icon: <GlobeIcon className="size-5 text-primary-foreground" />,
    label: "Language",
    value: LANGUAGE_OPTIONS[0],
  },
];

function FieldRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-5 py-3 border-t border-border hover:bg-muted active:scale-95 transition-transform cursor-pointer"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-foreground truncate">{value}</p>
      </div>
      <ChevronRightIcon className="size-4 text-muted-foreground shrink-0" />
    </div>
  );
}

function SettingsListRow({
  row,
  onClick,
}: {
  row: SettingsRow;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-5 py-3.5 border-t border-border hover:bg-muted active:scale-95 transition-transform cursor-pointer"
    >
      <div className="size-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
        {row.icon}
      </div>
      <span className="flex-1 text-foreground">{row.label}</span>
      {row.value ? (
        <span className="text-muted-foreground text-sm">{row.value}</span>
      ) : null}
      <ChevronRightIcon className="size-4 text-muted-foreground shrink-0" />
    </div>
  );
}

function BottomTabItem({
  icon,
  active = false,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  active?: boolean;
  badge?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="relative flex flex-col items-center justify-center active:scale-95 transition-transform cursor-pointer"
    >
      <div className={active ? "text-primary" : "text-muted-foreground"}>
        {icon}
      </div>
      {badge ? (
        <span className="absolute -top-1.5 -right-2 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

/* Calm, desaturated avatar gradient — shared visual language across screens. */
const AVATAR_GRADIENT_TEAL = "linear-gradient(135deg, #86B7BD 0%, #5D939B 100%)";

type Tab = "chat" | "bot" | "moments" | "bolt" | "profile";

export default function AccountScreen() {
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [themeValue, setThemeValue] = useState<(typeof THEME_OPTIONS)[number]>(
    THEME_OPTIONS[0],
  );
  const [languageValue, setLanguageValue] = useState<
    (typeof LANGUAGE_OPTIONS)[number]
  >(LANGUAGE_OPTIONS[0]);

  const cycleTheme = () => {
    setThemeValue((prev) => {
      const nextIndex = (THEME_OPTIONS.indexOf(prev) + 1) % THEME_OPTIONS.length;
      return THEME_OPTIONS[nextIndex];
    });
  };

  const cycleLanguage = () => {
    setLanguageValue((prev) => {
      const nextIndex =
        (LANGUAGE_OPTIONS.indexOf(prev) + 1) % LANGUAGE_OPTIONS.length;
      return LANGUAGE_OPTIONS[nextIndex];
    });
  };

  const settingsRows: SettingsRow[] = baseSettingsRows.map((row) => {
    if (row.id === "theme") return { ...row, value: themeValue };
    if (row.id === "language") return { ...row, value: languageValue };
    return row;
  });

  const handleSettingsRowClick = (id: string) => {
    if (id === "theme") {
      cycleTheme();
      return;
    }
    if (id === "language") {
      cycleLanguage();
      return;
    }
  };

  return (
    <div className="w-full bg-background text-foreground flex flex-col h-full">
      <div className="px-5 pt-4 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Account</h1>
        <div className="flex items-center gap-4">
          <PlusIcon className="size-6 text-foreground active:scale-95 transition-transform cursor-pointer" />
          <BookmarkIcon className="size-6 text-foreground active:scale-95 transition-transform cursor-pointer" />
          <MoreIcon className="size-6 text-foreground active:scale-95 transition-transform cursor-pointer" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-4 flex items-center gap-4 hover:bg-muted active:scale-95 transition-transform cursor-pointer">
          <div
            className="size-16 rounded-full flex items-center justify-center shrink-0"
            style={{ background: AVATAR_GRADIENT_TEAL }}
          >
            <span className="text-xl font-semibold text-white/95">AM</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold truncate">Alex Morgan</p>
            <p className="text-sm text-muted-foreground truncate">
              +1 234 567890
            </p>
          </div>
          <ChevronRightIcon className="size-5 text-muted-foreground shrink-0" />
        </div>

        <FieldRow label="Username" value="@alexm" />
        <FieldRow label="Bio" value="Product designer & photographer." />

        <p className="px-5 pt-5 pb-2 text-sm text-muted-foreground">
          Settings
        </p>
        {settingsRows.map((row) => (
          <SettingsListRow
            key={row.id}
            row={row}
            onClick={() => handleSettingsRowClick(row.id)}
          />
        ))}
      </div>

      <div className="mt-auto border-t border-border flex justify-around py-2.5">
        <BottomTabItem
          icon={<ChatIcon className="size-6" />}
          active={activeTab === "chat"}
          onClick={() => setActiveTab("chat")}
        />
        <BottomTabItem
          icon={<BotIcon className="size-6" />}
          active={activeTab === "bot"}
          onClick={() => setActiveTab("bot")}
        />
        <BottomTabItem
          icon={<MegaphoneIcon className="size-6" />}
          active={activeTab === "moments"}
          onClick={() => setActiveTab("moments")}
        />
        <BottomTabItem
          icon={<BoltIcon className="size-6" />}
          active={activeTab === "bolt"}
          onClick={() => setActiveTab("bolt")}
        />
        <BottomTabItem
          active={activeTab === "profile"}
          badge="9"
          onClick={() => setActiveTab("profile")}
          icon={
            <div
              className="size-6 rounded-full ring-2 ring-primary flex items-center justify-center text-[10px] font-semibold text-white/95"
              style={{ background: AVATAR_GRADIENT_TEAL }}
            >
              AM
            </div>
          }
        />
      </div>
    </div>
  );
}
