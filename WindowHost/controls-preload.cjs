// This preload runs only in the application-owned controls view, never ChatGPT.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appModeControls', Object.freeze({
  action: (...args) => ipcRenderer.invoke('app-mode-controls:action', ...args),
  onState: callback => {
    if (typeof callback !== 'function') throw new TypeError('A state callback is required.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('app-mode-controls:state', listener);
    ipcRenderer.invoke('app-mode-controls:state').then(callback).catch(() => {});
    return () => ipcRenderer.removeListener('app-mode-controls:state', listener);
  },
}));
