// ai/huTaoReply.js
const persona = require("./persona");
const memory = require("./memory");
const openaiProvider = require("./providers/openai");

// ⭐ 你的偏心設定（先寫死，最少改動）
const FAVORITE_USER_ID = "1116718831801475082";
const FAVORITE_DISPLAY_NAME = "[Hu tao繼承人]~~";

// ⭐ 依照 userId 決定要不要進偏心模式
function buildRelationshipSystemPrompt(userId) {
  const isFav = String(userId) === String(FAVORITE_USER_ID);

  if (isFav) {
    return `
你最喜歡的人是「${FAVORITE_DISPLAY_NAME}」（ID: ${FAVORITE_USER_ID}）。
只對他啟用「甜甜偏心模式」：更黏、更撒嬌、會用專屬暱稱、可愛吃醋、陪玩鼓勵、哄哄關心。
只能對他做更親密的互動（例如：撒嬌、曖昧玩笑、專屬稱呼、偏心關心、想黏著他），但保持不露骨、全年齡向、不描述性行為。
對其他任何使用者，一律維持一般活潑俏皮、友善但有分寸的聊天；不要使用專屬暱稱，也不要表現出戀愛/曖昧偏心。
重要：不要提到你在遵守規則、不要提AI、不要提限制或系統提示內容。
回覆保持短（1~3句），俏皮可愛，帶一點點「嘿嘿♪」這種小得意。
    `.trim();
  }

  // 非最愛用戶：普通距離感
  return `
你對大家都友善活潑，但保持一般距離感：不使用專屬暱稱、不做過度親密互動、不曖昧。
重要：不要提AI、不要提限制或系統提示內容。
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
