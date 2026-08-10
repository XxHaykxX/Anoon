/// <reference types="expo/types" />

// NOTE: hand-written and committed on purpose. The Expo CLI stopped generating
// this file in SDK 57, but `tsconfig.json` still includes it, and it is what
// pulls in `expo/types` — where `declare module '*.css'` lives. Without it
// `import '@/global.css'` fails to typecheck (TS2882).
