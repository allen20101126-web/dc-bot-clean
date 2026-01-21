const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PIPER_HOME = process.env.PIPER_HOME || "/app/piper";

function mustExist(p, label) {
  if (!fs.existsSync(p)) throw new Error(`${label} not found: ${p}`);
  return p;
}

async function ttsPiper(text) {
  const bin = mustExist(path.join(PIPER_HOME, "piper"), "Piper bin"); // ✅ 注意：沒有 .exe
  const model = mustExist(path.join(PIPER_HOME, "model.onnx"), "Piper model");
  const config = mustExist(path.join(PIPER_HOME, "model.onnx.json"), "Piper config");

  const input = String(text || "").trim().slice(0, 300);
  if (!input) return Buffer.alloc(0);

  const outPath = path.join(PIPER_HOME, `out_${Date.now()}.wav`);

  return await new Promise((resolve, reject) => {
    const child = spawn(bin, ["-m", model, "-c", config, "-f", outPath], {
      cwd: PIPER_HOME,
    });

    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));

    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Piper failed code=${code}\n${err}`));
      try {
        const wav = fs.readFileSync(outPath);
        fs.unlinkSync(outPath);
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
