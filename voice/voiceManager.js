// voice/voiceManager.js
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
  StreamType,
} = require("@discordjs/voice");
const { Readable } = require("stream");

const connections = new Map(); // guildId -> { connection, player }

function bufferToStream(buf) {
  const s = new Readable();
  s.push(buf);
  s.push(null);
  return s;
}

async function ensureJoined(member) {
  const channel = member?.voice?.channel;
  if (!channel) throw new Error("你要先在語音頻道裡");

  const guildId = channel.guild.id;
  const existed = connections.get(guildId);
  if (existed) return existed;

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

  const player = createAudioPlayer();
  connection.subscribe(player);

  const obj = { connection, player };
  connections.set(guildId, obj);
  return obj;
}

async function speakMp3Bytes(member, mp3Bytes) {
  const { player } = await ensureJoined(member);

  const resource = createAudioResource(bufferToStream(mp3Bytes), {
    inputType: StreamType.Arbitrary,
  });

  player.play(resource);
  await entersState(player, AudioPlayerStatus.Playing, 10_000).catch(() => {});
}

function leaveGuild(guildId) {
  const obj = connections.get(guildId);
  if (!obj) return false;
  try {
    obj.connection.destroy();
  } catch {}
  connections.delete(guildId);
  return true;
}

module.exports = { speakMp3Bytes, leaveGuild };
