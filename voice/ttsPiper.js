// voice/ttsPiper.js
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function safeText(t) {
  return String(t || "")
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 300); // 你可以調長，但先保守
}

/**
 * 需要環境變數：
 * - PIPER_BIN: piper 可執行檔路徑（預設 "piper"）
 * - PIPER_MODEL: 模型 .onnx 路徑（必填）
 * 可選：
 * - PIPER_SPEAKER: 多說話人模型用（數字）
 * - PIPER_RATE: 語速(文字越大越慢/或看模型)，先不強制
 */
async function ttsPiper(text) {
  const bin = process.env.PIPER_BIN || "piper";
  const model = process.env.PIPER_MODEL;
  if (!model) throw new Error("Missing PIPER_MODEL (path to .onnx)");

  const speaker = (process.env.PIPER_SPEAKER || "").trim(); // optional
  const input = safeText(text);
  if (!input) return Buffer.alloc(0);

  const outFile = path.join(os.tmpdir(), `piper_${Date.now()}_${Math.random().toString(16).slice(2)}.wav`);

  const args = ["--model", model, "--output_file", outFile];
  if (speaker) args.push("--speaker", speaker);

  await new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });

    let errBuf = "";
    const killTimer = setTimeout(() => {
      try { p.kill("SIGKILL"); } catch {}
      reject(new Error("Piper TTS timeout"));
    }, 30_000);

    p.stderr.on("data", (d) => (errBuf += d.toString()));

    p.on("error", (e) => {
      clearTimeout(killTimer);
      reject(e);
    });

    p.on("close", (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        reject(new Error(`Piper exited ${code}: ${errBuf.slice(0, 500)}`));
      } else {
        resolve();
      }
    });

    // 把文字丟給 piper stdin
    p.stdin.write(input, "utf8");
    p.stdin.end();
  });

  const wav = fs.readFileSync(outFile);
  try { fs.unlinkSync(outFile); } catch {}
  return wav;
}

module.exports = { ttsPiper };
