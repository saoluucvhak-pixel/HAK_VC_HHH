'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vcApi', {
  invoke: (channel, args) => ipcRenderer.invoke('api', channel, args),
  openFile: (opts) => ipcRenderer.invoke('dialog.openFile', opts || {}),
  saveExport: (info) => ipcRenderer.invoke('dialog.saveExport', info),
  showItem: (p) => ipcRenderer.invoke('shell.showItem', p),
  openPath: (p) => ipcRenderer.invoke('shell.openPath', p),
  storageInfo: () => ipcRenderer.invoke('storage.info'),
  pickFolder: () => ipcRenderer.invoke('dialog.pickFolder'),
  changeStorage: (o) => ipcRenderer.invoke('storage.change', o),
  isElectron: true,
});
