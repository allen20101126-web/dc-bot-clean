require("dotenv").config();

process.env.FFMPEG_PATH = require("ffmpeg-static");

console.log("### BOOT VERSION: DC-BOT-CLEAN / VOICE + MEMORY DEBUG ###");

// index.js
const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

// HuTao AI core
const huTaoReply = require("./ai/huTaoReply");

// proactive ping uses your existing provider/persona
const provider = require("./ai/provider");
const persona = require("./ai/persona");

// Piper TTS -> returns WAV Buffer
const { ttsPiper } = require("./voice/ttsPiper");

// Discord Voice
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
  StreamType,
} = require("@discordjs/voice");

const prism = require("prism-media");
const { Readable } = require("stream");

// 讀取 config.json
let config = JSON.parse(fs.readFileSync("./config.json", "utf8"));

// ===== 偏愛設定 =====
const FAVORITE_USER_ID = process.env.FAVORITE_USER_ID || "1116718831801475082";

// ===== Voice 開關 =====
const VOICE_ENABLED = String(process.env.VOICE_ENABLED || "1") === "1";
const VOICE_ONLY_FAVORITE = String(process.env.VOICE_ONLY_FAVORITE || "1") === "1";

// ===== 主動冒泡參數 =====
const FAVORITE_PING_COOLDOWN_MIN = Number(process.env.FAVORITE_PING_COOLDOWN_MIN || 180);
const FAVORITE_PING_CHANCE = Number(process.env.FAVORITE_PING_CHANCE || 0.25);
let lastFavoritePingAt = 0;

// Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates, // ✅ 必要
  ],
});

// ===== 基本設定 =====
const lastPromoTime = {};
const PROMO_CHANCE = 0.05;
const aboutCooldown = new Map();

// ===== 洗頻累犯加重 =====
const spamStrike = {};

// ===== 工具：角色判斷 =====
const hasAnyRole = (member, roleNames = []) =>
  roleNames.some((rn) => member?.roles?.cache?.some((r) => r.name === rn));

const isAdmin = (member) => hasAnyRole(member, config.roleControl?.adminRoles || []);
const isProtected = (member) => hasAnyRole(member, config.roleControl?.protectedRoles || []);

// ===== 工具：log =====
const getLogChannel = async () => {
  if (!config.log?.enabled || !config.log.channelId) return null;
  return await client.channels.fetch(config.log.channelId).catch(() => null);
};

const logAction = async (text) => {
  const ch = await getLogChannel();
  if (!ch) return;
  await ch.send(text).catch(() => {});
};

