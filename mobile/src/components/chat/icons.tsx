import Svg, { Circle, Path, Rect, type SvgProps } from 'react-native-svg';

/**
 * Иконки, которых нет в `mobile/src/components/icons.tsx`. На вебе те же глифы
 * объявлены локально внутри экранов чата (правило проекта: `icons.tsx` не
 * трогаем) — здесь они собраны в одном месте, потому что два чата используют их
 * одинаково. Path-данные скопированы один в один из веб-версий.
 */

export type IconProps = { size?: number; color?: string } & Omit<SvgProps, 'color'>;

/**
 * Цветовые токены из `global.css` в виде значений. RN не знает `currentColor`,
 * а иконке нужен явный `stroke` — класс на SVG цвет не задаёт.
 */
export const CHAT_COLORS = {
  foreground: '#ffffff',
  muted: '#9a9aa0',
  primary: '#fdbf2d',
  destructive: '#ff453a',
  /** Текст на исходящем (жёлтом) пузыре. */
  onBubbleOut: '#000000',
  /** Прочитано — внутри жёлтого пузыря; синий статуса на нём почти не виден. */
  readTickOnPrimary: '#1d4ed8',
} as const;

function base({ size = 24, color = CHAT_COLORS.foreground, ...rest }: IconProps) {
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

/** Вертикальное троеточие — меню чата. */
export const MoreIcon = ({ size = 24, color = CHAT_COLORS.foreground, ...rest }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} {...rest}>
    <Circle cx="12" cy="5" r="1.7" />
    <Circle cx="12" cy="12" r="1.7" />
    <Circle cx="12" cy="19" r="1.7" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M6 9l6 6 6-6" />
  </Svg>
);

export const ReplyIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M9 7 4 12l5 5" />
    <Path d="M4 12h11a5 5 0 0 1 5 5v1" />
  </Svg>
);

export const EditIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3z" />
    <Path d="M13.5 6.5l3 3" />
  </Svg>
);

export const ReportIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M5 21V4h11l-1.5 3.5L16 11H5" />
  </Svg>
);

export const EyeIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <Circle cx="12" cy="12" r="3" />
  </Svg>
);

export const EyeOffIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M3 3l18 18" />
    <Path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
    <Path d="M9.9 4.6A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a13.3 13.3 0 0 1-2.16 2.94M6.5 6.6A13.3 13.3 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 3-.48" />
  </Svg>
);

export const DocumentIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <Path d="M14 3v5h5" />
  </Svg>
);

/** Микрофон с перечёркиванием — выключенная запись голоса (нет expo-audio). */
export const MicOffIcon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="9" y="3" width="6" height="11" rx="3" />
    <Path d="M6 11a6 6 0 0 0 12 0M12 17v4M3 3l18 18" />
  </Svg>
);
