import { Game } from './game.js';
import { Lake } from './lake.js';

// Spielstand: reine Umwandlung Game <-> JSON-Text (kein DOM, kein Speicher). Gespeichert wird der Management-Zustand
// (Geld, Zeit, Upgrades, Anlage, Nachträge, Funde, Aufträge) und der Seegrund. Die laufende Pontonfahrt nicht:
// nach dem Laden steht der Ponton wieder auf der Karte.
export const SAVE_VERSION = 1;

const toB64 = (arr) => {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64, Type) => {
  const s = atob(b64), bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Type(bytes.buffer);
};

export function serializeGame(game) {
  const data = {};
  for (const [k, v] of Object.entries(game)) if (k !== 'rng' && k !== 'lake' && k !== 'notes') data[k] = v;
  const lake = {};
  for (const [k, v] of Object.entries(game.lake)) lake[k] = ArrayBuffer.isView(v) ? { type: v.constructor.name, b64: toB64(v) } : v;
  return JSON.stringify({ version: SAVE_VERSION, rng: game.rng.getState(), data, lake });
}

// Gibt ein Game zurück oder null, wenn der Text kaputt oder von einer anderen Version ist.
export function restoreGame(text) {
  try {
    const s = JSON.parse(text);
    if (s?.version !== SAVE_VERSION) return null;
    const game = new Game(s.data.seed);
    Object.assign(game, s.data);
    game.notes = [];
    const lake = new Lake(s.lake.cols, s.lake.rows);
    const types = { Float32Array, Uint8Array };
    for (const [k, v] of Object.entries(s.lake)) lake[k] = v && v.b64 !== undefined ? fromB64(v.b64, types[v.type]) : v;
    game.lake = lake;
    game.rng.setState(s.rng);
    return game;
  } catch { return null; }
}

export const savedSummary = (text) => {
  try { const d = JSON.parse(text); return d.version === SAVE_VERSION ? { day: d.data.day, money: d.data.money, status: d.data.status } : null; } catch { return null; }
};
