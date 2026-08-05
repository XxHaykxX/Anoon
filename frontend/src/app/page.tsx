"use client";

import { useState, type ReactNode } from "react";
import OnboardingScreen from "@/components/screens/OnboardingScreen";
import LoginScreen from "@/components/screens/LoginScreen";
import ChatsListScreen from "@/components/screens/ChatsListScreen";
import ChatScreen from "@/components/screens/ChatScreen";
import VoiceChatScreen from "@/components/screens/VoiceChatScreen";
import MusicChatScreen from "@/components/screens/MusicChatScreen";
import ContactsScreen from "@/components/screens/ContactsScreen";
import ContactsSheetScreen from "@/components/screens/ContactsSheetScreen";
import AccountScreen from "@/components/screens/AccountScreen";
import DesktopScreen from "@/components/screens/DesktopScreen";
// anoon — anonymous chat-roulette app screens
import AnoonLogin from "@/components/anoon/AnoonLogin";
import AnoonRegister from "@/components/anoon/AnoonRegister";
import AnoonVerifyEmail from "@/components/anoon/AnoonVerifyEmail";
import AnoonForgotPassword from "@/components/anoon/AnoonForgotPassword";
import AnoonResetPassword from "@/components/anoon/AnoonResetPassword";
import AnoonGenderSelect from "@/components/anoon/AnoonGenderSelect";
import AnoonProfileSetup from "@/components/anoon/AnoonProfileSetup";
import AnoonHome from "@/components/anoon/AnoonHome";
import AnoonSearching from "@/components/anoon/AnoonSearching";
import AnoonAnonChat from "@/components/anoon/AnoonAnonChat";
import AnoonConversationEnded from "@/components/anoon/AnoonConversationEnded";
import AnoonRevealPrompt from "@/components/anoon/AnoonRevealPrompt";
import AnoonFriends from "@/components/anoon/AnoonFriends";
import AnoonFriendSearch from "@/components/anoon/AnoonFriendSearch";
import AnoonFriendRequests from "@/components/anoon/AnoonFriendRequests";
import AnoonInvite from "@/components/anoon/AnoonInvite";
import AnoonPrivateChat from "@/components/anoon/AnoonPrivateChat";
import AnoonNotifications from "@/components/anoon/AnoonNotifications";
import AnoonReport from "@/components/anoon/AnoonReport";
import AnoonBanned from "@/components/anoon/AnoonBanned";
import AnoonMuted from "@/components/anoon/AnoonMuted";
import AnoonProfile from "@/components/anoon/AnoonProfile";
import AnoonSettings from "@/components/anoon/AnoonSettings";
import AnoonOffline from "@/components/anoon/AnoonOffline";
import AnoonInstall from "@/components/anoon/AnoonInstall";

const PHONE_SCREENS = {
  Onboarding: OnboardingScreen,
  Login: LoginScreen,
  Chats: ChatsListScreen,
  Chat: ChatScreen,
  Voice: VoiceChatScreen,
  Music: MusicChatScreen,
  Contacts: ContactsScreen,
  "Contacts sheet": ContactsSheetScreen,
  Account: AccountScreen,
  // anoon
  "a/Вход": AnoonLogin,
  "a/Регистр.": AnoonRegister,
  "a/Почта": AnoonVerifyEmail,
  "a/Забыл пароль": AnoonForgotPassword,
  "a/Сброс": AnoonResetPassword,
  "a/Пол": AnoonGenderSelect,
  "a/Профиль-старт": AnoonProfileSetup,
  "a/Главная": AnoonHome,
  "a/Поиск": AnoonSearching,
  "a/Аноним-чат": AnoonAnonChat,
  "a/Оценка": AnoonConversationEnded,
  "a/Раскрытие": AnoonRevealPrompt,
  "a/Друзья": AnoonFriends,
  "a/Поиск друзей": AnoonFriendSearch,
  "a/Заявки": AnoonFriendRequests,
  "a/Инвайт": AnoonInvite,
  "a/Личка": AnoonPrivateChat,
  "a/Уведомл.": AnoonNotifications,
  "a/Жалоба": AnoonReport,
  "a/Бан": AnoonBanned,
  "a/Мьют": AnoonMuted,
  "a/Профиль": AnoonProfile,
  "a/Настройки": AnoonSettings,
  "a/Офлайн": AnoonOffline,
  "a/Установка": AnoonInstall,
} as const;

