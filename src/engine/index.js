// The engine's face to the video pipeline: run one step (a clip, a first
// frame, a voiceover, a merge) on whichever provider the job's plan names.
// A step is a plain object saved in the job's JSON columns:
//   { provider, model, status, attempts, usd, charged, url, error, ...provider handle }
import { findModel, modelByEndpoint } from './catalog.js';
import { adapters } from './providers/index.js';
import { effectiveModel, loadSettings } from './settings.js';
import { recordEvent } from './budget.js';
import { storeBuffer } from './media.js';
import { prisma } from '../db.js';

export { planVideo } from './planner.js';
export { checkBudget } from './budget.js';
export { loadSettings } from './settings.js';

export async function modelFor(id) {
  const base = findModel(id) || modelByEndpoint(id);
  if (!base) return null;
  return effectiveModel(base, await loadSettings());
}

/** What one step costs at the catalog price. */
export function stepCost(model, { seconds = 0, audio = false, chars = 0 } = {}) {
  if (model.kind === 'video') return seconds * (audio ? model.usdPerSecond.audio : model.usdPerSecond.silent);
  if (model.kind === 'image') return model.usdPerUnit;
  if (model.kind === 'tts') return (chars / 1000) * model.usdPer1kChars;
  return seconds * (model.usdPerSecond?.silent || 0);
}

export async function submitStep(job, step, modelId, kind, params, costInfo = {}) {
  const model = await modelFor(modelId);
  if (!model) throw new Error(`unknown model ${modelId}`);
  const attempts = (step.attempts || 0) + 1;
  const handle = await adapters[model.provider].submit(model, kind, params, { idempotencyKey: `vimo-${job.uuid}-${step.key || kind}-${attempts}` });
  Object.assign(step, handle, {
    provider: model.provider, model: model.id, status: 'SUBMITTED', attempts, error: null,
    usd: Math.round(stepCost(model, costInfo) * 10000) / 10000, charged: false,
  });
}

/**
 * Poll a submitted step. Resolves 'RUNNING' or 'COMPLETED' (step.url set and
 * its cost recorded once); throws the provider's error when it failed.
 */
export async function pollStep(job, step) {
  const model = await modelFor(step.model);
  const res = await adapters[model.provider].poll(model, step);
  if (res.state !== 'COMPLETED') return 'RUNNING';
  step.url = res.buffer ? await storeBuffer(res.buffer, res.mime || 'video/mp4') : res.url;
  step.status = 'COMPLETED';
  if (!step.charged) {
    step.charged = true;
    if (step.usd) {
      await recordEvent({ jobId: job.id, provider: model.provider, model: model.id, kind: 'CHARGE', usd: step.usd });
      await prisma.videoJob.update({ where: { id: job.id }, data: { cost_actual_usd: { increment: step.usd } } });
    }
  }
  return 'COMPLETED';
}
