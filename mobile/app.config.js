// Тонкий динамический слой поверх app.json — статикой здесь не обойтись.
//
// Google не принимает `anoon://` для нативных OAuth-клиентов: Android-клиенту
// нужна схема `<package>`, iOS-клиенту — перевёрнутый client id
// (`com.googleusercontent.apps.<префикс>`). Первый известен заранее, второй
// выводится из EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS, который владелец заводит в
// Google Cloud, — записать его в app.json нечем. Схема должна быть объявлена
// в самой сборке (CFBundleURLSchemes / intent-filter), поэтому она собирается
// здесь, на этапе резолва конфига.
//
// `anoon` остаётся ПЕРВОЙ: первая схема — это дефолтная для диплинков
// (expo-linking, `Linking.createURL`), и менять её нельзя.
// См. mobile/src/lib/google-auth.ts — тот же вывод схемы, но на клиенте.

/** `123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`. */
function reversedIosScheme(clientId) {
  const m = /^(.+)\.apps\.googleusercontent\.com$/.exec((clientId ?? '').trim());
  return m ? `com.googleusercontent.apps.${m[1]}` : null;
}

module.exports = ({ config }) => {
  const schemes = ['anoon'];

  const androidPackage = config.android?.package;
  if (androidPackage && !schemes.includes(androidPackage)) schemes.push(androidPackage);

  const iosScheme = reversedIosScheme(process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS);
  if (iosScheme) schemes.push(iosScheme);

  // Expo push tokens are issued per EAS project, so without a projectId the
  // phone gets no token and notifications stay dead (the toggle says so out
  // loud — see mobile/src/lib/push.ts). The value comes from `eas init`, which
  // needs the owner's Expo account; reading it from the environment means they
  // can point a build at the project without hand-editing app.json. `eas init`
  // writing the id into app.json directly also works — that path wins, because
  // this only fills in what is missing.
  const easProjectId = process.env.EAS_PROJECT_ID?.trim();
  const extra =
    config.extra?.eas?.projectId || !easProjectId
      ? config.extra
      : { ...config.extra, eas: { ...config.extra?.eas, projectId: easProjectId } };

  return { ...config, scheme: schemes, extra };
};
