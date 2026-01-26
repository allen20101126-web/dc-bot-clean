// voice/ttsPiper.js (Railway/Linux + Desktop compatible)
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function mustExist(p, label) {
  if (!fs.existsSync(p)) throw new Error(`${label} not found: ${p}`);
  return p;
}

const PIPER_HOME = process.env.PIPER_HOME || "./piper";

// 把 ./piper 轉成絕對路徑（Railway / Windows 都穩）
function abs(...parts) {
  return path.resolve(process.cwd(), PIPER_HOME, ...parts);
}

async function ttsPiper(text) {
  const input = String(text || "").trim().slice(0, 300);
  if (!input) return Buffer.alloc(0);

  // Linux 版：binary 名稱通常是 piper（沒有 .exe）
  // Windows 版：piper.exe
  const bin = fs.existsSync(abs("piper.exe")) ? abs("piper.exe") : abs("piper");
  mustExist(bin, "Piper exe");

  const model = mustExist(abs("en_US-amy-medium.onnx"), "Piper model");
  const config = mustExist(abs("en_US-amy-medium.onnx.json"), "Piper config");

  const outPath = abs("out.wav");

  return await new Promise((resolve, reject) => {
    const child = spawn(bin, ["-m", model, "-c", config, "-f", outPath], {
      cwd: path.resolve(process.cwd(), PIPER_HOME),
      windowsHide: true,
      env: process.env,
    });

    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));

    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Piper failed code=${code}\n${err}`));

      try {
        const wav = fs.readFileSync(outPath);
        try { fs.unlinkSync(outPath); } catch {}
        resolve(wav);
      } catch (e) {
        reject(e);
      }
    });

    child.stdin.write(input + "\n");
    child.stdin.end();
  });
}

module.exports = { ttsPiper };
