"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

// Инпут пароля с переключателем видимости — переиспользуется в register/email, login, recover/reset.
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "new-password" | "current-password";
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-xs font-medium text-fg-secondary">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={6}
          required
          className="w-full rounded-xl border border-border bg-surface-1 px-4 py-3.5 pr-12 text-base outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-fg-muted transition hover:text-fg"
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}
