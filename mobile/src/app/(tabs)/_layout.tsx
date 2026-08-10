import { Tabs } from 'expo-router';

// The same five tabs as the web bottom nav (`ANOON_MAIN_TABS`), in the same
// order — home sits in the middle. Icons come with the real screens.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: '#000000' },
        tabBarStyle: { backgroundColor: '#000000', borderTopColor: '#3a3a3c' },
        tabBarActiveTintColor: '#fdbf2d',
        tabBarInactiveTintColor: '#9a9aa0',
      }}>
      <Tabs.Screen name="chats" options={{ title: 'Чаты' }} />
      <Tabs.Screen name="friends" options={{ title: 'Друзья' }} />
      <Tabs.Screen name="home" options={{ title: 'Главная' }} />
      <Tabs.Screen name="notifications" options={{ title: 'Уведомления' }} />
      <Tabs.Screen name="profile" options={{ title: 'Профиль' }} />
    </Tabs>
  );
}
