// ai/memory.js
const fs = require("fs");

const MEMORY_FILE = "./ai_memory.json";
const MAX_TURNS = 8;
let store = {};

function load() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      store = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")) || {};
    }
  } catch {
    store = {};
  }
}

function save() {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch {}
}

function get(userId) {
  return Array.isArray(store[userId]) ? store[userId] : [];
}

function push(userId, role, content) {
  if (!store[userId]) store[userId] = [];
  store[userId].push({ role, content, ts: Date.now() });
  if (store[userId].length > MAX_TURNS * 2) store[userId] = store[userId].slice(-MAX_TURNS * 2);
}

function clear(userId) {
  delete store[userId];
  save();
}

load();
module.exports = { get, push, clear, save };
