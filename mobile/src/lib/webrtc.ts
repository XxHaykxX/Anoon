import {
  RTCPeerConnection as NativeRTCPeerConnection,
  RTCView,
  mediaDevices,
} from 'react-native-webrtc';

import { RTC_CONFIG } from '@/lib/tinode';

/**
 * Нативная половина WebRTC. Сигналинг НЕ здесь: кадры offer/answer/ICE/hangup
 * едут через тот же `@/lib/callSignaling`, что и на вебе — этот файл закрывает
 * ровно одно отличие телефона от браузера: `RTCPeerConnection`, `getUserMedia`
 * и вью для видео берутся из `react-native-webrtc`, а не из глобалов DOM.
 *
 * Пара к нему — `webrtc.web.ts`: `react-native-webrtc` — нативный модуль, его
 * нет в веб-сборке, а `expo export --platform web` рендерит маршруты
 * статически, то есть импорт бы выполнился. Metro и tsc сами выбирают `.web.ts`
 * для веба и этот файл для ios/android.
 */

export { RTCView };

/**
 * Наружу отдаём соединение под ДОМовским типом, хотя объект нативный.
 *
 * `react-native-webrtc@124` публикует сломанные декларации: `lib/typescript/`
 * ссылается на `./vendor/event-target-shim`, которого в пакете нет, и вместе с
 * ним пропадает весь `addEventListener`. Рантайм при этом соответствует W3C —
 * поэтому экран звонка пишется против стандартных типов (как веб-`CallScreen`),
 * а единственная неправда живёт в двух приведениях ниже.
 */
export type PeerConnection = RTCPeerConnection;

/** Поток с нативной добавкой: `toURL()` — это то, что понимает `RTCView`. */
export type CallStream = MediaStream & { toURL(): string; release(): void };

/**
 * Соединение с теми же ICE-серверами, что у веба (`RTC_CONFIG` из общего
 * `lib/tinode.ts`) — второго списка STUN/TURN быть не должно. Передаём только
 * `iceServers`: остальные поля DOM-конфига (`certificates`) описаны в
 * `react-native-webrtc` другими типами и нам не нужны.
 */
export function createPeerConnection(): PeerConnection {
  return new NativeRTCPeerConnection({
    iceServers: RTC_CONFIG.iceServers,
  }) as unknown as PeerConnection;
}

/** Микрофон (всегда) и камера (для видеозвонка). Разрешения — из `app.json`. */
export function getUserMedia(video: boolean): Promise<CallStream> {
  return mediaDevices.getUserMedia({ audio: true, video }) as unknown as Promise<CallStream>;
}
