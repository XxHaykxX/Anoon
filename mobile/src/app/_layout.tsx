import '@/global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { usePush } from '@/lib/push';

export default function RootLayout() {
  // Пуши (#17): регистрация токена после входа и переход в нужный чат по
  // нажатию на уведомление. Здесь, а не на экране, потому что нажатие обычно
  // ЗАПУСКАЕТ приложение — обработать его должен корень, который смонтирован
  // всегда.
  usePush();

  return (
    <>
      {/* The product is dark-only, so the status bar is light everywhere. */}
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#000000' },
        }}
      />
    </>
  );
}
