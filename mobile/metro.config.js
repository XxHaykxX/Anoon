// Learn more https://docs.expo.io/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');

/** The web app's sources, shared with this client — see `../frontend/src`. */
const SHARED_SRC = path.resolve(__dirname, '..', 'frontend', 'src');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// The store and the companion/Tinode clients are imported straight out of the
// web app (tsconfig `paths` maps `@/*` to both roots), so Metro has to watch a
// folder outside the project.
config.watchFolders = [SHARED_SRC];

// ...and those files must not drag in the web app's OWN node_modules: it has a
// second copy of react and zustand, and two Reacts in one bundle is an instant
// "invalid hook call". Bare imports coming from the shared sources are resolved
// as if they came from this project instead.
const APP_ANCHOR = path.join(__dirname, 'package.json');
const parentResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = parentResolver ?? context.resolveRequest;
  if (context.originModulePath.startsWith(SHARED_SRC) && !/^[./]/.test(moduleName)) {
    return resolve({ ...context, originModulePath: APP_ANCHOR }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

// `globalClassNamePolyfill` teaches the React Native primitives themselves to
// take `className`, so a screen ported from the web keeps its plain
// `import { View, Text } from 'react-native'` and needs no wrapper components.
module.exports = withNativewind(config, { globalClassNamePolyfill: true });
