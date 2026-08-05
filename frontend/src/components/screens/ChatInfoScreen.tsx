"use client";

import { useState } from "react";
import {
  ChevronLeftIcon,
  PhoneIcon,
  VideoIcon,
  BellIcon,
  BellOffIcon,
  SearchIcon,
  BlockIcon,
  TrashIcon,
} from "@/components/icons";

/* Calm, desaturated avatar gradient — shared visual language across screens. */
const AVATAR_GRADIENT_ROSE = "linear-gradient(135deg, #CE93A6 0%, #AC6C86 100%)";

/* Muted gradients for the shared-media placeholder grid. */
const MEDIA_GRADIENTS = [
  "linear-gradient(135deg, #8E9BC0 0%, #5F6F9E 100%)",
  "linear-gradient(135deg, #93BEA0 0%, #64977B 100%)",
  "linear-gradient(135deg, #CE93A6 0%, #AC6C86 100%)",
  "linear-gradient(135deg, #E7B75F 0%, #C98F3B 100%)",
  "linear-gradient(135deg, #A995C9 0%, #7F68A8 100%)",
  "linear-gradient(135deg, #86B7BD 0%, #5D939B 100%)",
] as const;

const PRESS_FX = "transition-transform active:scale-95 cursor-pointer";

const MEDIA_TILE_COUNT = 9;

interface InfoRow {
  id: string;
  label: string;
  value: string;
}

const INFO_ROWS: InfoRow[] = [
  { id: "phone", label: "Phone number", value: "+1 415 555 0182" },
  { id: "username", label: "Username", value: "@norab" },
  {
    id: "bio",
    label: "Bio",
    value: "Coffee, film cameras, and slow mornings. Say hi.",
  },
];

function ActionButton({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 ${PRESS_FX}`}
    >
      <div
        className={
          active
            ? "flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground"
            : "flex size-12 items-center justify-center rounded-full bg-muted text-foreground"
        }
      >
        {icon}
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function InfoField({ row }: { row: InfoRow }) {
  return (
    <div className="border-t border-border px-5 py-3">
      <p className="text-xs text-muted-foreground">{row.label}</p>
      <p className="mt-0.5 text-foreground">{row.value}</p>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={
        checked
          ? "relative h-6 w-11 shrink-0 rounded-full bg-primary transition-colors"
          : "relative h-6 w-11 shrink-0 rounded-full bg-muted transition-colors"
      }
    >
      <span
        className={
          checked
            ? "absolute top-0.5 left-0.5 size-5 translate-x-5 rounded-full bg-primary-foreground transition-transform"
            : "absolute top-0.5 left-0.5 size-5 translate-x-0 rounded-full bg-background transition-transform"
        }
      />
    </button>
  );
}

export default function ChatInfoScreen() {
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [notificationsOn, setNotificationsOn] = useState<boolean>(true);

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <ChevronLeftIcon
          className={`size-6 shrink-0 text-foreground ${PRESS_FX}`}
        />
        <span
          className={`text-sm font-semibold text-primary ${PRESS_FX}`}
        >
          Edit
        </span>
      </div>

      {/* Profile summary */}
      <div className="flex flex-col items-center px-5 pb-6 pt-2 text-center">
        <div
          className="flex size-24 items-center justify-center rounded-full"
          style={{ background: AVATAR_GRADIENT_ROSE }}
        >
          <span className="text-2xl font-semibold text-white/95">NB</span>
        </div>
        <h1 className="mt-3 text-xl font-bold">Nora Bennett</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          @norab &middot; online
        </p>
      </div>

      {/* Quick actions */}
      <div className="flex items-center justify-center gap-6 px-5 pb-2">
        <ActionButton
          icon={<PhoneIcon className="size-5" />}
          label="Call"
        />
        <ActionButton
          icon={<VideoIcon className="size-5" />}
          label="Video"
        />
        <ActionButton
          icon={
            isMuted ? (
              <BellOffIcon className="size-5" />
            ) : (
              <BellIcon className="size-5" />
            )
          }
          label="Mute"
          active={isMuted}
          onClick={() => setIsMuted((prev) => !prev)}
        />
        <ActionButton
          icon={<SearchIcon className="size-5" />}
          label="Search"
        />
      </div>

      {/* Info rows */}
      <div className="mt-4">
        {INFO_ROWS.map((row) => (
          <InfoField key={row.id} row={row} />
        ))}
      </div>

      {/* Notifications toggle */}
      <div className="flex items-center justify-between border-t border-border px-5 py-3.5">
        <span className="text-foreground">Notifications</span>
        <ToggleSwitch
          checked={notificationsOn}
          onChange={() => setNotificationsOn((prev) => !prev)}
        />
      </div>

      {/* Shared media */}
      <div className="mt-2">
        <p className="px-5 pb-2 pt-3 text-sm text-muted-foreground">
          Shared Media
        </p>
        <div className="grid grid-cols-3 gap-1.5 px-5">
          {Array.from({ length: MEDIA_TILE_COUNT }).map((_, index) => (
            <div
              key={index}
              className="aspect-square rounded-lg opacity-70"
              style={{
                background:
                  MEDIA_GRADIENTS[index % MEDIA_GRADIENTS.length],
              }}
            />
          ))}
        </div>
      </div>

      {/* Destructive actions */}
      <div className="mb-4 mt-6">
        <div
          className={`flex items-center gap-3 border-t border-border px-5 py-3.5 text-destructive ${PRESS_FX}`}
        >
          <BlockIcon className="size-5 shrink-0" />
          <span>Block user</span>
        </div>
        <div
          className={`flex items-center gap-3 border-t border-border px-5 py-3.5 text-destructive ${PRESS_FX}`}
        >
          <TrashIcon className="size-5 shrink-0" />
          <span>Delete chat</span>
        </div>
      </div>
    </div>
  );
}
