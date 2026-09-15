const appJson = require('./app.json');

const VARIANT = process.env.APP_VARIANT;

const APP_NAME = {
  development: 'CNG Now (Dev)',
  preview: 'CNG Now (Preview)',
};

const PACKAGE_SUFFIX = {
  development: '.dev',
  preview: '.preview',
};

const suffix = PACKAGE_SUFFIX[VARIANT] ?? '';
const name = APP_NAME[VARIANT] ?? appJson.expo.name;

module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
    name,
    android: {
      ...appJson.expo.android,
      package: `${appJson.expo.android.package}${suffix}`,
    },
    ios: {
      ...appJson.expo.ios,
      bundleIdentifier: `${appJson.expo.ios.bundleIdentifier}${suffix}`,
    },
  },
};
