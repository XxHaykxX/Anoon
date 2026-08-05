"use client";

import { usePermissions } from "@refinedev/core";
import { Send } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

type Gender = "all" | "male" | "female";
const AUDIENCES: { key: Gender; label: string }[] = [
  { key: "all", label: "Всем" },
  { key: "female", label: "👧 Девушкам" },
  { key: "male", label: "👦 Парням" },
];

// Массовая push-рассылка. Только super_admin (роут это тоже проверяет).
export default function BroadcastPage() {
  const { data: role } = usePermissions<string>({});
  const isSuper = role === "super_admin";

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [gender, setGender] = useState<Gender>("all");
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);

  const canSend = title.trim().length > 0 && !sending;

  const send = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), url: url.trim() || undefined, gender }),
      });
      const data = (await res.json().catch(() => ({}))) as { sent?: number; total?: number; error?: string };
      if (!res.ok) {
        toast(data.error ?? "Ошибка рассылки", "danger");
      } else {
        toast(`Отправлено: ${data.sent ?? 0} из ${data.total ?? 0}`, "success");
        setTitle("");
        setBody("");
        setUrl("");
      }
    } catch {
      toast("Сеть недоступна", "danger");
    } finally {
      setSending(false);
      setConfirm(false);
    }
  };

  if (!isSuper) {
    return (
      <div>
        <h1 className="mb-4 text-xl font-semibold">Рассылка</h1>
        <div className="rounded-xl border border-border bg-surface-1 p-10 text-center text-fg-muted">
          Массовая рассылка доступна только super_admin.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <h1 className="mb-1 text-xl font-semibold">Рассылка push-уведомлений</h1>
      <p className="mb-5 text-sm text-fg-muted">Дойдёт до тех, кто разрешил уведомления. Фильтр по полу — из профиля.</p>

      <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Заголовок (обязательно)</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        placeholder="Например: Новые собеседники онлайн!"
        className="mb-4 w-full rounded-lg border border-border bg-surface-1 px-3 py-2.5 text-sm outline-none focus:border-accent"
      />

      <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Текст</label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={300}
        rows={3}
        placeholder="Короткое сообщение (необязательно)"
        className="mb-4 w-full resize-none rounded-lg border border-border bg-surface-1 px-3 py-2.5 text-sm outline-none focus:border-accent"
      />

      <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Ссылка при клике (необязательно)</label>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="/ (по умолчанию — на главную)"
        className="mb-4 w-full rounded-lg border border-border bg-surface-1 px-3 py-2.5 text-sm outline-none focus:border-accent"
      />

      <label className="mb-2 block text-xs font-medium text-fg-secondary">Кому</label>
      <div className="mb-6 flex gap-2">
        {AUDIENCES.map((a) => (
          <button
            key={a.key}
            onClick={() => setGender(a.key)}
            className={cn(
              "flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition",
              gender === a.key ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-secondary hover:text-fg",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      <button
        disabled={!canSend}
        onClick={() => setConfirm(true)}
        className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg transition hover:bg-accent/85 disabled:opacity-40"
      >
        <Send size={16} /> {sending ? "Отправка…" : "Отправить"}
      </button>

      <ConfirmDialog
        open={confirm}
        title="Отправить рассылку?"
        message={`Уведомление получат: ${AUDIENCES.find((a) => a.key === gender)?.label}. Действие массовое и необратимое.`}
        confirmLabel="Отправить"
        onClose={() => setConfirm(false)}
        onConfirm={send}
      />
    </div>
  );
}
