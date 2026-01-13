// deploy-commands.js
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("./config.json", "utf8"));
const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("❌ Missing DISCORD_TOKEN env var");
  process.exit(1);
}
if (!config?.slash?.clientId || !config?.slash?.guildId) {
  console.error("❌ Missing config.slash.clientId or config.slash.guildId in config.json");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("about")
    .setDescription("查看本堂主的左右護法介紹"),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("查看機器人狀態（管理用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName("testpromo")
    .setDescription("立刻測試宣傳一句（管理用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("刪除訊息（管理用）")
    .addIntegerOption(opt => opt.setName("amount").setDescription("1~100").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban 成員（管理用）")
    .addUserOption(opt => opt.setName("target").setDescription("要 ban 的人").setRequired(true))
    .addStringOption(opt => opt.setName("reason").setDescription("原因").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("禁言（分鐘）（管理用）")
    .addUserOption(opt => opt.setName("target").setDescription("要禁言的人").setRequired(true))
    .addIntegerOption(opt => opt.setName("minutes").setDescription("分鐘").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  // ===== /antispam =====
  new SlashCommandBuilder()
    .setName("antispam")
    .setDescription("防洗頻設定/查詢（管理用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sc =>
      sc.setName("status")
        .setDescription("查看某人的累犯次數/目前防洗頻參數")
        .addUserOption(opt => opt.setName("user").setDescription("不填則看自己").setRequired(false))
    )
    .addSubcommand(sc =>
      sc.setName("reset")
        .setDescription("重置某人的累犯/洗頻狀態")
        .addUserOption(opt => opt.setName("user").setDescription("要重置的人").setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName("set")
        .setDescription("直接在 Discord 內修改 antiSpam 參數（會寫回 config.json）")
        .addIntegerOption(opt => opt.setName("maxmessages").setDescription("幾秒內最多幾則（1~30）").setRequired(false))
        .addIntegerOption(opt => opt.setName("intervalseconds").setDescription("計算時間窗秒數（1~60）").setRequired(false))
        .addIntegerOption(opt => opt.setName("timeoutseconds").setDescription("基本禁言秒數（5~86400）").setRequired(false))
        .addIntegerOption(opt => opt.setName("warncooldownseconds").setDescription("警告冷卻秒數（1~120）").setRequired(false))
        .addBooleanOption(opt => opt.setName("deletespammessages").setDescription("是否刪除刷屏訊息").setRequired(false))
        .addBooleanOption(opt => opt.setName("countslashcommands").setDescription("Slash 指令也算刷頻").setRequired(false))
        // escalation
        .addIntegerOption(opt => opt.setName("base").setDescription("Escalation 基礎秒數（5~3600）").setRequired(false))
        .addIntegerOption(opt => opt.setName("multiplier").setDescription("Escalation 倍率（2~10）").setRequired(false))
        .addIntegerOption(opt => opt.setName("maxstage").setDescription("最大累犯階段（1~20）").setRequired(false))
        .addIntegerOption(opt => opt.setName("decayminutes").setDescription("多久沒刷就降級（1~1440）").setRequired(false))
        .addIntegerOption(opt => opt.setName("notifyatstage").setDescription("第幾次開始 @管理員（0=不@）").setRequired(false))
        .addRoleOption(opt => opt.setName("notifyrole").setDescription("@的管理員身分組").setRequired(false))
    ),

  // ===== ✅ /hutao =====
  new SlashCommandBuilder()
    .setName("hutao")
    .setDescription("胡桃 AI 設定（管理用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sc =>
      sc.setName("status")
        .setDescription("查看胡桃 AI 目前狀態")
    )
    .addSubcommand(sc =>
      sc.setName("on")
        .setDescription("開啟胡桃 AI")
    )
    .addSubcommand(sc =>
      sc.setName("off")
        .setDescription("關閉胡桃 AI")
    )
    .addSubcommand(sc =>
      sc.setName("channel_add")
        .setDescription("加入允許回覆的頻道")
        .addChannelOption(opt =>
          opt.setName("channel")
            .setDescription("要加入的頻道")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sc =>
      sc.setName("channel_remove")
        .setDescription("移除允許回覆的頻道")
        .addChannelOption(opt =>
          opt.setName("channel")
            .setDescription("要移除的頻道")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sc =>
      sc.setName("requiremention")
        .setDescription("設定是否需要 @ 才回")
        .addBooleanOption(opt =>
          opt.setName("enabled")
            .setDescription("true=要@才回 / false=不用@也會回（但仍限允許頻道）")
            .setRequired(true)
        )
    )
    .addSubcommand(sc =>
      sc.setName("cooldown")
        .setDescription("設定每人冷卻秒數")
        .addIntegerOption(opt =>
          opt.setName("seconds")
            .setDescription("1~120")
            .setMinValue(1)
            .setMaxValue(120)
            .setRequired(true)
        )
    )
    .addSubcommand(sc =>
      sc.setName("reset")
        .setDescription("清除某人的胡桃記憶")
        .addUserOption(opt =>
          opt.setName("user")
            .setDescription("要清除記憶的人")
            .setRequired(true)
        )
    ),
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("開始註冊 Slash 指令…");
    await rest.put(
      Routes.applicationGuildCommands(config.slash.clientId, config.slash.guildId),
      { body: commands }
    );
    console.log("註冊完成 ✅");
  } catch (e) {
    console.error(e);
  }
})();
