"use client";

import { motion } from "framer-motion";
import { Bell, Home, User, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { accountsEnabled } from "@/lib/supabase";
import { useMounted } from "@/lib/use-mounted";
import { useNotifications } from "@/store/notifications";
import { useSession } from "@/store/session";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Главная", icon: Home },
  { href: "/friends", label: "Друзья", icon: Users },
  { href: "/notifications", label: "Уведомления", icon: Bell },
  { href: "/profile", label: "Профиль", icon: User },
] as const;

// Скрыта на полноэкранном разговоре (чат/личка) и на всех auth-экранах — там своя навигация
// (заголовок с "Назад") либо ей вообще не место (регистрация/вход).
function isHiddenRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/chat/") ||
    pathname.startsWith("/dm/") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/recover") ||
    pathname.startsWith("/auth/")
  );
}

// Общее условие показа — используется и навбаром, и «распоркой» под ним (BottomNavSpacer),
// чтобы контент страниц не прятался под fixed-навигацией. Одно место истины, а не дублирование
// условия в layout.tsx и в компоненте по отдельности.
export function useShowBottomNav(): boolean {
  const mounted = useMounted();
  const pathname = usePathname();
  const genderLocked = useSession((s) => s.genderLocked);
  // !mounted — до гидрации persist-стора решение о показе ещё не готово; лучше молчать,
  // чем мигнуть навбаром и тут же его спрятать (layout-shift).
  if (!mounted || !accountsEnabled || !genderLocked) return false;
  return !isHiddenRoute(pathname);
}

// Отступ снизу под fixed-навбар — ставится в app/layout.tsx сразу после {children}, чтобы
// нижние кнопки/контент страниц не перекрывались навигацией. Показывается синхронно с ней.
export function BottomNavSpacer() {
  const show = useShowBottomNav();
  if (!show) return null;
  return <div aria-hidden style={{ height: "calc(56px + env(safe-area-inset-bottom))" }} />;
}

// Нижняя навигация (4 таба). Смонтирована в app/layout.tsx (не app-providers — тот файл
// сейчас занят под notif-данные), т.е. живёт вне зависимости от прочих провайдеров.
export function BottomNav() {
  const pathname = usePathname();
  const unreadCount = useNotifications((s) => s.unreadCount);
  const show = useShowBottomNav();

  if (!show) return null;

  return (
    <nav
      aria-label="Основная навигация"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-surface-1/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="mx-auto flex max-w-md">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          const badge = tab.href === "/notifications" && unreadCount > 0 ? (unreadCount > 9 ? "9+" : String(unreadCount)) : null;
          return (
            <Link key={tab.href} href={tab.href} aria-label={tab.label} className="flex min-h-[56px] flex-1">
              <motion.span
                whileTap={{ scale: 0.92 }}
                transition={{ duration: 0.15 }}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-0.5",
                  active ? "text-accent" : "text-fg-muted",
                )}
              >
                <span className="relative">
                  <Icon size={22} />
                  {badge ? (
                    <span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] leading-none text-accent-fg">
                      {badge}
                    </span>
                  ) : null}
                </span>
                <span className="text-[11px]">{tab.label}</span>
              </motion.span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
