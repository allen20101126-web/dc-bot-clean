console.log("### BOOT VERSION: DC-BOT-CLEAN / VOICE + MEMORY DEBUG ###");

// index.js
const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

// HuTao AI core
const huTaoReply = require("./ai/huTaoReply");

// proactive ping uses your existing provider/persona
const provider = require("./ai/provider");
const persona = require("./ai/persona");

// Voice (TTS -> VC)
const { speakMp3Bytes, leaveGuild } = require("./voice/voiceManager");
const { ttsOpenAI } = require("./voice/ttsOpenAI");

// 讀取 config.json
let config = JSON.parse(fs.readFileSync("./config.json", "utf8"));

// ===== 偏愛設定 =====
const FAVORITE_USER_ID = process.env.FAVORITE_USER_ID || "1116718831801475082";

// ===== Voice 開關 =====
const VOICE_ENABLED = String(process.env.VOICE_ENABLED || "1") === "1";
const VOICE_ONLY_FAVORITE = String(process.env.VOICE_ONLY_FAVORITE || "1") === "1";

// ===== 主動冒泡參數 =====
const FAVORITE_PING_COOLDOWN_MIN = Number(process.env.FAVORITE_PING_COOLDOWN_MIN || 180); // 3 小時
const FAVORITE_PING_CHANCE = Number(process.env.FAVORITE_PING_CHANCE || 0.25); // 25%
let lastFavoritePingAt = 0;

// Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences, // 你已加
    GatewayIntentBits.GuildVoiceStates, // ✅ 語音一定要加
  ],
});

// ===== 基本設定 =====
const lastPromoTime = {};
const PROMO_CHANCE = 0.05;
const aboutCooldown = new Map(); // userId -> lastTimeMs

// ===== 洗頻累犯加重（越禁越久）=====
const spamStrike = {}; // userId -> { strikes, lastStrikeAt }

// ===== 工具：角色判斷 =====
const hasAnyRole = (member, roleNames = []) =>
  roleNames.some((rn) => member?.roles?.cache?.some((r) => r.name === rn));

const isAdmin = (member) => hasAnyRole(member, config.roleControl?.adminRoles || []);
const isProtected = (member) => hasAnyRole(member, config.roleControl?.protectedRoles || []);

// ===== 工具：log（用 fetch，不靠 cache）=====
const getLogChannel = async () => {
  if (!config.log?.enabled || !config.log.channelId) return null;
  return await client.channels.fetch(config.log.channelId).catch(() => null);
};

const logAction = async (text) => {
  const ch = await getLogChannel();
  if (!ch) return;
  await ch.send(text).catch(() => {});
};

