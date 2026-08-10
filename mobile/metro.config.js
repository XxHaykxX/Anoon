// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// `globalClassNamePolyfill` teaches the React Native primitives themselves to
// take `className`, so a screen ported from the web keeps its plain
// `import { View, Text } from 'react-native'` and needs no wrapper components.
module.exports = withNativewind(config, { globalClassNamePolyfill: true });
