import * as Clipboard from 'expo-clipboard';

/**
 * Копирование текста в системный буфер обмена.
 *
 * `Clipboard` из ядра React Native выпилен; штатная замена в Expo SDK 57 —
 * `expo-clipboard` (https://docs.expo.dev/versions/v57.0.0/sdk/clipboard/), и
 * его API асинхронный, в отличие от старого `Clipboard.setString`.
 *
 * Возвращает `false`, если система отказала: экран не должен рисовать
 * «Скопировано», когда в буфер ничего не легло.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    return await Clipboard.setStringAsync(text);
  } catch {
    return false;
  }
}
