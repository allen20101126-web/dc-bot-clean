// ai/providers/mistral.js
// Minimal Mistral provider (chat completions style)

async function chat({ baseUrl, model, system, user, temperature = 0.9 }) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("Missing MISTRAL_API_KEY");

  const url = `${String(baseUrl || "https://api.mistral.ai/v1").replace(/\/$/, "")}/chat/completions`;

  const body = {
    model: model || "mistral-small-latest",
    temperature,
    messages: [
      { role: "system", content: String(system || "") },
      { role: "user", content: String(user || "") },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Mistral API error ${res.status}: ${text}`);
  }

  const json = JSON.parse(text);
  return json?.choices?.[0]?.message?.content?.trim() || "";
}

module.exports = { chat };
