import * as React from "react";

// Minimal outline icon set (stroke = currentColor) for the Anoon messenger clone.
type P = React.SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

export const SearchIcon = (p: P) => (<svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m21 21-3.5-3.5" /></svg>);
export const PlusIcon = (p: P) => (<svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>);
export const UserCircleIcon = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.5 18a6 6 0 0 1 11 0" /></svg>);
export const BookmarkIcon = (p: P) => (<svg {...base(p)}><path d="M6 4h12v16l-6-4-6 4z" /></svg>);
export const PhoneIcon = (p: P) => (<svg {...base(p)}><path d="M5 4h3l2 5-2 1.5a11 11 0 0 0 5 5L20 13l1 3v3a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" /></svg>);
export const VideoIcon = (p: P) => (<svg {...base(p)}><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 6-3v10l-6-3z" /></svg>);
export const ChevronLeftIcon = (p: P) => (<svg {...base(p)}><path d="m15 6-6 6 6 6" /></svg>);
export const ChevronRightIcon = (p: P) => (<svg {...base(p)}><path d="m9 6 6 6-6 6" /></svg>);
export const MicIcon = (p: P) => (<svg {...base(p)}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4" /></svg>);
export const CameraIcon = (p: P) => (<svg {...base(p)}><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.2" /></svg>);
export const EmojiIcon = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M8.5 14a4 4 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" /></svg>);
export const PaperclipIcon = (p: P) => (<svg {...base(p)}><path d="M20 11.5 12 19a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5" /></svg>);
export const SendIcon = (p: P) => (<svg {...base(p)}><path d="M4 12 20 4l-6 16-3-7z" /></svg>);
export const PinIcon = (p: P) => (<svg {...base(p)}><path d="M15 3l6 6-4 1-3 3v5l-2-2-2 2v-5L4 6l1-4 6 6z" /></svg>);
export const BellIcon = (p: P) => (<svg {...base(p)}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>);
export const BellOffIcon = (p: P) => (<svg {...base(p)}><path d="M6 9a6 6 0 0 1 9-5M18 9c0 5 2 6 2 6H8M10 20a2 2 0 0 0 4 0M3 3l18 18" /></svg>);
export const SlidersIcon = (p: P) => (<svg {...base(p)}><path d="M4 8h11M18 8h2M4 16h4M11 16h9" /><circle cx="16" cy="8" r="2" /><circle cx="9" cy="16" r="2" /></svg>);
export const DownloadIcon = (p: P) => (<svg {...base(p)}><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" /></svg>);
export const SortLinesIcon = (p: P) => (<svg {...base(p)}><path d="M4 7h16M4 12h11M4 17h6" /></svg>);
export const CloseIcon = (p: P) => (<svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>);
export const TrashIcon = (p: P) => (<svg {...base(p)}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>);
export const BlockIcon = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></svg>);
export const ForwardIcon = (p: P) => (<svg {...base(p)}><path d="M13 6l6 6-6 6M19 12H5" /></svg>);
export const ChatIcon = (p: P) => (<svg {...base(p)}><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4V6a1 1 0 0 1 1-1z" /></svg>);
export const PeopleIcon = (p: P) => (<svg {...base(p)}><circle cx="9" cy="9" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6a3 3 0 0 1 0 6M18 19a5 5 0 0 0-3-4.6" /></svg>);
export const GridIcon = (p: P) => (<svg {...base(p)}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>);
export const BotIcon = (p: P) => (<svg {...base(p)}><rect x="5" y="8" width="14" height="10" rx="3" /><path d="M12 5v3M9 13h.01M15 13h.01" /></svg>);
export const MegaphoneIcon = (p: P) => (<svg {...base(p)}><path d="M4 10v4l3 1 1 4h2l-1-4 9 3V6l-9 3H5a1 1 0 0 0-1 1z" /></svg>);
export const BoltIcon = (p: P) => (<svg {...base(p)}><path d="M13 3 5 13h5l-1 8 8-11h-5z" /></svg>);
export const PlayIcon = (p: P) => (<svg {...base(p)}><path d="M8 6l10 6-10 6z" fill="currentColor" stroke="none" /></svg>);
export const PauseIcon = (p: P) => (<svg {...base(p)}><rect x="7" y="6" width="3.5" height="12" rx="1" fill="currentColor" stroke="none" /><rect x="13.5" y="6" width="3.5" height="12" rx="1" fill="currentColor" stroke="none" /></svg>);
export const LockIcon = (p: P) => (<svg {...base(p)}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>);
export const ShieldIcon = (p: P) => (<svg {...base(p)}><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" /></svg>);
export const DatabaseIcon = (p: P) => (<svg {...base(p)}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3 3 7 3s7-1.3 7-3" /></svg>);
export const SunIcon = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></svg>);
export const MoonIcon = (p: P) => (<svg {...base(p)}><path d="M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10z" /></svg>);
export const GlobeIcon = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>);
export const CheckIcon = (p: P) => (<svg {...base(p)}><path d="M5 13l4 4 10-10" /></svg>);
export const DoubleCheckIcon = (p: P) => (<svg {...base(p)}><path d="M2 13l4 4 8-8M12 15l1 1 8-8" /></svg>);
export const MissedCallIcon = (p: P) => (<svg {...base(p)}><path d="M15 4h5v5M20 4l-6 6-3-3-6 6" /></svg>);
