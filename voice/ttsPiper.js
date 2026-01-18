// voice/ttsPiper.js
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEFAULT_PIPER_EXE = "C:\\piper\\piper.exe";
const DEFAULT_MODEL = "C:\\piper\\en_US-amy-medium.onnx";
const DEFAULT_CONFIG = "C:\\piper\\en_US-amy-medium.onnx.json";

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {}
}

function safeText(t) {
  return String(t || "")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .trim()
    .slice(0, 280); // Piper 太長也會慢，先保守一點
}

async function ttsPiper(text) {
  const piperExe = process.env.PIPER_EXE || DEFAULT_PIPER_EXE;
  const modelPath = process.env.PIPER_MODEL || DEFAULT_MODEL;
  const configPath = process.env.PIPER_CONFIG || DEFAULT_CONFIG;

  if (!fs.existsSync(piperExe)) throw new Error(`Piper exe not found: ${piperExe}`);
  if (!fs.existsSync(modelPath)) throw new Error(`Piper model not found: ${modelPath}`);
  if (!fs.existsSync(configPath)) throw new Error(`Piper config not found: ${configPath}`);

  const outDir = path.join(process.cwd(), "voice", "tmp");
  ensureDir(outDir);

  const outWav = path.join(outDir, `piper_${Date.now()}_${Math.random().toString(16).slice(2)}.wav`);
  const input = safeText(text) || "Hello.";

  const args = ["-m", modelPath, "-c", configPath, "-f", outWav];

  await new Promise((resolve, reject) => {
    const p = spawn(piperExe, args, { stdio: ["pipe", "pipe", "pipe"] });

    let stderr = "";
    let stdout = "";

    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));

    // 把文字餵給 piper stdin
    p.stdin.write(input, "utf8");
    p.stdin.end();

    const killTimer = setTimeout(() => {
      try { p.kill("SIGKILL"); } catch {}
      reject(new Error("Piper TTS timeout"));
    }, 25_000);

    p.on("error", (e) => {
      clearTimeout(killTimer);
      reject(e);
    });

    p.on("close", (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        return reject(new Error(`Piper exit=${code}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`));
      }
      resolve();
    });
  });

  if (!fs.existsSync(outWav)) throw new Error("Piper finished but wav not created");

  const buf = fs.readFileSync(outWav);
  // 清掉暫存
  try { fs.unlinkSync(outWav); } catch {}

  return buf; // WAV bytes
}

module.exports = { ttsPiper };
