// Last Lantern — preload (sandboxed). Exposes a tiny, explicit desktop API to the game page.
// The web build never depends on it: always feature-detect `window.lanternDesktop`.
//
//   window.lanternDesktop = {
//     isDesktop: true, platform: 'win32' | 'darwin' | 'linux', version: string,
//     toggleFullscreen(): Promise<boolean>, setFullscreen(on): Promise<boolean>, isFullscreen(): Promise<boolean>,
//     onFullscreenChange(cb): () => void,          // returns an unsubscribe function
//     quit(): Promise<void>,                       // show a "Quit to desktop" button when present
//     openExternal(httpsUrl): Promise<void>,       // wishlist / Discord / credits links
//     unlockAchievement(id): Promise<boolean>,     // Steam achievement (no-op without Steamworks)
//     steamStatus(): Promise<{ enabled: boolean, appId: number | null, user: string | null }>,
//   }
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lanternDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  version: (process.argv.find((a) => a.startsWith('--ll-version=')) ?? '').slice('--ll-version='.length),
  toggleFullscreen: () => ipcRenderer.invoke('ll:toggle-fullscreen'),
  setFullscreen: (on) => ipcRenderer.invoke('ll:set-fullscreen', !!on),
  isFullscreen: () => ipcRenderer.invoke('ll:is-fullscreen'),
  onFullscreenChange: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_e, on) => cb(!!on);
    ipcRenderer.on('ll:fullscreen', handler);
    return () => ipcRenderer.removeListener('ll:fullscreen', handler);
  },
  quit: () => ipcRenderer.invoke('ll:quit'),
  openExternal: (url) => ipcRenderer.invoke('ll:open-external', String(url)),
  unlockAchievement: (id) => ipcRenderer.invoke('ll:unlock-achievement', String(id)),
  steamStatus: () => ipcRenderer.invoke('ll:steam-status'),
}));