// ===== 工具：寫回 config.json（給 /antispam set 用）=====
const saveConfig = () => {
  try {
    fs.writeFileSync("./config.json", JSON.stringify(config, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("saveConfig error:", e);
    return false;
  }
};

// ===== 補齊預設值（避免 config.json 缺欄位爆炸）=====
const ensureDefaults = () => {
  // antiSpam
  if (!config.antiSpam) config.antiSpam = {};
  if (typeof config.antiSpam.enabled !== "boolean") config.antiSpam.enabled = true;
  if (!Number.isInteger(config.antiSpam.maxMessages)) config.antiSpam.maxMessages = 4;
  if (!Number.isInteger(config.antiSpam.intervalSeconds)) config.antiSpam.intervalSeconds = 4;
  if (!Number.isInteger(config.antiSpam.warnCooldownSeconds)) config.antiSpam.warnCooldownSeconds = 8;
  if (!Number.isInteger(config.antiSpam.timeoutSeconds)) config.antiSpam.timeoutSeconds = 30;
  if (typeof config.antiSpam.deleteSpamMessages !== "boolean") config.antiSpam.deleteSpamMessages = true;
  if (!Array.isArray(config.antiSpam.ignoredChannelIds)) config.antiSpam.ignoredChannelIds = [];
  if (typeof config.antiSpam.countSlashCommands !== "boolean") config.antiSpam.countSlashCommands = true;
  if (typeof config.antiSpam.action !== "string") config.antiSpam.action = "timeout";

  // 公告禁言
  if (typeof config.antiSpam.announceTimeout !== "boolean") config.antiSpam.announceTimeout = true;
  if (!Number.isInteger(config.antiSpam.announceCooldownSeconds)) config.antiSpam.announceCooldownSeconds = 12;

  // escalation
  if (!config.antiSpamEscalation) config.antiSpamEscalation = {};
  if (typeof config.antiSpamEscalation.enabled !== "boolean") config.antiSpamEscalation.enabled = true;
  if (!Number.isInteger(config.antiSpamEscalation.baseTimeoutSeconds)) config.antiSpamEscalation.baseTimeoutSeconds = 30;
  if (!Number.isInteger(config.antiSpamEscalation.multiplier)) config.antiSpamEscalation.multiplier = 3;
  if (!Number.isInteger(config.antiSpamEscalation.maxStage)) config.antiSpamEscalation.maxStage = 6;
  if (!Number.isInteger(config.antiSpamEscalation.decayMinutes)) config.antiSpamEscalation.decayMinutes = 30;
  if (!Number.isInteger(config.antiSpamEscalation.notifyAtStage)) config.antiSpamEscalation.notifyAtStage = 4;
  if (typeof config.antiSpamEscalation.notifyRoleId !== "string") config.antiSpamEscalation.notifyRoleId = "";

  // daily report
  if (!config.dailyReport) config.dailyReport = {};
  if (typeof config.dailyReport.enabled !== "boolean") config.dailyReport.enabled = true;
  if (!Number.isInteger(config.dailyReport.hour)) config.dailyReport.hour = 9;
  if (!Number.isInteger(config.dailyReport.minute)) config.dailyReport.minute = 0;

  // HuTao AI
  if (!config.aiHuTao) config.aiHuTao = {};
  if (typeof config.aiHuTao.enabled !== "boolean") config.aiHuTao.enabled = true;
  if (!Array.isArray(config.aiHuTao.allowedChannelIds)) config.aiHuTao.allowedChannelIds = [];
  if (typeof config.aiHuTao.requireMention !== "boolean") config.aiHuTao.requireMention = true;
  if (!Number.isInteger(config.aiHuTao.cooldownSeconds)) config.aiHuTao.cooldownSeconds = 10;

  // filters
  if (!config.filters) config.filters = {};
  if (typeof config.filters.enabled !== "boolean") config.filters.enabled = false;
  if (!Array.isArray(config.filters.keywords)) config.filters.keywords = [];
  if (!Array.isArray(config.filters.ignoredChannelIds)) config.filters.ignoredChannelIds = [];

  // promo
  if (!Array.isArray(config.promoMessages)) config.promoMessages = ["📣 記得訂閱本堂主！"];
  if (!Number.isInteger(config.promoCooldownMinutes)) config.promoCooldownMinutes = 150;

  // cooldown
  if (!config.cooldown) config.cooldown = {};
  if (!Number.isInteger(config.cooldown.aboutSeconds)) config.cooldown.aboutSeconds = 30;
};
ensureDefaults();

// ===== 工具：計算加重禁言秒數 =====
const computeEscalatedTimeoutSeconds = (userId) => {
  const esc = config.antiSpamEscalation;
  if (!esc?.enabled) return config.antiSpam.timeoutSeconds || 30;

  if (!spamStrike[userId]) spamStrike[userId] = { strikes: 0, lastStrikeAt: 0 };

  const now = Date.now();
  const decayMs = (esc.decayMinutes ?? 30) * 60 * 1000;

  if (spamStrike[userId].lastStrikeAt && now - spamStrike[userId].lastStrikeAt > decayMs) {
    spamStrike[userId].strikes = 0;
  }

  spamStrike[userId].strikes = Math.min((spamStrike[userId].strikes || 0) + 1, esc.maxStage ?? 6);
  spamStrike[userId].lastStrikeAt = now;

  const base = esc.baseTimeoutSeconds ?? 30;
  const mult = esc.multiplier ?? 3;

  let seconds = Math.round(base * Math.pow(mult, spamStrike[userId].strikes - 1));
  seconds = Math.min(seconds, 24 * 60 * 60);
  return seconds;
};

const maybeNotifyAdmins = async (channel, offenderUserTag, offenderMention, seconds, strikes) => {
  const esc = config.antiSpamEscalation;
  if (!esc?.enabled) return;

  const stage = esc.notifyAtStage ?? 4;
  if (stage <= 0) return;
  if (strikes < stage) return;

  const roleId = (esc.notifyRoleId || "").trim();
  const ping = roleId ? `<@&${roleId}> ` : "";
  await channel
    .send(`🚨 ${ping}${offenderMention} 已刷頻累犯 ${strikes} 次，已禁言 ${Math.ceil(seconds / 60)} 分鐘（${offenderUserTag}）`)
    .catch(() => {});
};

const announceTimeout = async (channel, mention, seconds, strikes) => {
  if (!config.antiSpam?.announceTimeout) return;
  if (!channel) return;
  const min = Math.max(1, Math.ceil(seconds / 60));
  await channel.send(`🔇 ${mention} 已被禁言 **${min} 分鐘**（刷頻累犯：${strikes} 次）`).catch(() => {});
};

// ===== 每日狀態回報 =====
const scheduleDailyReport = () => {
  if (!config.dailyReport?.enabled) return;

  const hour = config.dailyReport.hour ?? 9;
  const minute = config.dailyReport.minute ?? 0;

  const msUntilNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next - now;
  };

  const run = async () => {
    const text = `📊【每日狀態回報】
- 時間：${new Date().toLocaleString()}
- antiSpam：${config.antiSpam?.enabled ? "開" : "關"}（${config.antiSpam?.maxMessages}/${config.antiSpam?.intervalSeconds}s）
- escalation：${config.antiSpamEscalation?.enabled ? "開" : "關"}（base=${config.antiSpamEscalation?.baseTimeoutSeconds}s, mult=${config.antiSpamEscalation?.multiplier}, maxStage=${config.antiSpamEscalation?.maxStage}）
- filters：${config.filters?.enabled ? "開" : "關"}（${(config.filters?.keywords || []).length} 個詞）
- promoCooldown：${config.promoCooldownMinutes} 分鐘
- HuTao AI：${config.aiHuTao?.enabled ? "開" : "關"}（channels=${(config.aiHuTao?.allowedChannelIds || []).length}）`;
    await logAction(text);
  };

  setTimeout(async () => {
    await run();
    setInterval(run, 24 * 60 * 60 * 1000);
  }, msUntilNext());
};

// ===== 判斷堂主是否在線（Presence 可能拿不到，拿不到就當在線）=====
async function isFavoriteOnline() {
  try {
    for (const guild of client.guilds.cache.values()) {
      const member = await guild.members.fetch(FAVORITE_USER_ID).catch(() => null);
      if (!member) continue;

      const status = member.presence?.status;
      // 如果拿不到 presence（沒開 intent），就別擋：當在線
      if (!status) return true;

      return status !== "offline";
    }
    return true;
  } catch (e) {
    console.log("[PRESENCE CHECK] error", e?.message || e);
    return true;
  }
}

// ===== 用 AI 生成主動冒泡句 =====
async function generateProactivePingText() {
  const system = [
    persona.system,
    "你現在要主動叫最重要的人回來聊天。",
    "語氣要像胡桃，俏皮、可愛、自然。",
    "限制：只輸出一句話，15~40字，不要提AI、不提系統、不做現實承諾。",
  ].join("\n");

  const raw = await provider.chat({
    system,
    user: "現在請主動叫他一下。",
    temperature: 0.9,
  });

  return (
    String(raw || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "（探頭）我剛剛想到你啦～過來一下嘛！"
  );
}

// ===== Ready =====
client.once("ready", async () => {
  console.log(`${config.botName || "Bot"} 已上線！`);
  scheduleDailyReport();

  console.log("[AI CFG]", config.aiHuTao);

  await logAction(
    `🟢 **${config.botName || "Bot"} 已成功啟動**\n` +
      `- 時間：${new Date().toLocaleString()}\n` +
      `- HuTaoAI：enabled=${!!config.aiHuTao?.enabled}, requireMention=${!!config.aiHuTao?.requireMention}, channels=${(config.aiHuTao?.allowedChannelIds || []).join(",") || "(none)"}\n` +
      `- Voice：enabled=${VOICE_ENABLED}, onlyFavorite=${VOICE_ONLY_FAVORITE}`
  );

  // ===== 胡桃只在堂主在線時，主動冒泡（AI 生成）=====
  setInterval(async () => {
    try {
      const now = Date.now();
      const cooldownMs = FAVORITE_PING_COOLDOWN_MIN * 60 * 1000;

      if (now - lastFavoritePingAt < cooldownMs) return;
      if (Math.random() > FAVORITE_PING_CHANCE) return;

      const online = await isFavoriteOnline();
      if (!online) return;

      const aiCfg = config.aiHuTao || {};
      const channelId = aiCfg.allowedChannelIds?.[0];
      if (!channelId) return;

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) return;

      const aiLine = await generateProactivePingText();
      await channel.send(`<@${FAVORITE_USER_ID}> ${aiLine}`).catch(() => {});
      lastFavoritePingAt = now;

      console.log("[FAV] proactive AI ping sent");
    } catch (e) {
      console.log("[FAV] proactive AI ping error:", e?.message || e);
    }
  }, 15 * 60 * 1000);
});

// =================================================
// ================= messageCreate =================
// =================================================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!client.user) return;

  const content = message.content || "";
  const aiCfg = config.aiHuTao || {};

  const mentioned =
    message.mentions.users.has(client.user.id) ||
    new RegExp(`<@!?${client.user.id}>`).test(content);

  const allowed =
    !!aiCfg.enabled &&
    Array.isArray(aiCfg.allowedChannelIds) &&
    aiCfg.allowedChannelIds.includes(message.channel.id);

  if (mentioned) {
    await logAction(
      `🧪 mention | enabled=${!!aiCfg.enabled} allowed=${allowed} ch=${message.channel.id} author=${message.author.tag} text="${content.slice(0, 120)}"`
    );
  }

  if (mentioned && !aiCfg.enabled) {
    await message.reply("（胡桃 AI 目前是關的喔）").catch(() => {});
    return;
  }

  if (mentioned && aiCfg.enabled && !allowed) {
    await message.reply("我只會在指定的胡桃頻道回覆喔～").catch(() => {});
    return;
  }

  // ✅ 允許頻道才進 AI
  if (allowed) {
    if (aiCfg.requireMention && !mentioned) return;

    // 冷卻
    if (!client.huTaoCooldown) client.huTaoCooldown = new Map();
    const now = Date.now();
    const last = client.huTaoCooldown.get(message.author.id) || 0;
    const cdMs = (aiCfg.cooldownSeconds ?? 10) * 1000;
    if (now - last < cdMs) return;
    client.huTaoCooldown.set(message.author.id, now);

    const clean = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    if (!clean) return;

    await message.channel.sendTyping().catch(() => {});

    try {
      const reply = await huTaoReply(clean, message.author.id);

      if (reply) {
        await message.reply(String(reply).slice(0, 1800)).catch(() => {});
      } else {
        await message.reply("（胡桃剛剛走神了…你再說一次嘛）").catch(() => {});
      }

      // ✅ 語音：只有你＋你在 VC 才開口
      try {
        if (!VOICE_ENABLED) return;

        const isFav = String(message.author.id) === String(FAVORITE_USER_ID);
        if (VOICE_ONLY_FAVORITE && !isFav) return;

        if (!message.member?.voice?.channel) return;

        const mp3 = await ttsOpenAI(reply || "哼哼～我在喔！");
        await speakMp3Bytes(message.member, mp3);
      } catch (e) {
        console.log("[VOICE] speak error:", e?.message || e);
      }

    } catch (e) {
      const errText = (e && (e.stack || e.message)) ? (e.stack || e.message) : String(e);
      console.error("HuTao AI error:", e);
      await logAction(`🤖 HuTao AI error:\n${errText.slice(0, 1800)}`);
      await message.reply("（胡桃剛剛爆炸了一下…我去把她撿回來）").catch(() => {});
    }

    return;
  }

  // ====== 下面：filters / antispam / promo（你原本那段照貼回來）=====
  // 你可以把你原本 index.js 中：
  //   Filters 區塊
  //   AntiSpam 區塊
  //   Promo 區塊
  // 原封不動貼回來這裡（順序也一樣）
});

// =================================================
// ================= interactionCreate ==============
// =================================================
// ✅ 這裡請把你原本那一大段 interactionCreate 整段「原封不動貼回來」
// client.on("interactionCreate", async (interaction) => { ... });


// ===== 崩潰保護：記錄後退出，讓雲端平台自動重啟 =====
process.on("unhandledRejection", async (reason) => {
  console.error("unhandledRejection:", reason);
  await logAction(`💥 **UnhandledRejection**\n內容：${String(reason).slice(0, 1800)}`);
});

process.on("uncaughtException", async (err) => {
  console.error("uncaughtException:", err);
  await logAction(`💥 **UncaughtException（即將重啟）**\n錯誤：${String(err).slice(0, 1800)}`);
  setTimeout(() => process.exit(1), 1500);
});

client.on("error", (e) => console.error("client error:", e));
client.on("shardError", (e) => console.error("shardError:", e));
client.on("warn", (m) => console.warn("warn:", m));

client.login(process.env.DISCORD_TOKEN);
