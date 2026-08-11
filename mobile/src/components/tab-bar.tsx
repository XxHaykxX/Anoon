import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, Text, View } from 'react-native';

import {
  BellIcon,
  ChatIcon,
  PeopleIcon,
  RouletteIcon,
  UserCircleIcon,
  type IconProps,
} from '@/components/icons';
import { useAnoonStore } from '@/store';

/**
 * Нижняя навигация — порт `AnoonBottomNav` из `frontend/src/components/anoon/_shared.tsx`.
 *
 * Свой таб-бар, а не штатные опции `Tabs`, ровно по двум причинам из веба:
 * «Рулетка» — приподнятый жёлтый круг в центре, и бейджи с числами. Ни того,
 * ни другого `tabBarIcon`/`tabBarBadge` не рисуют.
 *
 * Бейджи здесь берутся из стора, а не приходят пропсами, как на телефонном
 * вебе (там каждый экран отдаёт свои числа в `AnoonBottomNav`). Бар живёт в
 * layout'е и переживает смену вкладки — это ровно тот случай, для которого веб
 * считает числа в `AnoonApp` для десктопного рельса.
 */

/** Токены из `global.css` — иконкам нужен конкретный цвет, класс им его не задаст. */
const COLOR = {
  primary: '#fdbf2d',
  primaryForeground: '#000000',
  mutedForeground: '#9a9aa0',
};

/**
 * На сколько круг «Рулетки» поднят над линией бара. То же значение, что даёт
 * вебу `-mt-7` (28px) минус 8px внутреннего отступа строки.
 */
const RAISE = 20;

type TabMeta = { label: string; Icon: (p: IconProps) => React.ReactElement };

/**
 * Порядок и подписи — как в вебе (`TABS`): пять слотов, симметрично вокруг
 * центрального действия. Ключ — имя файла маршрута в `app/(tabs)`.
 */
const TABS: Record<string, TabMeta> = {
  chats: { label: 'Чаты', Icon: ChatIcon },
  friends: { label: 'Контакты', Icon: PeopleIcon },
  home: { label: 'Рулетка', Icon: RouletteIcon },
  notifications: { label: 'Уведомления', Icon: BellIcon },
  profile: { label: 'Профиль', Icon: UserCircleIcon },
};

function capBadge(n: number): string {
  return n > 9 ? '9+' : String(n);
}

/** Красный кружок с числом. Позиция задаётся классами вызывающей стороны. */
function Badge({ count, className }: { count: number; className: string }) {
  if (count <= 0) return null;
  return (
    <View className={`h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 ${className}`}>
      <Text className="text-[10px] font-semibold text-white">{capBadge(count)}</Text>
    </View>
  );
}

export function AnoonTabBar({ state, navigation, insets }: BottomTabBarProps) {
  // Те же три числа, что веб считает в `AnoonApp.sideBadges`.
  const friends = useAnoonStore((s) => s.friends);
  const requests = useAnoonStore((s) => s.requests);
  const unreadCount = useAnoonStore((s) => s.unreadCount);
  const badges: Record<string, number> = {
    chats: friends.reduce((sum, f) => sum + (f.unread ?? 0), 0),
    friends: requests.filter((r) => r.direction === 'incoming').length,
    notifications: unreadCount,
  };

  return (
    <View className="bg-background" style={{ paddingBottom: Math.max(4, insets.bottom) }}>
      {/* Волосяная линия бара рисуется абсолютно, а не как `border-t` строки:
          круг «Рулетки» поднят ВЫШЕ неё, и если бы линия была границей строки,
          круг вылезал бы за пределы своего родителя. */}
      <View className="absolute left-0 right-0 h-px bg-border" style={{ top: RAISE }} />

      <View className="flex-row items-start justify-around">
        {state.routes.map((route, index) => {
          const meta = TABS[route.name];
          if (!meta) return null;
          const { label, Icon } = meta;
          const focused = state.index === index;
          const badge = badges[route.name] ?? 0;
          const primary = route.name === 'home';

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          // «Рулетка» — главное ДЕЙСТВИЕ, а не место: приподнятый жёлтый диск.
          // Поднимается не отрицательным отступом, а нулевым верхним падингом
          // против `RAISE + 8` у обычных вкладок — так ни один элемент не
          // выходит за границы родителя (на Android это чревато обрезкой).
          if (primary) {
            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={{ selected: focused }}
                onPress={onPress}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                className="flex-1 items-center gap-1">
                <View className="h-14 w-14 items-center justify-center rounded-full bg-primary">
                  <Icon size={28} color={COLOR.primaryForeground} />
                  <Badge count={badge} className="absolute -right-1 -top-1" />
                </View>
                <Text className="text-[10px] font-semibold text-primary">{label}</Text>
              </Pressable>
            );
          }

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              onPress={onPress}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, paddingTop: RAISE + 8 })}
              className="flex-1 items-center gap-0.5">
              <View>
                <Icon size={24} color={focused ? COLOR.primary : COLOR.mutedForeground} />
                <Badge count={badge} className="absolute -right-2 -top-1.5" />
              </View>
              <Text
                className={`text-[10px] font-medium ${focused ? 'text-primary' : 'text-muted-foreground'}`}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
