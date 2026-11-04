// electron-builder configuration for Last Lantern desktop builds.
// Driven by tools/package-desktop.mjs, which stages a minimal app (this folder's main/preload/steam
// + the Vite build in ./game) into release/stage-desktop so no source, dev deps or node_modules ship.
//
// Distribution targets:
//   Steam     → the "dir" target per OS (unpacked folder = Steam depot content). No installer, no auto-update.
//   itch.io   → "zip" (win/mac) and "tar.gz"/"AppImage" (linux) via the butler CLI.
//   Direct    → NSIS installer (win), DMG (mac), AppImage (linux).
// Code signing: set CSC_LINK/CSC_KEY_PASSWORD (win/mac) and APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID
// (notarization) in CI. Unsigned builds work but trigger SmartScreen / Gatekeeper warnings.
'use strict';

const path = require('node:path');

const root = path.resolve(__dirname, '..');

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.lastlantern.game', // TODO(release): replace with the final reverse-DNS id before the first public build
  productName: 'Last Lantern',
  copyright: 'Copyright © 2026 Last Lantern team',
  electronVersion: require(path.join(root, 'node_modules', 'electron', 'package.json')).version,
  // tools/package-desktop.mjs runs electron-builder with projectDir = release/stage-desktop (the app).
  directories: {
    output: path.join(root, 'release', 'desktop'),
    buildResources: path.join(root, 'electron', 'assets'),
  },
  files: ['**/*', '!**/*.map', '!THIRD_PARTY_NOTICES.txt', '!CREDITS.md'],
  // Licence notices sit next to the executable where players (and Steam/itch reviewers) can find them.
  extraFiles: [
    { from: 'THIRD_PARTY_NOTICES.txt', to: 'THIRD_PARTY_NOTICES.txt' },
    { from: 'CREDITS.md', to: 'CREDITS.md' },
  ],
  asar: true,
  // Game assets are already compressed (OGG/GLB/WOFF2); "normal" keeps packaging fast with no size loss.
  compression: 'normal',
  npmRebuild: false,
  nodeGypRebuild: false,
  publish: null,
  artifactName: 'last-lantern-${version}-${os}-${arch}.${ext}',
  // Electron fuses: lock the binary down (no ELECTRON_RUN_AS_NODE, no --inspect, asar integrity).
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }, { target: 'zip', arch: ['x64'] }],
    icon: path.join(root, 'electron', 'assets', 'icon.ico'),
    legalTrademarks: 'Last Lantern',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Last Lantern',
    uninstallDisplayName: 'Last Lantern',
    deleteAppDataOnUninstall: false, // keep save files (Hearth progress) across reinstalls
  },

  mac: {
    target: [{ target: 'dmg', arch: ['universal'] }, { target: 'zip', arch: ['universal'] }],
    category: 'public.app-category.games',
    icon: path.join(root, 'electron', 'assets', 'icon.png'),
    hardenedRuntime: true,
    gatekeeperAssess: false,
    darkModeSupport: true,
    minimumSystemVersion: '12.0',
  },
  dmg: {
    title: 'Last Lantern ${version}',
    backgroundColor: '#120b2e',
  },

  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }, { target: 'tar.gz', arch: ['x64'] }],
    category: 'Game',
    icon: path.join(root, 'electron', 'assets', 'icons'),
    executableName: 'last-lantern',
    synopsis: 'Carry the last light through a night that wants it out.',
    description: 'A 3D roguelite survival game where your light is your life.',
    maintainer: 'Last Lantern team',
    desktop: { entry: { StartupWMClass: 'last-lantern', Keywords: 'game;roguelite;survivors;' } },
  },
};
