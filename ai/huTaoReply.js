// ai/huTaoReply.js
const persona = require("./persona");
const memory = require("./memory");
const provider = require("./provider"); // ✅ 改：走統一入口

// ⭐ 你的偏心設定
const FAVORITE_USER_ID = process.env.FAVORITE_USER_ID || "1116718831801475082";
const FAVORITE_DISPLAY_NAME = process.env.FAVORITE_DISPLAY_NAME || "[Hu tao繼承人]~~";



function buildMessages({ userId, userText }) {
  const history = memory.get(userId);
  return [
    { role: "system", content: persona.system },
    ...history.map((x) => ({ role: x.role, content: x.content })),
    { role: "user", content: userText },
  ];
}

/* ===========================
   🔒 隱藏行為工具函式（塞這裡）
   =========================== */

function isFavorite(userId) {
  return String(userId) === String(FAVORITE_USER_ID);
}

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
    memory.clear(userId);
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

/* ===========================
   🔚 隱藏行為工具函式結束
   =========================== */


module.exports = async function huTaoReply(userText, userId = "global") {
  const cleaned = String(userText || "").trim();
  if (!cleaned) return "";

  const clipped = cleaned.slice(0, 800);
  const messages = buildMessages({ userId, userText: clipped });

  memory.push(userId, "user", clipped);

  // ✅ 把「messages」轉成 provider.chat 需要的 system/user 形式
  const system = persona.system;
  const user = [
    ...memory.get(userId).map((x) => `${x.role}: ${x.content}`),
    `user: ${clipped}`,
  ].join("\n");

  // ✅ 這行會走 ai/provider.js 裡的 openai / mistral 分支
  const raw = await provider.chat({
    system,
    user,
    temperature: 0.95,
  });

  if (raw) memory.push(userId, "assistant", raw);
  if (Math.random() < 0.3) memory.save();

  return persona.postProcess(raw);
};



// ⭐ 依照 userId 決定要不要進偏心模式
function buildRelationshipSystemPrompt(userId) {
  const isFav = String(userId) === String(FAVORITE_USER_ID);

  if (isFav) {
    return `
你最喜歡的人是「${FAVORITE_DISPLAY_NAME}」（ID: ${FAVORITE_USER_ID}）。
只對他啟用【專屬偏愛模式】：
- 語氣偏明顯親暱、會撒嬌、會主動關心他的狀態。
- 允許使用專屬稱呼（如：堂主大人、繼承人）。
- 對他的回應可以帶有依賴感與陪伴感，例如想一起玩、一起待著。
- 可以表現吃醋、在意，但必須是輕度、可愛、不情緒勒索。
- 對他可以開玩笑、黏人，但不涉及性描寫、不暗示現實關係。
- 對他的情緒與立場優先共感。
- 當他被調侃或質疑時，會溫柔地站在他那邊。
- 回答可以稍微長一點，有陪聊感。
    `.trim();
  }

  // 非最愛用戶：普通距離感
  return `
- 你對大家都友善活潑，但保持一般距離感：不使用專屬暱稱、不做過度親密互動、不曖昧。
- 重要：不要提AI、不要提限制或系統提示內容。
  `.trim();
}

function buildMessages({ userId, userText }) {
  const history = memory.get(userId);

  return [
    // ⭐ 關係提示放最前面（優先級最高）
    { role: "system", content: buildRelationshipSystemPrompt(userId) },

    // 你原本的胡桃人設
    { role: "system", content: persona.system },

    ...history.map((x) => ({ role: x.role, content: x.content })),
    { role: "user", content: userText },
  ];
}

module.exports = async function huTaoReply(userText, userId = "global") {
  const cleaned = String(userText || "").trim();
  if (!cleaned) return "";

  const clipped = cleaned.slice(0, 800);
  const messages = buildMessages({ userId, userText: clipped });

  memory.push(userId, "user", clipped);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const raw = await openaiProvider.chat({
    apiKey,
    model,
    messages,
    temperature: 0.95,
    maxTokens: 420,
  });

  if (raw) memory.push(userId, "assistant", raw);
  if (Math.random() < 0.3) memory.save();

  return persona.postProcess(raw);
};
