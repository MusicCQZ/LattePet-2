const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

const hasSigningIdentity = Boolean(process.env.MAC_CODESIGN_IDENTITY);
const hasNotarizationCredentials = Boolean(
  process.env.APPLE_ID
  && process.env.APPLE_APP_SPECIFIC_PASSWORD
  && process.env.APPLE_TEAM_ID,
);

module.exports = {
  packagerConfig: {
    asar: true,
    electronZipDir: process.env.ELECTRON_ZIP_DIR || undefined,
    executableName: 'LattePet',
    appBundleId: 'com.hatchpet.latte',
    appCategoryType: 'public.app-category.entertainment',
    extendInfo: {
      LSUIElement: true,
      NSHighResolutionCapable: true,
    },
    ignore: [
      /^\/\.gitignore$/,
      /^\/README\.md$/,
      /^\/assets\/latte\/animations\/.*-sheet-v\d+\.png$/,
      /^\/assets\/latte\/animations\/(click|sleep|stretch|walk)\/frames\//,
      /^\/assets\/latte\/animations\/click\/(?!(?:frames-v4)(?:\/|$)).+/,
      /^\/assets\/latte\/animations\/sleep\/(?!(?:frames-v4)(?:\/|$)).+/,
      /^\/assets\/latte\/animations\/stretch\/(?!(?:frames-v4)(?:\/|$)).+/,
      /^\/assets\/latte\/animations\/idle-blink\/(?!(?:frames-v2)(?:\/|$)).+/,
      /^\/assets\/latte\/animations\/idle-sniff\/(?!(?:frames-v2)(?:\/|$)).+/,
      /^\/assets\/latte\/animations\/idle-ear-tail\/(?!(?:frames-v2)(?:\/|$)).+/,
      /^\/assets\/latte\/animations\/walk\/(?!(?:frames-v29|transition-v9)(?:\/|$)).+/,
      /^\/assets\/latte\/outfits($|\/)/,
      /^\/assets\/latte\/previews\/(?:sleep|stretch|idle)-.*\.png$/,
      /^\/assets\/latte\/previews\/click-.*\.png$/,
      /^\/assets\/latte\/previews\/walk-.*\.png$/,
      /^\/assets\/latte\/previews\/walk-preview(?:-.*)?\.(css|html|js)$/,
      /^\/forge\.config\.js$/,
      /^\/images($|\/)/,
      /^\/package-lock\.json$/,
      /^\/test($|\/)/,
      /^\/scripts($|\/)/,
      /\.prompt\.md$/,
    ],
    osxSign: hasSigningIdentity
      ? { identity: process.env.MAC_CODESIGN_IDENTITY }
      : undefined,
    osxNotarize: hasNotarizationCredentials
      ? {
          tool: 'notarytool',
          appleId: process.env.APPLE_ID,
          appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
          teamId: process.env.APPLE_TEAM_ID,
        }
      : undefined,
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        name: 'Latte-Pet',
        format: 'ULFO',
      },
    },
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
