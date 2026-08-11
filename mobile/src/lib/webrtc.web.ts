import { View } from 'react-native';

/**
 * Веб-половина `webrtc.ts`. Веб-сборка мобильного клиента существует только как
 * смоук-тест (`expo export --platform web`) — продуктовый веб живёт в
 * `frontend/` и звонит своим `CallScreen`. Здесь достаточно того, чтобы сборка
 * собиралась и статически рендерилась; звонить из неё никто не должен, поэтому
 * попытка честно падает с понятным текстом, а не притворяется работающей.
 */

/** У браузера видео рисует `<video>`, а не нативная вью. */
export const RTCView = View;

export function createPeerConnection(): never {
  throw new Error('Звонки доступны только в нативной сборке');
}

export function getUserMedia(_video: boolean): never {
  throw new Error('Звонки доступны только в нативной сборке');
}
