console.log("========== AI PROVIDER DEBUG ==========");
console.log("[ENV] AI_PROVIDER =", process.env.AI_PROVIDER);
console.log("[ENV] MISTRAL_MODEL =", process.env.MISTRAL_MODEL);
console.log("[ENV] OPENAI_MODEL =", process.env.OPENAI_MODEL);
console.log("=======================================");


const config = require("../config.json");

const openai = require("./providers/openai");
const mistral = require("./providers/mistral");

function getProviderName() {
  // env 優先，其次才吃 config.json
  return (process.env.AI_PROVIDER || config.ai?.provider || "openai").toLowerCase();
}


async function chat({ system, user, temperature = 0.9 }) {
  const provider = getProviderName();
  console.log("[AI] Selected provider =", provider);
  console.log("[AI] ENV models:", {
    MISTRAL_MODEL: process.env.MISTRAL_MODEL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  });


  if (provider === "mistral") {
  const baseUrl =
    process.env.MISTRAL_BASE_URL ||
    config.ai?.mistral?.baseUrl ||
    "https://api.mistral.ai/v1";

  const model =
    process.env.MISTRAL_MODEL ||
    config.ai?.mistral?.model ||
    "mistral-small-latest";

  return mistral.chat({ baseUrl, model, system, user, temperature });
}


  // default: openai
  const model = config.ai?.openai?.model || "gpt-4o-mini";
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  return openai.chat({ model, system, user, temperature });
}

module.exports = { chat };
