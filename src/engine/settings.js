// The AI Engines page settings, one JSON document in the settings table.
// Everything has a safe default, so a fresh deploy behaves like before
// (fal + Veo 3.1 Fast) once a balance is confirmed.
import { prisma } from '../db.js';
import { MODELS, PROVIDERS, TIERS } from './catalog.js';

const KEY = 'engine';
const CACHE_MS = 5000;

// The free fake engine is opt-in, so a host without NODE_ENV can never hand customers fake videos.
export function mockAllowed() {
  return process.env.VIMO_ENABLE_MOCK === '1' || ['development', 'test'].includes(String(process.env.NODE_ENV || '').trim());
}

export function defaults() {
  return {
    // Cheapest by default (Veo 3.1 Lite, ~$1.2-1.7 a video); the admin can raise it.
    tier: 'economy', // the quality tier every new video uses
    perVideoMaxUsd: 2,
    perDayMaxUsd: 20,
    targetSeconds: 20, // ad length; the talking clips are paid per second, so shorter is cheaper
    captions: true, // burn the spoken line on screen (free, our ffmpeg)
    speechCheck: true, // listen to each talking clip and re-make a garbled one once
    hybrid: true, // allow the one-AI-clip + product-photo production (cheapest)
    providers: {
      fal: { enabled: true, priority: 1, dailyMaxUsd: 50, confirmedBalanceUsd: null, confirmedAt: null },
      higgsfield: { enabled: true, priority: 2, dailyMaxUsd: 30, confirmedBalanceUsd: null, confirmedAt: null },
      google: { enabled: true, priority: 3, dailyMaxUsd: 30, confirmedBalanceUsd: null, confirmedAt: null },
      // Only used where mockAllowed(): local runs then cost nothing.
      mock: { enabled: true, priority: 0, dailyMaxUsd: 0, confirmedBalanceUsd: null, confirmedAt: null },
    },
    models: {}, // id -> { enabled?, tier?, usdPerSecond?: {audio, silent}, usdPerUnit?, usdPer1kChars? }
  };
}

let cache = null;
export function clearCache() { cache = null; }

export async function loadSettings() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  let stored = {};
  try { stored = row ? JSON.parse(row.value) : {}; } catch { stored = {}; }
  const d = defaults();
  const value = {
    ...d,
    ...pick(stored, ['tier', 'perVideoMaxUsd', 'perDayMaxUsd', 'hybrid', 'targetSeconds', 'captions', 'speechCheck']),
    providers: Object.fromEntries(PROVIDERS.map((p) => [p, { ...d.providers[p], ...(stored.providers?.[p] || {}) }])),
    models: stored.models || {},
  };
  cache = { at: Date.now(), value };
  return value;
}

function pick(o, keys) { return Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]])); }

const money = (v, max = 100000) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10000) / 10000 : undefined; };

/** Merge an admin's change into the stored settings, keeping only known, valid fields. */
export async function saveSettings(patch) {
  const cur = await loadSettings();
  const next = structuredClone(cur);
  if (TIERS.includes(patch.tier)) next.tier = patch.tier;
  if (typeof patch.hybrid === 'boolean') next.hybrid = patch.hybrid;
  if (typeof patch.captions === 'boolean') next.captions = patch.captions;
  if (typeof patch.speechCheck === 'boolean') next.speechCheck = patch.speechCheck;
  if (Number.isInteger(Number(patch.targetSeconds)) && Number(patch.targetSeconds) >= 12 && Number(patch.targetSeconds) <= 30) next.targetSeconds = Number(patch.targetSeconds);
  for (const k of ['perVideoMaxUsd', 'perDayMaxUsd']) if (money(patch[k]) !== undefined) next[k] = money(patch[k]);
  for (const p of PROVIDERS) {
    const src = patch.providers?.[p];
    if (!src) continue;
    const dst = next.providers[p];
    if (typeof src.enabled === 'boolean') dst.enabled = src.enabled;
    if (Number.isInteger(src.priority) && src.priority >= 0 && src.priority <= 99) dst.priority = src.priority;
    if (money(src.dailyMaxUsd) !== undefined) dst.dailyMaxUsd = money(src.dailyMaxUsd);
    if (src.confirmedBalanceUsd === null) { dst.confirmedBalanceUsd = null; dst.confirmedAt = null; }
    else if (money(src.confirmedBalanceUsd) !== undefined) { dst.confirmedBalanceUsd = money(src.confirmedBalanceUsd); dst.confirmedAt = new Date().toISOString(); }
  }
  for (const [id, src] of Object.entries(patch.models || {})) {
    if (!MODELS.some((m) => m.id === id) || !src) continue;
    const dst = { ...(next.models[id] || {}) };
    if (typeof src.enabled === 'boolean') dst.enabled = src.enabled;
    if (TIERS.includes(src.tier)) dst.tier = src.tier;
    if (src.usdPerSecond) {
      const a = money(src.usdPerSecond.audio, 10); const s = money(src.usdPerSecond.silent, 10);
      dst.usdPerSecond = { ...(dst.usdPerSecond || {}), ...(a !== undefined ? { audio: a } : {}), ...(s !== undefined ? { silent: s } : {}) };
    }
    if (money(src.usdPerUnit, 10) !== undefined) dst.usdPerUnit = money(src.usdPerUnit, 10);
    if (money(src.usdPer1kChars, 10) !== undefined) dst.usdPer1kChars = money(src.usdPer1kChars, 10);
    // A price equal to the catalog's is not an override (so "needs confirming" stays visible).
    const base = MODELS.find((m) => m.id === id);
    if (dst.usdPerSecond) {
      for (const k of ['audio', 'silent']) if (dst.usdPerSecond[k] === base.usdPerSecond?.[k]) delete dst.usdPerSecond[k];
      if (!Object.keys(dst.usdPerSecond).length) delete dst.usdPerSecond;
    }
    if (dst.usdPerUnit === base.usdPerUnit) delete dst.usdPerUnit;
    if (dst.usdPer1kChars === base.usdPer1kChars) delete dst.usdPer1kChars;
    if (dst.tier === base.tier) delete dst.tier;
    next.models[id] = dst;
  }
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
  clearCache();
  return loadSettings();
}

/** A catalog model with the admin's overrides applied. */
export function effectiveModel(model, settings) {
  const o = settings.models[model.id] || {};
  return {
    ...model,
    enabled: o.enabled !== undefined ? o.enabled : true,
    tier: o.tier || model.tier,
    usdPerSecond: model.usdPerSecond ? { ...model.usdPerSecond, ...(o.usdPerSecond || {}) } : undefined,
    usdPerUnit: o.usdPerUnit ?? model.usdPerUnit,
    usdPer1kChars: o.usdPer1kChars ?? model.usdPer1kChars,
    priceOverridden: Boolean(o.usdPerSecond || o.usdPerUnit !== undefined || o.usdPer1kChars !== undefined),
  };
}
