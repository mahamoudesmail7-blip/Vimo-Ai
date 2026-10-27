// Hybrid production, done on our own server for free: one AI clip, then the
// product's real photos with a slow camera move (blurred background, product
// centred), joined and laid under the voiceover. Only the AI clip and the
// voice are paid, which is what brings a 24s ad down to ~$0.3-0.45.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { toBuffer } from './media.js';
import { EngineError } from './errors.js';

const require = createRequire(import.meta.url);
const FPS = 30;

let resolved;
/** The ffmpeg binary (bundled by ffmpeg-static), or null when there is none. */
export function ffmpegPath() {
  if (resolved !== undefined) return resolved;
  const candidates = [process.env.FFMPEG_PATH];
  try { candidates.push(require('ffmpeg-static')); } catch { /* not installed */ }
  resolved = candidates.find((p) => p && existsSync(p)) || null;
  return resolved;
}

function run(args, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new EngineError(`تجميع الفيديو فشل: ${err.split('\n').filter(Boolean).slice(-2).join(' ')}`, 'COMPOSE_FAILED', null, 'local'));
    });
  });
}

const ext = (ref, kind) => (kind === 'audio' ? '.audio' : kind === 'video' ? '.mp4' : /^data:image\/png/.test(ref) ? '.png' : '.jpg');

/**
 * @param {object} p
 * @param {string} p.clipUrl       the AI clip (first scene)
 * @param {number} p.clipSeconds
 * @param {string[]} p.photos      image refs for the photo scenes, cycled
 * @param {number[]} p.photoSeconds one length per photo scene
 * @param {string|null} p.audioUrl the voiceover
 * @param {string} p.aspectRatio   '9:16' | '16:9'
 * @returns {Promise<Buffer>} the finished MP4
 */
export async function composeHybrid({ clipUrl, clipSeconds, photos, photoSeconds, audioUrl, aspectRatio }) {
  if (!ffmpegPath()) throw new EngineError('ffmpeg مش موجود على السيرفر.', 'NO_FFMPEG', null, 'local');
  const [W, H] = aspectRatio === '16:9' ? [1280, 720] : [720, 1280];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vimo-'));
  try {
    const save = async (ref, name, kind) => { const f = path.join(dir, name + ext(ref, kind)); await fs.writeFile(f, await toBuffer(ref)); return f; };
    const clip = await save(clipUrl, 'clip', 'video');
    const imgs = [];
    for (const [i, ref] of photos.entries()) imgs.push(await save(ref, `p${i}`, 'image'));
    const audio = audioUrl ? await save(audioUrl, 'voice', 'audio') : null;

    const total = clipSeconds + photoSeconds.reduce((a, b) => a + b, 0);
    const args = ['-y', '-loglevel', 'error', '-stream_loop', '-1', '-t', String(clipSeconds), '-i', clip];
    photoSeconds.forEach((_, i) => args.push('-i', imgs[i % imgs.length]));
    if (audio) args.push('-i', audio);

    const fit = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
    const filters = [`[0:v]${fit},fps=${FPS},setsar=1,format=yuv420p,trim=duration=${clipSeconds},setpts=PTS-STARTPTS[v0]`];
    photoSeconds.forEach((secs, i) => {
      const n = i + 1;
      const frames = Math.round(secs * FPS);
      // alternate a slow zoom-in and a slow zoom-out so two shots of one photo still feel different
      const zoom = i % 2 === 0 ? `1+0.12*on/${frames}` : `1.12-0.12*on/${frames}`;
      filters.push(
        `[${n}:v]split[b${n}][f${n}]`,
        `[b${n}]${fit},boxblur=24:2,eq=brightness=-0.06[bg${n}]`,
        `[f${n}]scale=${Math.round(W * 0.86)}:${Math.round(H * 0.72)}:force_original_aspect_ratio=decrease[fg${n}]`,
        `[bg${n}][fg${n}]overlay=(W-w)/2:(H-h)/2,zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p[v${n}]`,
      );
    });
    filters.push(`${photoSeconds.map((_, i) => `[v${i + 1}]`).reduce((s, x) => s + x, '[v0]')}concat=n=${photoSeconds.length + 1}:v=1:a=0[v]`);
    if (audio) filters.push(`[${photoSeconds.length + 1}:a]apad,atrim=duration=${total}[a]`);

    const out = path.join(dir, 'out.mp4');
    args.push('-filter_complex', filters.join(';'), '-map', '[v]', ...(audio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '128k'] : []),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-r', String(FPS), '-t', String(total), '-movflags', '+faststart', out);
    await run(args);
    return await fs.readFile(out);
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
