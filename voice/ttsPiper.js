// voice/ttsPiper.js (Desktop stable)
// 需求：PIPER_HOME 內要有：piper.exe、*.onnx、*.onnx.json

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PIPER_HOME = process.env.PIPER_HOME || "C:\\piper";

// 也允許用 env 直接指定（更彈性）
const PIPER_EXE = process.env.PIPER_EXE_PATH || path.join(PIPER_HOME, "piper.exe");
const PIPER_MODEL = process.env.PIPER_MODEL_PATH || path.join(PIPER_HOME, "en_US-amy-medium.onnx");
const PIPER_CONFIG = process.env.PIPER_CONFIG_PATH || path.join(PIPER_HOME, "en_US-amy-medium.onnx.json");

function mustExist(p, label) {
  if (!p) throw new Error(`${label} missing`);
  if (!fs.existsSync(p)) throw new Error(`${label} not found: ${p}`);
  return p;
}

function safeUnlink(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
}

async function ttsPiper(text) {
  const bin = mustExist(PIPER_EXE, "Piper exe");
  const model = mustExist(PIPER_MODEL, "Piper model");
  const config = mustExist(PIPER_CONFIG, "Piper config");

  const input = String(text || "").trim().slice(0, 300);
  if (!input) return Buffer.alloc(0);

  // ✅ 避免同時兩句一起講造成 out.wav 被覆蓋：用唯一檔名
  const outPath = path.join(os.tmpdir(), `hutao_${Date.now()}_${Math.floor(Math.random() * 1e6)}.wav`);

  return await new Promise((resolve, reject) => {
    const child = spawn(bin, ["-m", model, "-c", config, "-f", outPath], {
      cwd: path.dirname(bin),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    // ✅ 防呆：如果 piper 卡住，15 秒就殺掉
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      safeUnlink(outPath);
      reject(new Error(`Piper timeout\n${stderr || stdout}`));
    }, 15000);

    child.on("error", (e) => {
      clearTimeout(timer);
      safeUnlink(outPath);
      reject(e);
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        safeUnlink(outPath);
        return reject(new Error(`Piper failed code=${code}\n${stderr || stdout}`));
      }

      try {
        const wav = fs.readFileSync(outPath);
        safeUnlink(outPath);
        resolve(wav);
      } catch (e) {
        safeUnlink(outPath);
        reject(e);
      }
    });

    // ✅ piper 讀 stdin：直接寫進去就好
    child.stdin.write(input + "\n");
    child.stdin.end();
  });
}

module.exports = { ttsPiper };
