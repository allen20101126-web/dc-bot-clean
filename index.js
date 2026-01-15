console.log("### BOOT VERSION: DC-BOT-CLEAN / MISTRAL DEBUG ###");

// index.js
const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

// HuTao AI
const huTaoReply = require("./ai/huTaoReply");

// 讀取 config.json
let config = JSON.parse(fs.readFileSync("./config.json", "utf8"));

// Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
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
  if (typeof config.aiHuTao.enabled !== "boolean") config.aiHuTao.enabled = true; // 預設開
  if (!Array.isArray(config.aiHuTao.allowedChannelIds)) config.aiHuTao.allowedChannelIds = [];
  if (typeof config.aiHuTao.requireMention !== "boolean") config.aiHuTao.requireMention = true;
  if (!Number.isInteger(config.aiHuTao.cooldownSeconds)) config.aiHuTao.cooldownSeconds = 10;

  // filters（避免沒寫 keywords 直接炸）
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
  seconds = Math.min(seconds, 24 * 60 * 60); // 最多 24 小時
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

// ===== 工具：公告禁言 =====
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

// ===== 胡桃主動冒泡（最愛用戶）=====
const FAVORITE_USER_ID = process.env.FAVORITE_USER_ID || "1116718831801475082";
const FAVORITE_PING_COOLDOWN_MIN = Number(process.env.FAVORITE_PING_COOLDOWN_MIN || 240); // 4 小時
const FAVORITE_PING_CHANCE = Number(process.env.FAVORITE_PING_CHANCE || 0.25); // 25%
let lastFavoritePingAt = 0;


// ===== Ready =====
client.once("ready", async () => {
  console.log(`${config.botName || "Bot"} 已上線！`);
  scheduleDailyReport();

    // ===== 胡桃偶爾主動叫堂主（安全版）=====
  setInterval(async () => {
    try {
      const now = Date.now();
      const cooldownMs = FAVORITE_PING_COOLDOWN_MIN * 60 * 1000;

      // 冷卻中就不做
      if (now - lastFavoritePingAt < cooldownMs) return;

      // 機率判定（不是每次都發）
      if (Math.random() > FAVORITE_PING_CHANCE) return;

      const aiCfg = config.aiHuTao || {};
      const channelId = aiCfg.allowedChannelIds?.[0];
      if (!channelId) return;

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) return;

      const lines = [
        `欸欸～<@${FAVORITE_USER_ID}>！胡桃來巡堂啦，你在忙什麼？`,
        `（探頭）<@${FAVORITE_USER_ID}>～堂主大人～我來看看你有沒有偷懶`,
        `哼哼～<@${FAVORITE_USER_ID}>，突然想到你，就跑來叫一下`,
        `嘿！<@${FAVORITE_USER_ID}>～別太累喔，胡桃在這邊陪你一下`,
      ];

      await channel.send(lines[Math.floor(Math.random() * lines.length)]);
      lastFavoritePingAt = now;

      console.log("[FAV] proactive ping sent");
    } catch (e) {
      console.log("[FAV] proactive ping error:", e?.message || e);
    }
  }, 20 * 60 * 1000); // 每 20 分鐘「檢查一次」


  console.log("[AI]", config.aiHuTao);

  await logAction(
    `🟢 **${config.botName || "Bot"} 已成功啟動**\n` +
      `- 時間：${new Date().toLocaleString()}\n` +
      `- HuTaoAI：enabled=${!!config.aiHuTao?.enabled}, requireMention=${!!config.aiHuTao?.requireMention}, channels=${(config.aiHuTao?.allowedChannelIds || []).join(",") || "(none)"}`
  );
});


