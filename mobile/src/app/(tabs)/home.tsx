import { Text, View } from 'react-native';

import { useAnoonStore } from '@/store';

/**
 * Still a stub, but a stub wired to the real store shared with the web app —
 * enough to keep `store` + the companion/Tinode clients in the native bundle,
 * so a typecheck or an export catches anything that does not survive the trip
 * to React Native. The screen itself arrives in wave 3.
 */
export default function HomeScreen() {
  const user = useAnoonStore((s) => s.user);
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-lg text-foreground">home</Text>
      <Text className="text-sm text-muted-foreground">{user?.hashId ?? 'не в сети'}</Text>
    </View>
  );
}