type PhoneScreenName = keyof typeof PHONE_SCREENS;
type TabName = PhoneScreenName | "Desktop";
const TABS: TabName[] = [
  "Onboarding",
  "Login",
  "Chats",
  "Chat",
  "Voice",
  "Music",
  "Contacts",
  "Contacts sheet",
  "Account",
  "Desktop",
  "a/Вход",
  "a/Регистр.",
  "a/Почта",
  "a/Забыл пароль",
  "a/Сброс",
  "a/Пол",
  "a/Профиль-старт",
  "a/Главная",
  "a/Поиск",
  "a/Аноним-чат",
  "a/Оценка",
  "a/Раскрытие",
  "a/Друзья",
  "a/Поиск друзей",
  "a/Заявки",
  "a/Инвайт",
  "a/Личка",
  "a/Уведомл.",
  "a/Жалоба",
  "a/Бан",
  "a/Мьют",
  "a/Профиль",
  "a/Настройки",
  "a/Офлайн",
  "a/Установка",
];

/**
 * Phone frame that scales itself down on narrow viewports so it never causes
 * horizontal page overflow. The outer sizing box reserves the scaled footprint
 * (frame is 410 x 864 at full size, incl. its 10px bezel) while the inner
 * wrapper applies the matching transform scale from a top-left origin.
 */
function PhoneFrame({ dark, children }: { dark?: boolean; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center">
      <div className="h-[605px] w-[287px] min-[360px]:h-[692px] min-[360px]:w-[328px] min-[460px]:h-[864px] min-[460px]:w-[410px]">
        <div
          className={
            "origin-top-left scale-[0.7] min-[360px]:scale-[0.8] min-[460px]:scale-100" +
            (dark ? " dark" : "")
          }
        >
          <div className="relative h-[844px] w-[390px] overflow-hidden rounded-[44px] border-[10px] border-neutral-800 bg-background shadow-2xl">
            <div className="pointer-events-none absolute left-1/2 top-0 z-10 h-6 w-36 -translate-x-1/2 rounded-b-2xl bg-neutral-800" />
            <div className="flex h-full flex-col">
              {/* status-bar / notch clearance so top-bar content never hides under the notch */}
              <div className="h-7 shrink-0 bg-background" />
              <div className="min-h-0 flex-1">{children}</div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-xs font-medium text-neutral-400">{dark ? "Dark" : "Light"}</p>
    </div>
  );
}

function DesktopFrame({ dark }: { dark?: boolean }) {
  return (
    <div className="w-full min-w-0">
      <div className="w-full overflow-x-auto pb-2">
        <div className={"mx-auto w-fit" + (dark ? " dark" : "")}>
          <DesktopScreen />
        </div>
      </div>
      <p className="mt-2 text-center text-xs font-medium text-neutral-400">{dark ? "Dark" : "Light"}</p>
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState<TabName>("Onboarding");
  const isDesktop = tab === "Desktop";
  const Screen = isDesktop ? null : PHONE_SCREENS[tab as PhoneScreenName];

  return (
    <main className="min-h-screen bg-neutral-100 py-8 sm:py-12">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <header className="mb-8 flex flex-col items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#FDBF2D] text-2xl font-bold text-black">A</div>
            <h1 className="text-3xl font-bold text-neutral-900">Anoon</h1>
          </div>
          <nav className="flex max-w-full flex-wrap justify-center gap-1.5 rounded-2xl bg-white p-1.5 shadow-sm sm:gap-2 sm:rounded-full">
            {TABS.map((name) => (
              <button
                key={name}
                onClick={() => setTab(name)}
                className={
                  "rounded-full px-3 py-1.5 text-xs font-medium transition sm:px-4 sm:text-sm " +
                  (tab === name ? "bg-[#FDBF2D] text-black" : "text-neutral-500 hover:text-neutral-900")
                }
              >
                {name}
              </button>
            ))}
          </nav>
        </header>

        {/* Frames: phones stack on small screens and sit side-by-side on large;
            the wide desktop window always stacks and scrolls inside its own container */}
        {isDesktop ? (
          <div className="flex w-full flex-col gap-10 pb-4">
            <DesktopFrame />
            <DesktopFrame dark />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-8 pb-4 lg:flex-row lg:items-start lg:gap-12">
            <PhoneFrame>
              <div key={tab} className="anoon-noscroll anoon-screen-in flex h-full flex-col overflow-x-hidden">{Screen && <Screen />}</div>
            </PhoneFrame>
            <PhoneFrame dark>
              <div key={tab} className="anoon-noscroll anoon-screen-in flex h-full flex-col overflow-x-hidden">{Screen && <Screen />}</div>
            </PhoneFrame>
          </div>
        )}
      </div>
    </main>
  );
}
