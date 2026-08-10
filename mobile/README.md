# anoon — мобильный клиент (Expo)

Каркас нативного клиента: тема, токены и маршруты те же, что в вебе (`../frontend`), экраны пока заглушки.

## Запуск

```bash
npm install
npx expo start          # Metro + QR-код; на телефоне нужен dev build (см. ниже), не Expo Go
npx tsc --noEmit        # типы
npx expo export --platform android   # проверка сборки бандла
```

Dev build на телефон — через EAS: `npm i -g eas-cli && eas login && eas build --profile development --platform android`
(готовый `eas.json` появится вместе с первым билдом: `eas build:configure`). В сторы пока не выкладываемся —
приложение ставится ссылкой из EAS, поэтому ни App Store Connect, ни Google Play Console на этом этапе не нужны.

## Стили

NativeWind v5 + Tailwind v4. Токены — в `src/global.css`, имена классов совпадают с вебом (`bg-background`,
`text-muted-foreground`, `bg-primary`, `bg-bubble-out`…), так что разметка экранов переносится почти как есть.
`className` работает прямо на примитивах `react-native` (`globalClassNamePolyfill` в `metro.config.js`).

## Что дальше

Следующим шагом переносится общая с вебом логика: `frontend/src/store/*`, `src/lib/companion.ts`,
`src/lib/tinode.ts`, `src/types/*`. Браузерных API там немного (4 обращения в `companion.ts`, по 8 в
`tinode.ts` и `slices.ts` — `localStorage`/`window`/`document`/`navigator`), их нужно спрятать за адаптер:
на нативе вместо `localStorage` — `expo-secure-store`/`AsyncStorage`, вместо `window`/`document` — заглушки.
