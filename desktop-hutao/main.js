const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function createWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile("index.html");
}

ipcMain.handle("hutao:speak", async (_event, text) => {
  const response = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: text,
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  const filePath = path.join(app.getPath("temp"), "hutao.wav");
  fs.writeFileSync(filePath, buffer);

  return filePath;
});

app.whenReady().then(createWindow);
