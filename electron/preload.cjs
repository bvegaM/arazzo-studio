// Puente entre la interfaz (sin acceso a Node) y el proceso principal. Solo expone estas funciones.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('arazzoDesktop', {
  platform: process.platform,
  request: (req) => ipcRenderer.invoke('http:request', req),
  abort: (id) => ipcRenderer.send('http:abort', id),
  openFolder: () => ipcRenderer.invoke('fs:openFolder'),
  writeFile: (path, text) => ipcRenderer.invoke('fs:writeFile', { path, text }),
  saveAs: (suggestedName, text) => ipcRenderer.invoke('fs:saveAs', { suggestedName, text }),
  wsPickFolder: (mode) => ipcRenderer.invoke('ws:pickFolder', mode),
  wsList: (root, dir) => ipcRenderer.invoke('ws:list', { root, path: dir }),
  wsRead: (root, path) => ipcRenderer.invoke('ws:read', { root, path }),
  wsWrite: (root, path, text) => ipcRenderer.invoke('ws:write', { root, path, text }),
  wsRemove: (root, path) => ipcRenderer.invoke('ws:remove', { root, path }),
  wsRemoveDir: (root, path) => ipcRenderer.invoke('ws:removeDir', { root, path }),
  wsDefaultLocation: () => ipcRenderer.invoke('ws:defaultLocation'),
  wsPickLocation: (current) => ipcRenderer.invoke('ws:pickLocation', current),
  wsCreateAt: (parent, folder) => ipcRenderer.invoke('ws:createAt', { parent, folder }),
  wsReveal: (root, path) => ipcRenderer.invoke('ws:reveal', { root, path }),
  wsTrash: (root) => ipcRenderer.invoke('ws:trash', root),
  secretGet: (key) => ipcRenderer.invoke('secret:get', key),
  secretSet: (key, value) => ipcRenderer.invoke('secret:set', { key, value }),
  secretRemove: (key) => ipcRenderer.invoke('secret:remove', key),
  secretRemovePrefix: (prefix) => ipcRenderer.invoke('secret:removePrefix', prefix),
  appSetTheme: (theme) => ipcRenderer.invoke('app:setTheme', theme),
  appToggleDevTools: () => ipcRenderer.invoke('app:toggleDevTools'),
  appMetrics: () => ipcRenderer.invoke('app:metrics'),
})
