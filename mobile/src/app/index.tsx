import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { hasPersistedSession } from '@/store/slices';
import { useAnoonStore } from '@/store';

/**
 * Точка входа. Тот же разбор, что и у оболочки веба (`AnoonApp.tsx`): если
 * сессия сохранена — молча логинимся токеном и уходим в «Чаты», иначе онбординг.
 *
 * Без этого приложение показывало онбординг ВСЕГДА: токен лежит в keystore,
 * но в памяти после перезапуска его нет, и вошедший пользователь каждый раз
 * начинал с приветствия — на телефоне это заметнее, чем на вебе, потому что
 * приложение выгружается системой само.
 *
 * Гидратации здесь нет (нативный рендер только клиентский), поэтому решение
 * можно принимать сразу; сплэш висит ровно на время входа по токену.
 */
export default function Index() {
  const restoreSession = useAnoonStore((s) => s.restoreSession);
  const [target, setTarget] = useState<'/(tabs)/chats' | '/onboarding' | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!hasPersistedSession()) {
      setTarget('/onboarding');
      return;
    }
    void (async () => {
      const ok = await restoreSession().catch(() => false);
      if (cancelled) return;
      // Токен мог протухнуть или быть отозван — тогда это обычный первый запуск.
      setTarget(ok ? '/(tabs)/chats' : '/onboarding');
    })();
    return () => {
      cancelled = true;
    };
    // Только при монтировании.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!target) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#fdbf2d" />
      </View>
    );
  }
  return <Redirect href={target} />;
}
