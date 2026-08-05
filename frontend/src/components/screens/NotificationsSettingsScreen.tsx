"use client";

import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

/* -------------------------------------------------------------------------- */
/* Switch                                                                      */
/* -------------------------------------------------------------------------- */

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6.5 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
        checked ? "bg-primary" : "bg-muted-foreground/30"
      }`}
    >
      <span
        className={`inline-block size-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-t border-border hover:bg-muted">
      <span className="text-foreground">{label}</span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function ChevronRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-border hover:bg-muted active:scale-95 transition-transform cursor-pointer"
    >
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        {value ? (
          <span className="text-muted-foreground text-sm">{value}</span>
        ) : null}
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </div>
    </div>
  );
}

function SectionCaption({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-5 pt-5 pb-2 text-sm text-muted-foreground">{children}</p>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                      */
/* -------------------------------------------------------------------------- */

export default function NotificationsSettingsScreen() {
  // Message Notifications
  const [messageShow, setMessageShow] = useState(true);
  const [messageSound, setMessageSound] = useState(true);
  const [messageVibrate, setMessageVibrate] = useState(true);
  const [messagePreview, setMessagePreview] = useState(true);

  // Group Notifications
  const [groupShow, setGroupShow] = useState(true);
  const [groupSound, setGroupSound] = useState(false);

  // Calls
  const [callNotifications, setCallNotifications] = useState(true);

  // In-App
  const [inAppSounds, setInAppSounds] = useState(true);
  const [inAppVibrate, setInAppVibrate] = useState(false);

  const handleExceptionsClick = () => {
    // Placeholder navigation hook for group notification exceptions.
  };

  const handleRingtoneClick = () => {
    // Placeholder navigation hook for ringtone selection.
  };

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground overflow-y-auto">
      <div className="flex items-center gap-2 px-3 pt-4 pb-2">
        <button
          type="button"
          aria-label="Back"
          className="flex size-9 items-center justify-center rounded-full active:scale-95 transition-transform hover:bg-muted"
        >
          <ChevronLeftIcon className="size-6 text-foreground" />
        </button>
        <h1 className="text-xl font-semibold">Notifications</h1>
      </div>

      <SectionCaption>Message Notifications</SectionCaption>
      <div>
        <ToggleRow
          label="Show notifications"
          checked={messageShow}
          onChange={setMessageShow}
        />
        <ToggleRow
          label="Sound"
          checked={messageSound}
          onChange={setMessageSound}
        />
        <ToggleRow
          label="Vibrate"
          checked={messageVibrate}
          onChange={setMessageVibrate}
        />
        <ToggleRow
          label="Preview text"
          checked={messagePreview}
          onChange={setMessagePreview}
        />
      </div>

      <SectionCaption>Group Notifications</SectionCaption>
      <div>
        <ToggleRow label="Show" checked={groupShow} onChange={setGroupShow} />
        <ToggleRow
          label="Sound"
          checked={groupSound}
          onChange={setGroupSound}
        />
        <ChevronRow label="Exceptions" onClick={handleExceptionsClick} />
      </div>

      <SectionCaption>Calls</SectionCaption>
      <div>
        <ToggleRow
          label="Call notifications"
          checked={callNotifications}
          onChange={setCallNotifications}
        />
        <ChevronRow
          label="Ringtone"
          value="Default"
          onClick={handleRingtoneClick}
        />
      </div>

      <SectionCaption>In-App</SectionCaption>
      <div className="pb-4">
        <ToggleRow
          label="In-app sounds"
          checked={inAppSounds}
          onChange={setInAppSounds}
        />
        <ToggleRow
          label="In-app vibrate"
          checked={inAppVibrate}
          onChange={setInAppVibrate}
        />
      </div>
    </div>
  );
}