// ===== 寫回 config.json =====
const saveConfig = () => {
  try {
    fs.writeFileSync("./config.json", JSON.stringify(config, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("saveConfig error:", e);
    return false;
  }
};

// ===== 補齊預設值 =====
const ensureDefaults = () => {
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

  if (typeof config.antiSpam.announceTimeout !== "boolean") config.antiSpam.announceTimeout = true;
  if (!Number.isInteger(config.antiSpam.announceCooldownSeconds)) config.antiSpam.announceCooldownSeconds = 12;

  if (!config.antiSpamEscalation) config.antiSpamEscalation = {};
  if (typeof config.antiSpamEscalation.enabled !== "boolean") config.antiSpamEscalation.enabled = true;
  if (!Number.isInteger(config.antiSpamEscalation.baseTimeoutSeconds)) config.antiSpamEscalation.baseTimeoutSeconds = 30;
  if (!Number.isInteger(config.antiSpamEscalation.multiplier)) config.antiSpamEscalation.multiplier = 3;
  if (!Number.isInteger(config.antiSpamEscalation.maxStage)) config.antiSpamEscalation.maxStage = 6;
  if (!Number.isInteger(config.antiSpamEscalation.decayMinutes)) config.antiSpamEscalation.decayMinutes = 30;
  if (!Number.isInteger(config.antiSpamEscalation.notifyAtStage)) config.antiSpamEscalation.notifyAtStage = 4;
  if (typeof config.antiSpamEscalation.notifyRoleId !== "string") config.antiSpamEscalation.notifyRoleId = "";

  if (!config.dailyReport) config.dailyReport = {};
  if (typeof config.dailyReport.enabled !== "boolean") config.dailyReport.enabled = true;
  if (!Number.isInteger(config.dailyReport.hour)) config.dailyReport.hour = 9;
  if (!Number.isInteger(config.dailyReport.minute)) config.dailyReport.minute = 0;

  if (!config.aiHuTao) config.aiHuTao = {};
  if (typeof config.aiHuTao.enabled !== "boolean") config.aiHuTao.enabled = true;
  if (!Array.isArray(config.aiHuTao.allowedChannelIds)) config.aiHuTao.allowedChannelIds = [];
  if (typeof config.aiHuTao.requireMention !== "boolean") config.aiHuTao.requireMention = true;
  if (!Number.isInteger(config.aiHuTao.cooldownSeconds)) config.aiHuTao.cooldownSeconds = 10;

  if (!config.filters) config.filters = {};
  if (typeof config.filters.enabled !== "boolean") config.filters.enabled = false;
  if (!Array.isArray(config.filters.keywords)) config.filters.keywords = [];
  if (!Array.isArray(config.filters.ignoredChannelIds)) config.filters.ignoredChannelIds = [];

  if (!Array.isArray(config.promoMessages)) config.promoMessages = ["📣 記得訂閱本堂主！"];
  if (!Number.isInteger(config.promoCooldownMinutes)) config.promoCooldownMinutes = 150;

  if (!config.cooldown) config.cooldown = {};
  if (!Number.isInteger(config.cooldown.aboutSeconds)) config.cooldown.aboutSeconds = 30;
};
ensureDefaults();

// =====================
// ===== Voice Core =====
// =====================
const voiceSessions = new Map(); // guildId -> { connection, player }

function bufferToReadable(buf) {
  const r = new Readable();
  r.push(buf);
  r.push(null);
  return r;
}

async function getOrJoinVoice(member) {
  const channel = member?.voice?.channel;
  if (!channel) throw new Error("User not in a voice channel");

  const guildId = channel.guild.id;

  let session = voiceSessions.get(guildId);
  if (!session) {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    const player = createAudioPlayer();
    connection.subscribe(player);

    session = { connection, player };
    voiceSessions.set(guildId, session);

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    connection.on("stateChange", (oldS, newS) => {
      console.log("[VOICE] conn", oldS.status, "->", newS.status);
    });
    player.on("stateChange", (oldS, newS) => {
      console.log("[VOICE] player", oldS.status, "->", newS.status);
    });
    player.on("error", (err) => {
      console.log("[VOICE] player error", err?.message || err);
    });
  } else {
    if (session.connection.joinConfig.channelId !== channel.id) {
      try { session.connection.destroy(); } catch {}
      voiceSessions.delete(guildId);
      return await getOrJoinVoice(member);
    }
  }

  return session;
}

// ✅ 最穩：WAV bytes -> ffmpeg -> PCM 48k -> Discord player
async function playWavToVC(member, wavBytes) {
  const session = await getOrJoinVoice(member);

  const input = bufferToReadable(wavBytes);

  // 用 ffmpeg 把 wav 轉成 s16le 48k stereo
  const ffmpeg = new prism.FFmpeg({
    args: [
      "-hide_banner",
      "-loglevel", "error",
      "-i", "pipe:0",
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "2",
      "pipe:1",
    ],
  });

  const pcm = input.pipe(ffmpeg);

  const resource = createAudioResource(pcm, {
    inputType: StreamType.Raw,
    inlineVolume: true,
  });

  try { resource.volume.setVolume(1.0); } catch {}

  session.player.play(resource);

  await entersState(session.player, AudioPlayerStatus.Playing, 10_000).catch(() => {});
  await entersState(session.player, AudioPlayerStatus.Idle, 60_000).catch(() => {});
}

async function leaveGuild(guildId) {
  const s = voiceSessions.get(guildId);
  if (!s) return;
  try { s.player.stop(); } catch {}
  try { s.connection.destroy(); } catch {}
  voiceSessions.delete(guildId);
}

// ===== 計算加重禁言秒數 =====
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
- HuTao AI：${config.aiHuTao?.enabled ? "開" : "關"}（channels=${(config.aiHuTao?.allowedChannelIds || []).length}）
- Voice：${VOICE_ENABLED ? "開" : "關"}（onlyFavorite=${VOICE_ONLY_FAVORITE ? "是" : "否"}）`;
    await logAction(text);
  };

  setTimeout(async () => {
    await run();
    setInterval(run, 24 * 60 * 60 * 1000);
  }, msUntilNext());
};

// ===== 判斷堂主是否在線（Presence 拿不到就當在線）=====
async function isFavoriteOnline() {
  try {
    for (const guild of client.guilds.cache.values()) {
      const member = await guild.members.fetch(FAVORITE_USER_ID).catch(() => null);
      if (!member) continue;
      const status = member.presence?.status;
      if (!status) return true;
      return status !== "offline";
    }
    return true;
  } catch {
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
  console.log("[READY] bot user:", client.user?.tag, "id:", client.user?.id);
  console.log("[FFMPEG] path:", process.env.FFMPEG_PATH);

  scheduleDailyReport();

  console.log("[AI CFG]", config.aiHuTao);

  await logAction(
    `🟢 **${config.botName || "Bot"} 已成功啟動**\n` +
      `- 時間：${new Date().toLocaleString()}\n` +
      `- HuTaoAI：enabled=${!!config.aiHuTao?.enabled}, requireMention=${!!config.aiHuTao?.requireMention}, channels=${(config.aiHuTao?.allowedChannelIds || []).join(",") || "(none)"}\n` +
      `- Voice：enabled=${VOICE_ENABLED}, onlyFavorite=${VOICE_ONLY_FAVORITE}`
  );

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

  if (allowed) {
    if (aiCfg.requireMention && !mentioned) return;

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

        console.log("[VOICE] start TTS...");
        const wav = await ttsPiper(reply || "哼哼～我在喔！");
        console.log("[VOICE] tts ok, wav bytes:", wav?.length || 0);

        await playWavToVC(message.member, wav);
        console.log("[VOICE] played");

      } catch (e) {
        console.log("[VOICE] speak error:", e?.message || e);
        await logAction(`🔊 Voice error: ${String(e?.message || e).slice(0, 500)}`);
      }

    } catch (e) {
      const errText = (e && (e.stack || e.message)) ? (e.stack || e.message) : String(e);
      console.error("HuTao AI error:", e);
      await logAction(`🤖 HuTao AI error:\n${errText.slice(0, 1800)}`);
      await message.reply("（胡桃剛剛爆炸了一下…我去把她撿回來）").catch(() => {});
    }

    return;
  }

  // ===== Filters / AntiSpam / Promo（保留你原本）=====
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

  const cid = message.channel.id;
  if (!lastPromoTime[cid]) lastPromoTime[cid] = 0;

  const now2 = Date.now();
  const cooldownMs = (config.promoCooldownMinutes || 150) * 60 * 1000;

  if (now2 - lastPromoTime[cid] > cooldownMs && Math.random() < PROMO_CHANCE) {
    const promo = config.promoMessages[Math.floor(Math.random() * config.promoMessages.length)];
    await message.channel.send(promo).catch(() => {});
    await logAction(`📣 自動宣傳：#${message.channel?.name}`);
    lastPromoTime[cid] = now2;
  }
});

// =================================================
// ================= interactionCreate ==============
// =================================================
// 你已經修好 slash 這塊了，就沿用你目前那份 interactionCreate（不要動也可以）
// 我這裡不重貼，避免把你已經好的又弄壞。

// ===== 崩潰保護 =====
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
