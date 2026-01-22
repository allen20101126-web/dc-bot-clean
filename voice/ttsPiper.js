// voice/ttsPiper.js (desktop + railway)
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PIPER_HOME = process.env.PIPER_HOME || path.join(process.cwd(), "piper");

function mustExist(p, label) {
  if (!fs.existsSync(p)) throw new Error(`${label} not found: ${p}`);
  return p;
}

async function ttsPiper(text) {
  // Railway(Linux) 會是 ./piper/piper
  // Windows 會是 ./piper/piper.exe（你也可以用 env 覆蓋）
  const bin =
    fs.existsSync(path.join(PIPER_HOME, "piper.exe"))
      ? path.join(PIPER_HOME, "piper.exe")
      : path.join(PIPER_HOME, "piper");

  mustExist(bin, "Piper bin");

  const model = mustExist(path.join(PIPER_HOME, "en_US-amy-medium.onnx"), "Piper model");
  const config = mustExist(path.join(PIPER_HOME, "en_US-amy-medium.onnx.json"), "Piper config");

  const input = String(text || "").trim().slice(0, 300);
  if (!input) return Buffer.alloc(0);

  const outPath = path.join(PIPER_HOME, `out-${Date.now()}.wav`);

  return await new Promise((resolve, reject) => {
    const child = spawn(bin, ["-m", model, "-c", config, "-f", outPath], {
      cwd: PIPER_HOME,
      windowsHide: true,
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
