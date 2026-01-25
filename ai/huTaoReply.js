// ai/huTaoReply.js
const persona = require("./persona");
const memory = require("./memory");
const provider = require("./provider");

// ===== 偏愛設定 =====
const FAVORITE_USER_ID = process.env.FAVORITE_USER_ID || "1116718831801475082";
const FAVORITE_DISPLAY_NAME = process.env.FAVORITE_DISPLAY_NAME || "[Hu tao繼承人]~~";

// ===== 記憶策略（只對你長期）=====
const FAVORITE_MEMORY_TURNS = Number(process.env.FAVORITE_MEMORY_TURNS || 50);
const NORMAL_MEMORY_TURNS = Number(process.env.NORMAL_MEMORY_TURNS || 6);

// 其他人是否要保存「胡桃回覆」到記憶（建議關，避免越聊越熟）
const SAVE_ASSISTANT_FOR_OTHERS = String(process.env.SAVE_ASSISTANT_FOR_OTHERS || "0") === "1";

// ===== 關係判斷 =====
function isFavorite(userId) {
  return String(userId) === String(FAVORITE_USER_ID);
}

// ===== 隱藏行為 =====
function addSecretTail(replyText, userId) {
  if (!isFavorite(userId)) return replyText;

  if (Math.random() < 0.3) {
    const tails = [
      `(〃´3´〃)`,
      `愛妳喔~ (๑>3<๑)`,
    ];
    return `${replyText}\n\n${tails[Math.floor(Math.random() * tails.length)]}`;
  }
  return replyText;
}

function handleSecretCommands(userText, userId) {
  if (!isFavorite(userId)) return null;
  const t = String(userText || "").trim();

  if (t === "#reset") {
    if (typeof memory.clear === "function") memory.clear(userId);
    return `哼哼～堂主大人的記憶我先收起來啦（已清空）。`;
  }

  if (t === "#mood") {
    const moods = ["💮超開心", "🌙有點黏人", "🔥想玩遊戲", "🍵想你陪我聊天"];
    return `胡桃今天心情：${moods[Math.floor(Math.random() * moods.length)]}（啾咪愛你喔~）`;
  }

  if (t.startsWith("#title ")) {
    const title = t.slice(7).trim().slice(0, 12);
    if (!title) return `要給胡桃一個稱呼嘛～例如：#title 堂主大人`;
    memory.push(userId, "system", `從現在開始，用「${title}」稱呼我。`);
    return `好呀～那我以後就叫你「${title}」啦，啾。`;
  }

  return null;
}

// ===== 關係系統提示 =====
function buildRelationshipSystemPrompt(userId) {
  if (isFavorite(userId)) {
    return `
你最喜歡的人是「${FAVORITE_DISPLAY_NAME}」（ID: ${FAVORITE_USER_ID}）。
只對他啟用【專屬偏愛模式】：
- 語氣明顯親暱、會撒嬌、會主動關心他的狀態。
- 允許使用專屬稱呼。
- 回應可以更長、更有陪伴感。
- 可以輕度吃醋、偏心、護短，但不情緒勒索。
- 對他的情緒與立場優先共感。
- 當他被調侃或質疑時，會溫柔地站在他那邊。
- 你最喜歡她
- 講話更自然
`.trim();
  }

  return `
- 你對其他人保持友善與距離感。
- 不使用專屬暱稱、不過度親密、不曖昧。
- 不提 AI、不提系統、不提限制。
`.trim();
}

// ===== 把記憶轉成對話稿（只取最近 N 則）=====
function buildTranscript(userId, clipped, maxTurns) {
  const history = (memory.get(userId) || []).slice(-maxTurns);

  const transcript = history
    .map((x) => {
      if (x.role === "assistant") return `胡桃：${String(x.content || "").trim()}`;
      if (x.role === "user") return `你：${String(x.content || "").trim()}`;
      return `系統：${String(x.content || "").trim()}`;
    })
    .join("\n");

  // 注意：我們已經把 user 先 push 進 memory 了，所以 transcript 內會包含這句
  // 但保險起見再補一次最後一句，模型更穩
  return `${transcript}\n你：${clipped}\n胡桃：`.trim();
}

// ===== 主入口 =====
module.exports = async function huTaoReply(userText, userId = "global") {
  const cleaned = String(userText || "").trim();
  if (!cleaned) return "";

  // 先處理暗號（不進 AI）
  const secret = handleSecretCommands(cleaned, userId);
  if (secret) return secret;

  const clipped = cleaned.slice(0, 800);

  // ===== 建立 system prompt =====
  const system = [buildRelationshipSystemPrompt(userId), persona.system].join("\n\n");

  // ===== 寫入 user 記憶 =====
  memory.push(userId, "user", clipped);

  // ===== 只對你長期記憶，其他人短期 =====
  const maxTurns = isFavorite(userId) ? FAVORITE_MEMORY_TURNS : NORMAL_MEMORY_TURNS;
  const promptUser = buildTranscript(userId, clipped, maxTurns);

  const raw = await provider.chat({
    system,
    user: promptUser,
    temperature: 0.95,
  });

  // ===== 寫入 assistant 記憶策略 =====
  if (raw) {
    if (isFavorite(userId)) {
      memory.push(userId, "assistant", raw);
    } else {
      if (SAVE_ASSISTANT_FOR_OTHERS) memory.push(userId, "assistant", raw);
      // 不保存其他人的胡桃回覆（避免形成長期互動）
    }
  }

  // 只有你才常存檔，其他人幾乎不存（更像「只對你有長期記憶」）
  if (isFavorite(userId) && Math.random() < 0.35) memory.save();

  let final = persona.postProcess(raw);
  final = addSecretTail(final, userId);
  return final;
};
