// After a talking clip is made, we listen to it (speech-to-text on fal, same
// FAL_KEY, a fraction of a cent) and compare what was said with the script.
// A clip that garbled its line or stopped before the end is made again once;
// the better of the two takes is kept.
import * as fal from '../services/fal.js';
import { speakNumbers } from '../services/numbers.js';

export const STT_MODEL = 'fal-ai/whisper';
export const STT_USD = 0.002; // per clip, an estimate for the cost log
export const PASS_SCORE = 0.75; // clean takes score ~0.9-1; a garbled one ~0.6

/** Arabic words in one written form: no diacritics or tatweel, one alef, ى->ي, ة->ه. */
export function normalizeWords(text) {
  return speakNumbers(String(text || ''))
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/(تلات|ربع|خمس|ست|سبع|تمن|تمان|تسع) مي[ةه]/g, '$1ميه') // "خمس مية" and "خمسمية" are the same word
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter(Boolean)
    // "و" / "ب" stuck to a word are often heard apart, and the other way round
    .map((w) => (w.length > 3 && /^[وب]/.test(w) ? w.slice(1) : w));
}

function similarity(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/**
 * How much of the script line was really said: the share of its words heard
 * (allowing small spelling differences), and whether its last words were said.
 */
export function speechScore(expected, heard) {
  const want = normalizeWords(expected);
  const got = normalizeWords(heard);
  if (!want.length) return { score: 1, ending: true };
  const found = want.map((w) => got.some((g) => similarity(w, g) >= 0.7));
  const score = Math.round((found.filter(Boolean).length / want.length) * 100) / 100;
  const ending = found.slice(-2).some(Boolean);
  // numbers and prices are checked word by word, strictly: a price heard wrong is never "close enough"
  const numbers = want.map((w, i) => (NUMBER_WORD.test(w) ? i : -1)).filter((i) => i >= 0);
  const numbersOk = numbers.every((i) => got.some((g) => similarity(want[i], g) >= 0.85));
  return { score, ending, numbersOk };
}

const NUMBER_WORD = /^(واحد|اتنين|تلاته|اربعه|خمسه|سته|سبعه|تمانيه|تسعه|عشره|عشرين|تلاتين|اربعين|خمسين|ستين|سبعين|تمانين|تسعين|ميه|ميتين|(تلات|ربع|خمس|ست|سبع|تمن|تمان|تسع)ميه|الف|الفين|تلاف|جنيه)$/;

export const passes = ({ score, ending, numbersOk = true }) => score >= PASS_SCORE && ending && numbersOk;

/** Listens to a clip. Returns { heard, score, ending } or null when it can't (no key, error). */
export async function checkClip(url, expected) {
  try {
    const out = await fal.run(STT_MODEL, { audio_url: url, task: 'transcribe', language: 'ar' }, 90000);
    const heard = String(out?.text || '').trim();
    return { heard: heard.slice(0, 500), ...speechScore(expected, heard) };
  } catch (err) {
    console.warn('[speech-check] could not listen to the clip:', err.message);
    return null;
  }
}
