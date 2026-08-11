import Svg, { Circle, Ellipse, Path, Rect, type SvgProps } from 'react-native-svg';

/**
 * The web icon set (`frontend/src/components/icons.tsx`), same names, same path
 * data — react-native-svg takes the identical `d` strings, so an icon that
 * changes there is a copy-paste away from being right here too.
 *
 * Two differences the platform forces:
 *   • `currentColor` does not exist. Every icon takes `color` (default: the
 *     foreground token) and passes it as the stroke.
 *   • `size` replaces the web's `className="size-6"`, since a class cannot set
 *     an SVG element's width/height on native.
 */

export type IconProps = { size?: number; color?: string } & Omit<SvgProps, 'color'>;

/** Foreground token — the colour the web icons inherited from their parent. */
const DEFAULT_COLOR = '#ffffff';

function base({ size = 24, color = DEFAULT_COLOR, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest,
  };
}

export const SearchIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="11" cy="11" r="7" />
    <Path d="m21 21-3.5-3.5" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M12 5v14M5 12h14" />
  </Svg>
);
export const UserCircleIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="12" cy="12" r="9" />
    <Circle cx="12" cy="10" r="3" />
    <Path d="M6.5 18a6 6 0 0 1 11 0" />
  </Svg>
);
export const PhoneIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M5 4h3l2 5-2 1.5a11 11 0 0 0 5 5L20 13l1 3v3a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" />
  </Svg>
);
export const VideoIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="3" y="6" width="12" height="12" rx="2" />
    <Path d="m15 10 6-3v10l-6-3z" />
  </Svg>
);
export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="m15 6-6 6 6 6" />
  </Svg>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="m9 6 6 6-6 6" />
  </Svg>
);
export const MicIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="9" y="3" width="6" height="11" rx="3" />
    <Path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
  </Svg>
);
export const CameraIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <Circle cx="12" cy="13" r="3.2" />
  </Svg>
);
export const EmojiIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M8.5 14a4 4 0 0 0 7 0" />
    <Path d="M9 9.5h.01M15 9.5h.01" />
  </Svg>
);
export const PaperclipIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M20 11.5 12 19a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5" />
  </Svg>
);
export const SendIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M4 12 20 4l-6 16-3-7z" />
  </Svg>
);
export const BellIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
    <Path d="M10 20a2 2 0 0 0 4 0" />
  </Svg>
);
export const BellOffIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M6 9a6 6 0 0 1 9-5M18 9c0 5 2 6 2 6H8M10 20a2 2 0 0 0 4 0M3 3l18 18" />
  </Svg>
);
export const SlidersIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M4 8h11M18 8h2M4 16h4M11 16h9" />
    <Circle cx="16" cy="8" r="2" />
    <Circle cx="9" cy="16" r="2" />
  </Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </Svg>
);
export const BlockIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="m6 6 12 12" />
  </Svg>
);
export const ChatIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4V6a1 1 0 0 1 1-1z" />
  </Svg>
);
export const PeopleIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="9" cy="9" r="3" />
    <Path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6a3 3 0 0 1 0 6M18 19a5 5 0 0 0-3-4.6" />
  </Svg>
);
export const PlayIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M8 6l10 6-10 6z" fill={p.color ?? DEFAULT_COLOR} stroke="none" />
  </Svg>
);
export const PauseIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="7" y="6" width="3.5" height="12" rx="1" fill={p.color ?? DEFAULT_COLOR} stroke="none" />
    <Rect x="13.5" y="6" width="3.5" height="12" rx="1" fill={p.color ?? DEFAULT_COLOR} stroke="none" />
  </Svg>
);
export const LockIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="5" y="10" width="14" height="10" rx="2" />
    <Path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Svg>
);
export const ShieldIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
  </Svg>
);
export const GlobeIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M5 13l4 4 10-10" />
  </Svg>
);
export const DoubleCheckIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M2 13l4 4 8-8M12 15l1 1 8-8" />
  </Svg>
);
export const MissedCallIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M15 4h5v5M20 4l-6 6-3-3-6 6" />
  </Svg>
);
export const DatabaseIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Ellipse cx="12" cy="6" rx="7" ry="3" />
    <Path d="M5 6v12c0 1.7 3 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3 3 7 3s7-1.3 7-3" />
  </Svg>
);
export const GridIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="4" y="4" width="7" height="7" rx="1.5" />
    <Rect x="13" y="4" width="7" height="7" rx="1.5" />
    <Rect x="4" y="13" width="7" height="7" rx="1.5" />
    <Rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Svg>
);
export const DownloadIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" />
  </Svg>
);
export const ForwardIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M13 6l6 6-6 6M19 12H5" />
  </Svg>
);
/** Two crossing arrows — the roulette action (web keeps this one in _shared). */
export const RouletteIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M4 7h11l-2.5-2.5M15 7l-2.5 2.5" />
    <Path d="M20 17H9l2.5 2.5M9 17l2.5-2.5" />
  </Svg>
);
