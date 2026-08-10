import { Text, View } from 'react-native';

/**
 * Placeholder body for a route that exists but has no screen yet. Every screen
 * from the web app (`frontend/src/components/anoon`) lands on one of these and
 * replaces it; the route name is the same id the web shell uses in `anoonNav.ts`.
 */
export function StubScreen({ name }: { name: string }) {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-lg text-foreground">{name}</Text>
    </View>
  );
}