// =================================================
// ================= messageCreate =================
// =================================================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!client.user) return;

  const content = message.content || "";

  // ===============================
  // ========== HuTao AI ===========
  // ===============================
  const aiCfg = config.aiHuTao || {};

  const mentioned =
    message.mentions.users.has(client.user.id) ||
    new RegExp(`<@!?${client.user.id}>`).test(content);

  const allowed =
    !!aiCfg.enabled &&
    Array.isArray(aiCfg.allowedChannelIds) &&
    aiCfg.allowedChannelIds.includes(message.channel.id);

  // 只要 @ 就一定 log
  if (mentioned) {
    await logAction(
      `🧪 mention | enabled=${!!aiCfg.enabled} allowed=${allowed} ch=${message.channel.id} author=${message.author.tag} text="${content.slice(0, 120)}"`
    );
  }

  // 有 @ 但 AI 沒開
  if (mentioned && !aiCfg.enabled) {
    await message.reply("（胡桃 AI 目前是關的喔）").catch(() => {});
    return;
  }

  // 有 @ 但不在允許頻道
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
      if (typeof huTaoReply !== "function") {
        throw new Error(`huTaoReply is not a function, got: ${typeof huTaoReply}`);
      }

      const reply = await huTaoReply(clean, message.author.id);
      if (reply) {
        await message.reply(String(reply).slice(0, 1800)).catch(() => {});
      } else {
        await message.reply("（胡桃剛剛走神了…你再說一次嘛）").catch(() => {});
      }
    } catch (e) {
      const errText = (e && (e.stack || e.message)) ? (e.stack || e.message) : String(e);
      console.error("HuTao AI error:", e);
      await logAction(`🤖 HuTao AI error:\n${errText.slice(0, 1800)}`);
      await message.reply("（胡桃剛剛爆炸了一下…我去把她撿回來）").catch(() => {});
    }

    return; // ✅ AI 回完就結束，避免 filters/antispam/promo 影響
  }

  // ===============================
  // ========== Filters ============
  // ===============================
  if (config.filters?.enabled) {
    const ignored = config.filters.ignoredChannelIds || [];
    const inIgnoredChannel = ignored.includes(message.channel.id);

    if (!inIgnoredChannel) {
      for (const word of config.filters.keywords || []) {
        if (word && content.includes(word)) {
          await message.delete().catch(() => {});
          await message.channel.send(`${message.author} ⚠️ 檢測到違禁詞，已刪除訊息。`).catch(() => {});
          await logAction(`🗑️ 刪除違禁詞訊息：${message.author.tag} in #${message.channel?.name}`);
          return;
        }
      }
    }
  }

  // ===============================
  // ========== AntiSpam ===========
  // ===============================
  if (config.antiSpam?.enabled) {
    const ignored = config.antiSpam.ignoredChannelIds || [];
    if (!ignored.includes(message.channel.id)) {
      const uid = message.author.id;

      if (!client.spamState) client.spamState = {};
      if (!client.spamState[uid]) client.spamState[uid] = { times: [], lastWarn: 0, lastAction: 0, lastAnnounce: 0 };

      const state = client.spamState[uid];
      const nowTs = Date.now();

      state.times.push(nowTs);

      const windowMs = (config.antiSpam.intervalSeconds || 4) * 1000;
      state.times = state.times.filter((t) => nowTs - t < windowMs);

      const maxMsg = config.antiSpam.maxMessages || 4;

      if (state.times.length > maxMsg) {
        if (config.antiSpam.deleteSpamMessages) await message.delete().catch(() => {});

        const warnCdMs = (config.antiSpam.warnCooldownSeconds || 8) * 1000;
        if (nowTs - state.lastWarn > warnCdMs) {
          await message.channel.send(`${message.author} ⚠️ 你發太快了，先冷靜一下！`).catch(() => {});
          state.lastWarn = nowTs;
        }

        const action = config.antiSpam.action || "timeout";
        const actionCdMs = 10 * 1000;

        if (action === "timeout" && nowTs - state.lastAction > actionCdMs) {
          const seconds = computeEscalatedTimeoutSeconds(uid);
          const strikes = spamStrike[uid]?.strikes || 0;

          if (message.member?.moderatable && !isAdmin(message.member) && !isProtected(message.member)) {
            await message.member.timeout(seconds * 1000, "Anti-spam (escalation)").catch(() => {});
            await logAction(`⛔ Anti-spam：${message.author.tag} timeout ${seconds}s（strike=${strikes}）`);
            await maybeNotifyAdmins(message.channel, message.author.tag, `${message.author}`, seconds, strikes);

            const annCdMs = (config.antiSpam.announceCooldownSeconds || 12) * 1000;
            if (nowTs - state.lastAnnounce > annCdMs) {
              await announceTimeout(message.channel, `${message.author}`, seconds, strikes);
              state.lastAnnounce = nowTs;
            }
          }

          state.lastAction = nowTs;
        }

        state.times = [];
        return;
      }
    }
  }

  // ===============================
  // ========== Promo ==============
  // ===============================
  const cid = message.channel.id;
  if (!lastPromoTime[cid]) lastPromoTime[cid] = 0;

  const now = Date.now();
  const cooldownMs = (config.promoCooldownMinutes || 150) * 60 * 1000;

  if (now - lastPromoTime[cid] > cooldownMs && Math.random() < PROMO_CHANCE) {
    const promo = config.promoMessages[Math.floor(Math.random() * config.promoMessages.length)];
    await message.channel.send(promo).catch(() => {});
    await logAction(`📣 自動宣傳：#${message.channel?.name}`);
    lastPromoTime[cid] = now;
  }
});



