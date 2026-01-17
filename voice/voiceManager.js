// voice/voiceManager.js
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  entersState,
  VoiceConnectionStatus,
} = require("@discordjs/voice");

const { Readable } = require("stream");

// guildId -> { connection, player }
const sessions = new Map();

function bufferToReadable(buf) {
  const r = new Readable();
  r.push(buf);
  r.push(null);
  return r;
}

async function getOrJoin(member) {
  const channel = member?.voice?.channel;
  if (!channel) throw new Error("User not in a voice channel");

  const guildId = channel.guild.id;

  let session = sessions.get(guildId);
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
    sessions.set(guildId, session);

    // 等連上
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    connection.on("stateChange", (oldS, newS) => {
      console.log("[VOICE] conn state", oldS.status, "->", newS.status);
    });

    player.on("stateChange", (oldS, newS) => {
      console.log("[VOICE] player state", oldS.status, "->", newS.status);
    });

    player.on("error", (err) => {
      console.log("[VOICE] player error", err?.message || err);
    });
  } else {
    // 如果你換 VC，讓 bot 跟著換
    if (session.connection.joinConfig.channelId !== channel.id) {
      session.connection.destroy();
      sessions.delete(guildId);
      return await getOrJoin(member);
    }
  }

  return session;
}

// member: GuildMember
// mp3Bytes: Buffer
async function speakMp3Bytes(member, mp3Bytes) {
  const session = await getOrJoin(member);

  if (!Buffer.isBuffer(mp3Bytes)) {
    throw new Error("mp3Bytes must be a Buffer");
  }

  const stream = bufferToReadable(mp3Bytes);

  // 注意：我們是 MP3
  const resource = createAudioResource(stream, {
    inputType: StreamType.Arbitrary,
    inlineVolume: true,
  });

  // 音量可調
  try {
    resource.volume.setVolume(1.0);
  } catch {}

  session.player.play(resource);

  // 等播完（或閒置）
  await entersState(session.player, AudioPlayerStatus.Playing, 10_000).catch(() => {});
  await entersState(session.player, AudioPlayerStatus.Idle, 60_000).catch(() => {});
}

async function leaveGuild(guildId) {
  const session = sessions.get(guildId);
  if (!session) return;

  try {
    session.player.stop();
  } catch {}

  try {
    session.connection.destroy();
  } catch {}

  sessions.delete(guildId);
}

module.exports = { speakMp3Bytes, leaveGuild };
