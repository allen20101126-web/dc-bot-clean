const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hutao", {
  speak: (text) => ipcRenderer.invoke("hutao:speak", text),
});

