// Admin: the AI Engines page. Provider status and balances, the model list
// with enable / tier / price overrides, spending limits, priorities, the plan
// each style would use right now, and recent generation errors.
import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncRoute } from '../errors.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { MODELS, PROVIDERS, PROVIDER_LABELS } from '../engine/catalog.js';
import { loadSettings, saveSettings, effectiveModel, mockAllowed } from '../engine/settings.js';
import { adapters } from '../engine/providers/index.js';
import { planVideo, availableModels } from '../engine/planner.js';
import { availableBalance, clearBalanceCache, dayStart, reserved } from '../engine/budget.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const r4 = (n) => Math.round(n * 10000) / 10000;

async function overview() {
  const settings = await loadSettings();
  const since = dayStart();
  const [spent, events, held] = await Promise.all([
    prisma.engineEvent.groupBy({ by: ['provider'], where: { kind: 'CHARGE', created_at: { gte: since } }, _sum: { usd: true } }),
    prisma.engineEvent.findMany({ where: { kind: { in: ['ERROR', 'REFUSED'] } }, orderBy: { created_at: 'desc' }, take: 40 }),
    reserved(),
  ]);
  const spentBy = Object.fromEntries(spent.map((s) => [s.provider, r4(s._sum.usd || 0)]));
  const available = new Set(availableModels(settings).map((m) => m.id));
  const providers = [];
  for (const id of PROVIDERS) {
    const a = adapters[id];
    const cfg = settings.providers[id];
    const configured = a.configured();
    providers.push({
      id, label: PROVIDER_LABELS[id], configured, missing: a.missing(), ...cfg,
      hidden: id === 'mock' && !mockAllowed(),
      balance: configured && id !== 'mock' ? await availableBalance(id, settings) : null,
      balanceOutSince: a.balanceOutSince?.() || null,
      spentTodayUsd: spentBy[id] || 0, reservedUsd: held[id] || 0,
    });
  }
  const plans = {};
  for (const style of ['AUTO', 'UGC', 'SHOWCASE']) {
    const { plan, error } = planVideo({ style, settings });
    plans[style] = plan ? { mode: plan.mode, provider: plan.provider, video: plan.models.video, sceneSeconds: plan.sceneSeconds, estimate: plan.estimate } : { error };
  }
  return {
    settings: { tier: settings.tier, perVideoMaxUsd: settings.perVideoMaxUsd, perDayMaxUsd: settings.perDayMaxUsd, hybrid: settings.hybrid !== false, targetSeconds: settings.targetSeconds },
    spentTodayUsd: r4(Object.values(spentBy).reduce((a, b) => a + b, 0)),
    providers,
    models: MODELS.filter((m) => m.provider !== 'mock' || mockAllowed()).map((m) => {
      const e = effectiveModel(m, settings);
      return { id: e.id, provider: e.provider, kind: e.kind, label: e.label, tier: e.tier || null, enabled: e.enabled, usable: available.has(e.id), audio: e.audio ?? null, input: e.input || null, durations: e.durations || null, usdPerSecond: e.usdPerSecond || null, usdPerUnit: e.usdPerUnit ?? null, usdPer1kChars: e.usdPer1kChars ?? null, priceVerified: e.priceVerified, priceOverridden: e.priceOverridden };
    }),
    plans,
    errors: events.map((e) => ({ id: e.id, at: e.created_at, provider: e.provider, model: e.model, kind: e.kind, jobId: e.job_id, usd: e.usd, message: e.message })),
  };
}

router.get('/', asyncRoute(async (req, res) => res.json(await overview())));

router.put('/', asyncRoute(async (req, res) => {
  await saveSettings(req.body || {});
  clearBalanceCache();
  res.json(await overview());
}));

router.post('/refresh', asyncRoute(async (req, res) => {
  clearBalanceCache();
  res.json(await overview());
}));

export default router;