// =================================================
// ================= interactionCreate ==============
// =================================================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ✅ 胡桃記憶（你有加 ai/memory.js 才會用到）
  let huTaoMemory = null;
  try {
    huTaoMemory = require("./ai/memory");
  } catch {}

  try {
    const guild = interaction.guild;
    if (!guild) return;

    const member = await guild.members.fetch(interaction.user.id).catch(() => null);

    // --- Slash 也算洗頻（含 /about /hutao 等）---
    if (config.antiSpam?.enabled && config.antiSpam.countSlashCommands) {
      const ignored = config.antiSpam.ignoredChannelIds || [];
      if (!ignored.includes(interaction.channelId)) {
        const uid = interaction.user.id;

        if (!client.spamState) client.spamState = {};
        if (!client.spamState[uid]) client.spamState[uid] = { times: [], lastWarn: 0, lastAction: 0, lastAnnounce: 0 };

        const state = client.spamState[uid];
        const nowTs = Date.now();

        state.times.push(nowTs);
        const windowMs = (config.antiSpam.intervalSeconds || 4) * 1000;
        state.times = state.times.filter((t) => nowTs - t < windowMs);

        const maxMsg = config.antiSpam.maxMessages || 4;

        if (state.times.length > maxMsg) {
          const warnCdMs = (config.antiSpam.warnCooldownSeconds || 8) * 1000;

          if (nowTs - state.lastWarn > warnCdMs) {
            if (!interaction.replied && !interaction.deferred) {
              await interaction.reply({ content: "⚠️ 你操作太快了，先冷靜一下！", flags: 64 }).catch(() => {});
            }
            state.lastWarn = nowTs;
          }

          const actionCdMs = 10 * 1000;
          if (nowTs - state.lastAction > actionCdMs) {
            const seconds = computeEscalatedTimeoutSeconds(uid);
            const strikes = spamStrike[uid]?.strikes || 0;

            // 管理員/受保護不會被誤傷
            if (member?.moderatable && !isAdmin(member) && !isProtected(member)) {
              await member.timeout(seconds * 1000, `Anti-spam (slash): /${interaction.commandName}`).catch(() => {});
              await logAction(`⛔ Anti-spam(slash)：${interaction.user.tag} timeout ${seconds}s（strike=${strikes}）`);
              await maybeNotifyAdmins(interaction.channel, interaction.user.tag, `<@${interaction.user.id}>`, seconds, strikes);

              const annCdMs = (config.antiSpam.announceCooldownSeconds || 12) * 1000;
              if (nowTs - state.lastAnnounce > annCdMs) {
                await announceTimeout(interaction.channel, `<@${interaction.user.id}>`, seconds, strikes);
                state.lastAnnounce = nowTs;
              }
            }

            state.lastAction = nowTs;
          }

          state.times = [];
          return;
        }
      }
    }

    // =========================
    // ========= /about =========
    // =========================
    if (interaction.commandName === "about") {
      const cdMs = (config.cooldown?.aboutSeconds ?? 30) * 1000;
      const now = Date.now();
      const last = aboutCooldown.get(interaction.user.id) || 0;

      if (now - last < cdMs) {
        const left = Math.ceil((cdMs - (now - last)) / 1000);
        await interaction.reply({ content: `⏳ /about 冷卻中，請 ${left} 秒後再試。`, flags: 64 }).catch(() => {});
        return;
      }

      aboutCooldown.set(interaction.user.id, now);
      await interaction.reply({ content: `🤖 ${config.botName}\n${config.channelPromo}`, flags: 64 }).catch(() => {});
      return;
    }

    // =========================
    // ========= /hutao =========
    // =========================
    if (interaction.commandName === "hutao") {
      // 管理員限定
      if (!member || !isAdmin(member)) {
        await interaction.reply({ content: "❌ 你沒有權限使用這個指令。", flags: 64 }).catch(() => {});
        return;
      }

      const sub = interaction.options.getSubcommand();
      if (!config.aiHuTao) config.aiHuTao = {};
      if (!Array.isArray(config.aiHuTao.allowedChannelIds)) config.aiHuTao.allowedChannelIds = [];

      // /hutao status
      if (sub === "status") {
        const text =
`🔥【胡桃 AI 狀態】
- enabled：${config.aiHuTao.enabled ? "開" : "關"}
- requireMention：${config.aiHuTao.requireMention ? "要@" : "不用@"}
- cooldownSeconds：${config.aiHuTao.cooldownSeconds ?? 10}
- allowedChannels：${(config.aiHuTao.allowedChannelIds || []).length ? (config.aiHuTao.allowedChannelIds.map(id => `<#${id}>`).join(" ")) : "（尚未設定）"}

📝 小提醒：
- 只會在 allowedChannels 回覆
- requireMention=true 時，必須 @ 機器人它才回`
        await interaction.reply({ content: text, flags: 64 }).catch(() => {});
        return;
      }

      // /hutao on
      if (sub === "on") {
        config.aiHuTao.enabled = true;
        ensureDefaults();
        const ok = saveConfig();
        await interaction.reply({ content: ok ? "✅ 已開啟胡桃 AI" : "⚠️ 已開啟胡桃 AI，但寫回 config.json 失敗（看終端/Logs）", flags: 64 }).catch(() => {});
        await logAction(`🤖 ${interaction.user.tag} hutao on`);
        return;
      }

      // /hutao off
      if (sub === "off") {
        config.aiHuTao.enabled = false;
        ensureDefaults();
        const ok = saveConfig();
        await interaction.reply({ content: ok ? "✅ 已關閉胡桃 AI" : "⚠️ 已關閉胡桃 AI，但寫回 config.json 失敗（看終端/Logs）", flags: 64 }).catch(() => {});
        await logAction(`🤖 ${interaction.user.tag} hutao off`);
        return;
      }

      // /hutao channel_add
      if (sub === "channel_add") {
        const ch = interaction.options.getChannel("channel", true);
        const id = ch.id;
        if (!config.aiHuTao.allowedChannelIds.includes(id)) config.aiHuTao.allowedChannelIds.push(id);

        ensureDefaults();
        const ok = saveConfig();

        await interaction.reply({
          content: ok ? `✅ 已加入允許頻道：<#${id}>` : `⚠️ 已加入允許頻道：<#${id}>，但寫回 config.json 失敗（看終端/Logs）`,
          flags: 64
        }).catch(() => {});
        await logAction(`🤖 ${interaction.user.tag} hutao channel_add ${id}`);
        return;
      }

      // /hutao channel_remove
      if (sub === "channel_remove") {
        const ch = interaction.options.getChannel("channel", true);
        const id = ch.id;
        config.aiHuTao.allowedChannelIds = (config.aiHuTao.allowedChannelIds || []).filter(x => x !== id);

        ensureDefaults();
        const ok = saveConfig();

        await interaction.reply({
          content: ok ? `✅ 已移除允許頻道：<#${id}>` : `⚠️ 已移除允許頻道：<#${id}>，但寫回 config.json 失敗（看終端/Logs）`,
          flags: 64
        }).catch(() => {});
        await logAction(`🤖 ${interaction.user.tag} hutao channel_remove ${id}`);
        return;
      }

      // /hutao requiremention
      if (sub === "requiremention") {
        const enabled = interaction.options.getBoolean("enabled", true);
        config.aiHuTao.requireMention = !!enabled;

        ensureDefaults();
        const ok = saveConfig();

        await interaction.reply({
          content: ok ? `✅ requireMention 已設為：${enabled ? "true（要@才回）" : "false（不用@也會回，但仍限允許頻道）"}`
                      : `⚠️ 已更新 requireMention，但寫回 config.json 失敗（看終端/Logs）`,
          flags: 64
        }).catch(() => {});
        await logAction(`🤖 ${interaction.user.tag} hutao requiremention=${enabled}`);
        return;
      }

      // /hutao cooldown
      if (sub === "cooldown") {
        const seconds = interaction.options.getInteger("seconds", true);
        config.aiHuTao.cooldownSeconds = Math.min(Math.max(seconds, 1), 120);

        ensureDefaults();
        const ok = saveConfig();

        await interaction.reply({
          content: ok ? `✅ cooldownSeconds 已設為：${config.aiHuTao.cooldownSeconds}s`
                      : `⚠️ 已更新 cooldownSeconds，但寫回 config.json 失敗（看終端/Logs）`,
          flags: 64
        }).catch(() => {});
        await logAction(`🤖 ${interaction.user.tag} hutao cooldown=${config.aiHuTao.cooldownSeconds}`);
        return;
      }

      // /hutao reset
      if (sub === "reset") {
        const user = interaction.options.getUser("user", true);

        if (!huTaoMemory || typeof huTaoMemory.clear !== "function") {
          await interaction.reply({ content: "⚠️ 你還沒加 ai/memory.js（或 memory.js 沒有 clear 方法）。", flags: 64 }).catch(() => {});
          return;
        }

        huTaoMemory.clear(user.id);
        await interaction.reply({ content: `✅ 已清除 ${user.tag} 的胡桃記憶`, flags: 64 }).catch(() => {});
        await logAction(`🤖 ${interaction.user.tag} hutao reset ${user.tag}`);
        return;
      }

      await interaction.reply({ content: "（未知的 subcommand）", flags: 64 }).catch(() => {});
      return;
    }

    // ===========================
    // ======= /antispam =========
    // ===========================
    if (interaction.commandName === "antispam") {
      if (!member || !isAdmin(member)) {
        await interaction.reply({ content: "❌ 你沒有權限使用這個指令。", flags: 64 }).catch(() => {});
        return;
      }

      const sub = interaction.options.getSubcommand();

      if (sub === "status") {
        const user = interaction.options.getUser("user");
        const uid = user?.id || interaction.user.id;

        const strikes = spamStrike[uid]?.strikes || 0;
        const last = spamStrike[uid]?.lastStrikeAt || 0;

        const esc = config.antiSpamEscalation || {};
        const escOn = !!esc.enabled;

        const text =
`🛡️【AntiSpam 狀態】
- 目標：${user ? user.tag : interaction.user.tag}
- 累犯次數(strikes)：${strikes}
- 上次觸發：${last ? new Date(last).toLocaleString() : "（尚無）"}

⚙️【判定】
- maxMessages：${config.antiSpam.maxMessages}
- intervalSeconds：${config.antiSpam.intervalSeconds}
- countSlashCommands：${!!config.antiSpam.countSlashCommands}

⚖️【處罰】
- 基本 timeoutSeconds：${config.antiSpam.timeoutSeconds}
- Escalation：${escOn ? "開" : "關"}
- base：${esc.baseTimeoutSeconds ?? "-"} / mult：${esc.multiplier ?? "-"} / maxStage：${esc.maxStage ?? "-"}
- decayMinutes：${esc.decayMinutes ?? "-"}
- notifyAtStage：${esc.notifyAtStage ?? "-"} / notifyRoleId：${(esc.notifyRoleId || "").trim() ? "已設定" : "未設定"}`;

        await interaction.reply({ content: text, flags: 64 }).catch(() => {});
        return;
      }

      if (sub === "reset") {
        const user = interaction.options.getUser("user", true);
        const uid = user.id;

        delete spamStrike[uid];
        if (client.spamState?.[uid]) {
          client.spamState[uid] = { times: [], lastWarn: 0, lastAction: 0, lastAnnounce: 0 };
        }

        await interaction.reply({ content: `✅ 已重置：${user.tag} 的累犯/洗頻狀態`, flags: 64 }).catch(() => {});
        await logAction(`🧽 ${interaction.user.tag} reset antispam for ${user.tag}`);
        return;
      }

      if (sub === "set") {
        const maxMessages = interaction.options.getInteger("maxmessages");
        const intervalSeconds2 = interaction.options.getInteger("intervalseconds");
        const timeoutSeconds2 = interaction.options.getInteger("timeoutseconds");
        const warnCooldownSeconds = interaction.options.getInteger("warncooldownseconds");
        const deleteSpamMessages = interaction.options.getBoolean("deletespammessages");
        const countSlashCommands2 = interaction.options.getBoolean("countslashcommands");

        const baseTimeoutSeconds = interaction.options.getInteger("base");
        const multiplier = interaction.options.getInteger("multiplier");
        const maxStage = interaction.options.getInteger("maxstage");
        const decayMinutes = interaction.options.getInteger("decayminutes");
        const notifyAtStage = interaction.options.getInteger("notifyatstage");
        const notifyRole = interaction.options.getRole("notifyrole");

        if (maxMessages !== null) config.antiSpam.maxMessages = Math.min(Math.max(maxMessages, 1), 30);
        if (intervalSeconds2 !== null) config.antiSpam.intervalSeconds = Math.min(Math.max(intervalSeconds2, 1), 60);
        if (timeoutSeconds2 !== null) config.antiSpam.timeoutSeconds = Math.min(Math.max(timeoutSeconds2, 5), 24 * 60 * 60);
        if (warnCooldownSeconds !== null) config.antiSpam.warnCooldownSeconds = Math.min(Math.max(warnCooldownSeconds, 1), 120);
        if (deleteSpamMessages !== null) config.antiSpam.deleteSpamMessages = !!deleteSpamMessages;
        if (countSlashCommands2 !== null) config.antiSpam.countSlashCommands = !!countSlashCommands2;

        if (baseTimeoutSeconds !== null) config.antiSpamEscalation.baseTimeoutSeconds = Math.min(Math.max(baseTimeoutSeconds, 5), 3600);
        if (multiplier !== null) config.antiSpamEscalation.multiplier = Math.min(Math.max(multiplier, 2), 10);
        if (maxStage !== null) config.antiSpamEscalation.maxStage = Math.min(Math.max(maxStage, 1), 20);
        if (decayMinutes !== null) config.antiSpamEscalation.decayMinutes = Math.min(Math.max(decayMinutes, 1), 24 * 60);
        if (notifyAtStage !== null) config.antiSpamEscalation.notifyAtStage = Math.min(Math.max(notifyAtStage, 0), 20);
        if (notifyRole) config.antiSpamEscalation.notifyRoleId = notifyRole.id;

        ensureDefaults();
        const ok = saveConfig();

        await interaction.reply({
          content: ok ? "✅ 已更新 antiSpam 設定並寫回 config.json" : "⚠️ 已更新 antiSpam 設定，但寫回 config.json 失敗（看終端/Logs）",
          flags: 64
        }).catch(() => {});
        await logAction(`⚙️ ${interaction.user.tag} updated antispam settings`);
        return;
      }

      await interaction.reply({ content: "（未知的 subcommand）", flags: 64 }).catch(() => {});
      return;
    }

    // ===========================
    // ====== 其他管理指令 =========
    // ===========================
    if (!member || !isAdmin(member)) {
      await interaction.reply({ content: "❌ 你沒有權限使用這個指令。", flags: 64 }).catch(() => {});
      return;
    }

    await interaction.deferReply({ flags: 64 }).catch(() => {});

    if (interaction.commandName === "status") {
      await interaction.editReply("✅ Bot 正常運作中").catch(() => {});
      await logAction(`📊 ${interaction.user.tag} status`);
      return;
    }

    if (interaction.commandName === "testpromo") {
      const promo = config.promoMessages[Math.floor(Math.random() * config.promoMessages.length)];
      await interaction.editReply(`📣 ${promo}`).catch(() => {});
      await logAction(`🧪 ${interaction.user.tag} testpromo`);
      return;
    }

    if (interaction.commandName === "clear") {
      const amount = Math.min(Math.max(interaction.options.getInteger("amount", true), 1), 100);
      await interaction.channel.bulkDelete(amount, true).catch(async () => {
        await interaction.editReply("❌ 刪除失敗（訊息可能太舊或權限不足）。").catch(() => {});
        return;
      });
      await interaction.editReply(`✅ 已刪除 ${amount} 則訊息`).catch(() => {});
      await logAction(`🧹 ${interaction.user.tag} clear ${amount} in #${interaction.channel?.name}`);
      return;
    }

    if (interaction.commandName === "ban") {
      const user = interaction.options.getUser("target", true);
      const reason = interaction.options.getString("reason") || "無原因";
      const target = await guild.members.fetch(user.id).catch(() => null);

      if (!target) {
        await interaction.editReply("❌ 找不到目標成員").catch(() => {});
        return;
      }
      if (isProtected(target)) {
        await interaction.editReply("❌ 目標身分組受保護，不能被 ban").catch(() => {});
        return;
      }
      if (!target.bannable) {
        await interaction.editReply("❌ 我沒有權限 ban 這個人（可能他角色比我高）").catch(() => {});
        return;
      }

      await target.ban({ reason }).catch(async () => {
        await interaction.editReply("❌ ban 失敗（權限不足或角色階級問題）").catch(() => {});
        return;
      });

      await interaction.editReply(`🔨 已 ban：${user.tag}（原因：${reason}）`).catch(() => {});
      await logAction(`🔨 ${interaction.user.tag} ban ${user.tag}（原因：${reason}）`);
      return;
    }

    if (interaction.commandName === "mute") {
      const user = interaction.options.getUser("target", true);
      const minutes = interaction.options.getInteger("minutes", true);
      const target = await guild.members.fetch(user.id).catch(() => null);

      if (!target) {
        await interaction.editReply("❌ 找不到成員").catch(() => {});
        return;
      }
      if (isProtected(target)) {
        await interaction.editReply("❌ 目標身分組受保護，不能被禁言").catch(() => {});
        return;
      }
      if (!target.moderatable) {
        await interaction.editReply("❌ 權限不足（可能對方角色比我高）").catch(() => {});
        return;
      }

      await target.timeout(minutes * 60 * 1000, `Muted by ${interaction.user.tag} for ${minutes} minutes`).catch(async () => {
        await interaction.editReply("❌ 禁言失敗（權限不足或角色階級問題）").catch(() => {});
        return;
      });

      await interaction.editReply(`🔇 已禁言：${user.tag}（${minutes} 分鐘）`).catch(() => {});
      await logAction(`🔇 ${interaction.user.tag} mute ${user.tag}（${minutes} 分鐘）`);
      return;
    }

    await interaction.editReply("（這個指令我還沒接好）").catch(() => {});
  } catch (err) {
    console.error("interactionCreate error:", err);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ 發生錯誤，請看終端機/Logs。", flags: 64 }).catch(() => {});
    } else {
      await interaction.editReply("❌ 發生錯誤，請看終端機/Logs。").catch(() => {});
    }
  }
});

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

// Discord 連線錯誤監聽
client.on("error", (e) => console.error("client error:", e));
client.on("shardError", (e) => console.error("shardError:", e));
client.on("warn", (m) => console.warn("warn:", m));

// ===== Login（環境變數）=====
client.login(process.env.DISCORD_TOKEN);
