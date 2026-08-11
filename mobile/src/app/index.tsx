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
  const restoreActiveMatch = useAnoonStore((s) => s.restoreActiveMatch);
  // «Токена нет» известно синхронно, ещё до первого рендера, поэтому решается
  // ленивым начальным состоянием, а не setState в эффекте: последнее дало бы
  // лишний каскадный рендер (и `react-hooks/set-state-in-effect`), а заодно
  // мигнуло бы сплэшем там, где ждать нечего.
  const [target, setTarget] = useState<
    '/(tabs)/chats' | '/onboarding' | '/anon-chat' | null
  >(() => (hasPersistedSession() ? null : '/onboarding'));

  useEffect(() => {
    let cancelled = false;
    if (!hasPersistedSession()) return;
    void (async () => {
      const ok = await restoreSession().catch(() => false);
      if (cancelled) return;
      // Токен мог протухнуть или быть отозван — тогда это обычный первый запуск.
      if (!ok) {
        setTarget('/onboarding');
        return;
      }
      // Свёрнутое приложение система выгружает сама, и анонимный разговор
      // умирал вместе с ним: пара на сервере жива (у сокета для этого есть
      // льготное окно), а клиент про неё забывал. Спрашиваем и возвращаемся.
      const inChat = await restoreActiveMatch().catch(() => false);
      if (cancelled) return;
      setTarget(inChat ? '/anon-chat' : '/(tabs)/chats');
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
