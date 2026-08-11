import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Vibration } from 'react-native';

import { onCall, sendCall } from '@/lib/callSignaling';
import { useAnoonStore } from '@/store';
import { useCallStore, type CallMedia } from '@/store/callStore';

/**
 * Звонки на телефоне. Своей логики здесь нет: и стор (`@/store/callStore`), и
 * сигналинг (`@/lib/callSignaling`) — общие с вебом, кадры `call:*` едут по тому
 * же сокету companion. Этот файл — то, чем `AnoonApp` служит вебу: один
 * слушатель на всё приложение и переход на экран звонка.
 */

/**
 * `callStore.startCall` берёт `callId` из `crypto.randomUUID()`. В браузере это
 * есть всегда, у Hermes глобального `crypto` нет вообще — без этой подстановки
 * первый же исходящий звонок падал бы с ReferenceError. Тот же приём, что с
 * `indexedDB` в `src/entry.ts`; ставим при загрузке модуля, а его импортируют
 * оба экрана чата, то есть до любого `startCall`.
 */
const g = globalThis as { crypto?: { randomUUID?: () => string } };
if (!g.crypto?.randomUUID) {
  g.crypto = Object.assign(g.crypto ?? {}, { randomUUID: Crypto.randomUUID });
}

/**
 * Позвонить собеседнику из шапки чата. `peerHandle` — тот же непрозрачный
 * хендл, что и на вебе: настоящий `#ID` у друга и в раскрытой паре,
 * по-матчевый алиас (`~K7X2QM`), пока разговор анонимен.
 */
export function placeCall(peerHandle: string, peerName: string, media: CallMedia): void {
  useCallStore.getState().startCall(peerHandle, peerName, media);
  router.push('/call');
}

/**
 * Единственный на приложение слушатель `call:*` — порт эффекта из `AnoonApp`.
 * Экран `/call` держит собственную подписку на кадры СВОЕГО звонка
 * (offer/answer/ICE/hangup); здесь закрыты только дыры, где он ещё не
 * смонтирован: новый входящий оффер и сброс, прилетевший, пока телефон звонит.
 *
 * Монтировать в корне (`app/_layout.tsx`), рядом с `usePush()`: входящий звонок
 * должен доставать пользователя на любом экране, а не только в чате.
 */
export function useCalls(): void {
  useEffect(() => {
    return onCall((frame) => {
      const active = useCallStore.getState().call;
      if (frame.type === 'call:offer') {
        if (active && active.status !== 'ended') {
          // Уже разговариваем — отбиваем как «занято», чтобы звонящий увидел
          // обычный сброс, а не бесконечный гудок.
          if (frame.from) {
            sendCall({ type: 'call:hangup', to: frame.from, callId: frame.callId, reason: 'busy' });
          }
          return;
        }
        // `from` проставляет сервер: настоящий #ID от друга, по-матчевый алиас
        // от анонимного собеседника. Промах по списку друзей на алиасе —
        // штатный: у анонимного звонящего имени нет.
        const from = frame.from ?? '';
        const peerName =
          useAnoonStore.getState().friends.find((f) => f.hashId === from)?.displayName ??
          'Собеседник';
        useCallStore.getState().receiveIncoming({
          status: 'incoming',
          peerHashId: from,
          peerName,
          callId: frame.callId,
          media: (frame.media as CallMedia | undefined) ?? 'audio',
          incomingOffer: frame.sdp as RTCSessionDescriptionInit | undefined,
        });
      } else if (frame.type === 'call:hangup' || frame.type === 'call:unavailable') {
        if (!active || active.callId !== frame.callId) return;
        // В «outgoing»/«active» экран звонка смонтирован и разбирает эти кадры
        // сам; здесь остаётся только звонящий телефон.
        if (active.status === 'incoming' || frame.type === 'call:unavailable') {
          useCallStore
            .getState()
            .endCall(frame.type === 'call:unavailable' ? 'unavailable' : 'missed');
        }
      }
    });
  }, []);

  // Входящий: показать экран и вибрировать, пока не ответили. Вибрация вместо
  // рингтона — звук потребовал бы аудиофайла в `assets/`, а телефон в кармане
  // на вибрацию отзывается не хуже. Отбой/приём меняют статус, и cleanup гасит
  // её на любом пути выхода, включая удалённый сброс.
  const status = useCallStore((s) => s.call?.status);
  useEffect(() => {
    if (status !== 'incoming') return;
    Vibration.vibrate([0, 700, 900], true);
    router.push('/call');
    return () => Vibration.cancel();
  }, [status]);
}
