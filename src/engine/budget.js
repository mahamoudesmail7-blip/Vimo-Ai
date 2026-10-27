// Spending control. Before a video is accepted (and before the customer's
// credit is taken) its estimated cost must fit:
//   - the per-video limit,
//   - the daily limit for all providers and each provider's own daily limit,
//   - a CONFIRMED available balance at every paid provider in the plan:
//     fal's live balance when the key may read it, otherwise the budget the
//     admin confirmed on the AI Engines page minus what was spent since.
// Money still reserved by videos in progress counts as spent.
import { prisma } from '../db.js';
import { adapters } from './providers/index.js';

const TERMINAL = ['COMPLETED', 'FAILED'];
const BALANCE_CACHE_MS = 60000;
const liveCache = {};

export const dayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };
const r4 = (n) => Math.round(n * 10000) / 10000;

async function spentSince(since, provider = null) {
  const agg = await prisma.engineEvent.aggregate({ where: { kind: 'CHARGE', created_at: { gte: since }, ...(provider ? { provider } : {}) }, _sum: { usd: true } });
  return agg._sum.usd || 0;
}

/** USD still expected to be spent by unfinished videos, per provider. */
export async function reserved() {
  const jobs = await prisma.videoJob.findMany({ where: { status: { notIn: TERMINAL }, plan_json: { not: null } }, select: { plan_json: true, audio_json: true, clips_json: true, merge_json: true } });
  const out = {};
  for (const j of jobs) {
    let plan; try { plan = JSON.parse(j.plan_json); } catch { continue; }
    const spent = spentByProviderOf(j);
    for (const [p, usd] of Object.entries(plan.estimate?.byProvider || {})) out[p] = r4((out[p] || 0) + Math.max(0, usd - (spent[p] || 0)));
  }
  return out;
}

// What a job's finished steps already cost (recorded on each step as `charged`).
function spentByProviderOf(job) {
  const out = {};
  const add = (s) => { if (s?.charged) out[s.provider] = (out[s.provider] || 0) + (s.usd || 0); };
  const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
  for (const c of parse(job.clips_json) || []) { add(c); add(c.frame); }
  add(parse(job.merge_json));
  const audio = parse(job.audio_json) || {};
  add(audio.tts); add(audio.mux);
  return out;
}

/** The provider's available USD: live when the provider tells us, else the admin-confirmed budget left. */
export async function availableBalance(provider, settings) {
  const a = adapters[provider];
  if (provider === 'mock') return { usd: Infinity, source: 'mock' };
  if (a.balanceOutSince?.()) return { usd: 0, source: 'provider-refused' };
  const cached = liveCache[provider];
  let live = cached && Date.now() - cached.at < BALANCE_CACHE_MS ? cached.usd : undefined;
  if (live === undefined) {
    try { live = await a.balance(); } catch { live = null; }
    liveCache[provider] = { at: Date.now(), usd: live };
  }
  if (live !== null && live !== undefined) return { usd: live, source: 'live' };
  const cfg = settings.providers[provider];
  if (cfg.confirmedBalanceUsd === null || cfg.confirmedBalanceUsd === undefined || !cfg.confirmedAt) return { usd: null, source: 'unconfirmed' };
  const used = await spentSince(new Date(cfg.confirmedAt), provider);
  return { usd: r4(cfg.confirmedBalanceUsd - used), source: 'confirmed', confirmedAt: cfg.confirmedAt };
}

export function clearBalanceCache() { for (const k of Object.keys(liveCache)) delete liveCache[k]; }

/** @returns {{ ok: true }|{ ok: false, reason: string, provider?: string }} reason is for the admin. */
export async function checkBudget(plan, settings) {
  const total = plan.estimate.totalUsd;
  if (total > settings.perVideoMaxUsd) return { ok: false, reason: `تكلفة الفيديو المتوقعة $${total} أكبر من حد الفيديو الواحد $${settings.perVideoMaxUsd}.` };
  const since = dayStart();
  const held = await reserved();
  const heldAll = Object.values(held).reduce((a, b) => a + b, 0);
  const today = await spentSince(since);
  if (today + heldAll + total > settings.perDayMaxUsd) return { ok: false, reason: `الحد اليومي $${settings.perDayMaxUsd} هيتعدّى (اتصرف $${r4(today)} + محجوز $${r4(heldAll)} + $${total}).` };
  for (const [provider, usd] of Object.entries(plan.estimate.byProvider)) {
    if (!usd) continue;
    const cfg = settings.providers[provider];
    const todayP = await spentSince(since, provider);
    if (todayP + (held[provider] || 0) + usd > cfg.dailyMaxUsd) return { ok: false, provider, reason: `الحد اليومي لـ ${provider} ($${cfg.dailyMaxUsd}) هيتعدّى.` };
    const bal = await availableBalance(provider, settings);
    if (bal.usd === null) return { ok: false, provider, reason: `رصيد ${provider} مش متأكد منه: أكّد الرصيد المتاح من صفحة محركات الذكاء الاصطناعي.` };
    if (bal.usd < (held[provider] || 0) + usd) return { ok: false, provider, reason: `رصيد ${provider} المتاح ($${r4(bal.usd)}) مش كفاية لفيديو بـ $${usd} (محجوز $${held[provider] || 0}).` };
  }
  return { ok: true };
}

export async function recordEvent({ jobId = null, provider, model = null, kind, usd = 0, message = null }) {
  try {
    await prisma.engineEvent.create({ data: { job_id: jobId, provider, model, kind, usd, message: message ? String(message).slice(0, 500) : null } });
  } catch (err) {
    console.error('[engine] could not record event:', err.message);
  }
}
