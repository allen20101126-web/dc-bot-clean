// ai/huTaoReply.js
const persona = require("./persona");
const memory = require("./memory");
const provider = require("./provider");

// ===== 偏愛設定 =====
const FAVORITE_USER_ID = process.env.FAVORITE_USER_ID || "1116718831801475082";
const FAVORITE_DISPLAY_NAME = process.env.FAVORITE_DISPLAY_NAME || "[Hu tao繼承人]~~";

// ===== 關係判斷 =====
function isFavorite(userId) {
  return String(userId) === String(FAVORITE_USER_ID);
}

// ===== 隱藏行為 =====
function addSecretTail(replyText, userId) {
  if (!isFavorite(userId)) return replyText;

  if (Math.random() < 0.3) {
    const tails = [
      `哼哼～今天也要一起玩嗎？`,
      `嗯…別太累，胡桃會盯著你休息的！`,
      `（小聲）只對你這樣說喔。`,
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
    return `胡桃今天心情：${moods[Math.floor(Math.random() * moods.length)]}（只跟你說）`;
  }

  if (t.startsWith("#title ")) {
    const title = t.slice(7).trim().slice(0, 12);
    if (!title) return `要給胡桃一個稱呼嘛～例如：#title 堂主大人`;
    memory.push(userId, "system", `從現在開始，用「${title}」稱呼我。`);
    return `好呀～那我以後就叫你「${title}」啦，嘻嘻。`;
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
- 允許使用專屬稱呼（如：堂主大人、繼承人）。
- 回應可以更長、更有陪伴感。
- 可以輕度吃醋、偏心、護短，但不情緒勒索、不涉及性描寫。
- 對他的情緒與立場優先共感。
- 當他被調侃或質疑時，會溫柔地站在他那邊。
- 回答可以稍微長一點，有陪聊感。
`.trim();
  }

  return `
- 你對其他人保持友善與距離感。
- 不使用專屬暱稱、不過度親密、不曖昧。
- 不提 AI、不提系統、不提限制。
`.trim();
}

// ===== 主入口 =====
module.exports = async function huTaoReply(userText, userId = "global") {
  const cleaned = String(userText || "").trim();
  if (!cleaned) return "";

  // 先處理暗號
  const secret = handleSecretCommands(cleaned, userId);
  if (secret) return secret;

  const clipped = cleaned.slice(0, 800);

  // 組 prompt
  const system = [
    buildRelationshipSystemPrompt(userId),
    persona.system,
  ].join("\n\n");

  memory.push(userId, "user", clipped);

  const raw = await provider.chat({
    system,
    user: clipped,
    temperature: 0.95,
  });

  if (raw) memory.push(userId, "assistant", raw);
  if (Math.random() < 0.3) memory.save();

  let final = persona.postProcess(raw);
  final = addSecretTail(final, userId);
  return final;
};
