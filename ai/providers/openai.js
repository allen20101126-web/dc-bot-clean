// ai/providers/openai.js
const OpenAI = require("openai");

async function chat({ apiKey, baseURL, model, messages, temperature = 0.9, maxTokens = 400 }) {
  const client = new OpenAI({ apiKey, baseURL });
  const res = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  return res.choices?.[0]?.message?.content?.trim() || "";
}

module.exports = { chat };
