import { Tabs } from 'expo-router/js-tabs';

import { AnoonTabBar } from '@/components/tab-bar';

/**
 * Пять вкладок в том же порядке, что на вебе (`AnoonBottomNav`): «Рулетка» —
 * центральный слот.
 *
 * `expo-router/js-tabs`, а не `expo-router`: реэкспорт `Tabs` из корня помечен
 * deprecated в SDK 57 и указывает именно сюда. Нужен JS-навигатор, потому что
 * только он принимает `tabBar` — а без своего бара не нарисовать приподнятый
 * круг и бейджи с числами.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <AnoonTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: '#000000' },
      }}>
      <Tabs.Screen name="chats" />
      <Tabs.Screen name="friends" />
      <Tabs.Screen name="home" />
      <Tabs.Screen name="notifications" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
