"use client"

import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

type EmojiCategory =
  | "Recent"
  | "Smileys"
  | "Animals"
  | "Food"
  | "Activities"
  | "Objects"
  | "Symbols"

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  onClose?: () => void
  className?: string
}

const CATEGORIES: Exclude<EmojiCategory, "Recent">[] = [
  "Smileys",
  "Animals",
  "Food",
  "Activities",
  "Objects",
  "Symbols",
]

/** Russian display labels (keys stay English — they index EMOJI_MAP/state). */
const CATEGORY_LABELS: Record<Exclude<EmojiCategory, "Recent">, string> = {
  Smileys: "Смайлы",
  Animals: "Животные",
  Food: "Еда",
  Activities: "Спорт",
  Objects: "Предметы",
  Symbols: "Символы",
}

const EMOJI_MAP: Record<Exclude<EmojiCategory, "Recent">, readonly string[]> = {
  Smileys: [
    "😀", "😁", "😂", "🤣", "😃", "😄", "😅", "😆",
    "😉", "😊", "😋", "😎", "😍", "😘", "🥰", "😗",
    "🙂", "🤗", "🤔", "🤨", "😐", "😑", "😶", "🙄",
    "😏", "😣", "😥", "😮", "🤐", "😴", "😪", "😜",
    "🤪", "😝", "🤑", "🤯", "😱", "😭", "😡", "🥳",
  ],
  Animals: [
    "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼",
    "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🙈",
    "🐔", "🐧", "🐦", "🐤", "🦆", "🦉", "🦄", "🐝",
    "🐛", "🦋", "🐌", "🐞", "🐢", "🐍", "🐙", "🦀",
    "🐳", "🐬", "🐟", "🐕", "🐈", "🐴", "🦓", "🐘",
  ],
  Food: [
    "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇",
    "🍓", "🫐", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝",
    "🍅", "🥑", "🍆", "🥔", "🥕", "🌽", "🌶️", "🥦",
    "🍞", "🥐", "🥨", "🧀", "🍔", "🍟", "🍕", "🌮",
    "🍣", "🍩", "🍪", "🎂", "🍫", "🍬", "🍭", "☕",
  ],
  Activities: [
    "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏉", "🎱",
    "🏓", "🏸", "🥅", "🏒", "🏑", "🥍", "🏏", "🥊",
    "🥋", "🎽", "🛹", "🛼", "⛸️", "🎿", "🏂", "🏋️",
    "🤸", "🤾", "🏄", "🏊", "🚴", "🎮", "🎲", "🎯",
    "🎳", "🎸", "🎹", "🎨", "🎭", "🎤", "🎧", "🎬",
  ],
  Objects: [
    "⌚", "📱", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "📷",
    "📸", "📹", "🎥", "📞", "☎️", "📺", "📻", "🔋",
    "🔌", "💡", "🔦", "🕯️", "📔", "📕", "📖", "📚",
    "✏️", "🖊️", "🖋️", "📝", "📁", "📂", "📅", "📌",
    "📎", "✂️", "🔒", "🔑", "🔨", "🧰", "🎁", "🛍️",
  ],
  Symbols: [
    "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍",
    "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘",
    "✨", "🔥", "💯", "✅", "❌", "❓", "❗", "⭐",
    "🌟", "💫", "⚡", "☀️", "🌈", "🎉", "🎊", "💤",
    "♻️", "🔞", "🆗", "🆕", "⬆️", "⬇️", "▶️", "⏸️",
  ],
}

const RECENT_EMOJI: readonly string[] = [
  "😀", "❤️", "👍", "🎉", "🔥", "😂", "🙏", "😍",
]

/** Compact popover for picking an emoji to insert into the chat composer. */
export default function EmojiPicker({
  onSelect,
  onClose,
  className,
}: EmojiPickerProps) {
  const [category, setCategory] = useState<
    Exclude<EmojiCategory, "Recent">
  >("Smileys")

  useEffect(() => {
    if (!onClose) return

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose?.()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  function handleSelect(emoji: string): void {
    onSelect(emoji)
  }

  return (
    <>
      {/* Transparent backdrop: tapping empty space closes the picker. Sits below
          the panel (z-0 vs z-10) so emoji taps still register. */}
      {onClose && (
        <button
          type="button"
          aria-label="Закрыть эмодзи"
          onClick={onClose}
          className="fixed inset-0 z-0 cursor-default bg-transparent"
        />
      )}
      <div
        role="dialog"
        aria-label="Emoji picker"
        className={cn(
          // Responsive: near-full-width on a phone, capped on wider screens.
          "relative z-10 flex w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-2 rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-lg",
          className
        )}
      >
      {RECENT_EMOJI.length > 0 && (
        <div>
          <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
            Недавние
          </p>
          <div className="grid grid-cols-8 gap-1">
            {RECENT_EMOJI.map((emoji, index) => (
              <button
                key={`recent-${index}-${emoji}`}
                type="button"
                onClick={() => handleSelect(emoji)}
                className="flex size-9 items-center justify-center rounded-lg text-xl hover:bg-muted active:scale-95"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 overflow-x-auto border-b border-border pb-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            aria-pressed={category === cat}
            className={cn(
              "shrink-0 rounded-md px-1.5 py-1 text-xs font-medium whitespace-nowrap text-muted-foreground hover:text-foreground",
              category === cat && "text-primary"
            )}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      <div className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto">
        {EMOJI_MAP[category].map((emoji, index) => (
          <button
            key={`${category}-${index}-${emoji}`}
            type="button"
            onClick={() => handleSelect(emoji)}
            className="flex size-9 items-center justify-center rounded-lg text-xl hover:bg-muted active:scale-95"
          >
            {emoji}
          </button>
        ))}
      </div>
      </div>
    </>
  )
}

export type { EmojiPickerProps }
