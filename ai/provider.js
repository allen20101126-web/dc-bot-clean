// ai/provider.js
// Simple provider wrapper (Mistral only by default)

const DEFAULT_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 30_000);
const DEFAULT_RETRIES = Number(process.env.AI_RETRIES || 2);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

function buildMistralMessages(system, user) {
  const msgs = [];
  if (system && String(system).trim()) {
    msgs.push({ role: "system", content: String(system) });
  }
  msgs.push({ role: "user", content: String(user || "") });
  return msgs;
}

async function chatMistral({ system, user, temperature = 0.7, max_tokens } = {}) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("Missing MISTRAL_API_KEY");

  const model = process.env.MISTRAL_MODEL || "mistral-small-latest";
  const endpoint = process.env.MISTRAL_ENDPOINT || "https://api.mistral.ai/v1/chat/completions";

  const body = {
    model,
    messages: buildMistralMessages(system, user),
    temperature: Number(temperature ?? 0.7),
  };

  if (Number.isFinite(Number(max_tokens))) body.max_tokens = Number(max_tokens);

  let lastErr = null;

  for (let attempt = 0; attempt <= DEFAULT_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        DEFAULT_TIMEOUT_MS
      );

      const text = await res.text();

      if (!res.ok) {
        // 429/5xx 走重試；其他直接噴
        const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
        const err = new Error(`Mistral chat failed: ${res.status} ${text.slice(0, 500)}`);
        if (!retryable) throw err;
        lastErr = err;
        if (attempt < DEFAULT_RETRIES) {
          await sleep(600 * (attempt + 1));
          continue;
        }
        throw err;
      }

      const json = JSON.parse(text);
      const out =
        json?.choices?.[0]?.message?.content ??
        json?.choices?.[0]?.delta?.content ??
        "";

      return String(out || "").trim();
    } catch (e) {
      // fetch failed / timeout / abort 也重試
      lastErr = e;
      const msg = String(e?.message || e);
      const retryable =
        msg.includes("fetch failed") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("AbortError");

      if (!retryable || attempt >= DEFAULT_RETRIES) throw e;
      await sleep(600 * (attempt + 1));
    }
  }

  throw lastErr || new Error("Unknown Mistral error");
}

// ===== exported API (match your existing calls) =====
async function chat(opts) {
  const provider = (process.env.PROVIDER || "mistral").toLowerCase();

  if (provider !== "mistral") {
    // 你說「不要 openai」，所以我這裡直接擋掉，避免混到舊邏輯
    throw new Error(`Unsupported PROVIDER="${provider}". Use PROVIDER=mistral`);
  }

  return await chatMistral(opts);
}

module.exports = { chat };
