module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // jsxImportSource is what makes NativeWind's `className` prop transform
      // and typecheck. The `nativewind/babel` preset alone is not enough.
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: [
      // Reanimated 4 moved its Babel plugin into `react-native-worklets`.
      // The old "react-native-reanimated/plugin" path is a hard build error.
      // This must stay LAST in the plugins array.
      "react-native-worklets/plugin",
    ],
  };
};
