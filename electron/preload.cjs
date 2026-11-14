// Puente entre la interfaz (sin acceso a Node) y el proceso principal. Solo expone estas funciones.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('arazzoDesktop', {
  platform: process.platform,
  request: (req) => ipcRenderer.invoke('http:request', req),
  abort: (id) => ipcRenderer.send('http:abort', id),
  openFolder: () => ipcRenderer.invoke('fs:openFolder'),
  writeFile: (path, text) => ipcRenderer.invoke('fs:writeFile', { path, text }),
  saveAs: (suggestedName, text) => ipcRenderer.invoke('fs:saveAs', { suggestedName, text }),
})
