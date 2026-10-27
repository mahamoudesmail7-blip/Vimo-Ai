// Free engine for development and tests: answers instantly-ish (one poll),
// costs nothing, and returns a tiny bundled MP4. Only with VIMO_ENABLE_MOCK=1
// or NODE_ENV=development/test.
import { mockAllowed } from '../settings.js';
import { MOCK_IMAGE } from '../media.js';

let n = 0;
export default {
  id: 'mock',
  configured: () => mockAllowed(),
  missing: () => (mockAllowed() ? [] : ['VIMO_ENABLE_MOCK=1']),
  async balance() { return Infinity; },
  async submit(model, kind, params) {
    n += 1;
    return { requestId: `mock-${n}`, polls: 0, kindSent: kind, params: kind === 'tts' ? { chars: params.text.length } : undefined };
  },
  async poll(model, step) {
    step.polls = (step.polls || 0) + 1;
    if (step.polls < 2) return { state: 'RUNNING' };
    if (model.kind === 'image') return { state: 'COMPLETED', url: MOCK_IMAGE };
    if (model.kind === 'tts') return { state: 'COMPLETED', url: 'mock:audio' };
    return { state: 'COMPLETED', url: 'mock:video' };
  },
};
