// On-screen captions, burned in on our own server (free): the spoken line in
// two short lines, white over yellow, in a bold Arabic font, changing with
// the speech like the best-performing Arabic ads. The offer (price, discount)
// shows as a yellow badge during the last scene.
//
// Editing effect: a quick punch-in zoom halfway through each talking scene,
// like TikTok editors do, so a long take never feels static.
//
// Timing is estimated from the script (no speech recognition): in "speech"
// mode each scene's line is spread over its own clip; with a voiceover the
// whole text is spread from the start at the voice's pace.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { ffmpegPath } from './compose.js';

const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');
const WORDS_PER_LINE = 3;
const VOICE_WORDS_PER_SECOND = 3;

const words = (t) => String(t || '').replace(/[{}\\]/g, '').split(/\s+/).filter(Boolean);
const round = (n) => Math.round(n * 100) / 100;
// Right-to-left marks around each line keep numbers and end punctuation in place.
const rtl = (t) => `\u200F${t}\u200F`;

/** Splits a run of words into cues of two short lines, timed over [from, to]. */
function cuesFor(list, from, to) {
  // a line ends after 3 words or at a comma/full stop; a cue never runs past a sentence end
  const lines = [];
  let cur = [];
  for (const w of list) {
    cur.push(w);
    if (cur.length === WORDS_PER_LINE || /[،,.!؟?]$/.test(w)) { lines.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) lines.push(cur.join(' '));
  const groups = [];
  for (let i = 0; i < lines.length;) {
    const pair = /[.!؟?]$/.test(lines[i]) || i + 1 >= lines.length;
    groups.push(pair ? [lines[i]] : [lines[i], lines[i + 1]]);
    i += pair ? 1 : 2;
  }
  const total = list.length || 1;
  const cues = [];
  let t = from;
  for (const g of groups) {
    const n = g.join(' ').split(' ').length;
    const end = t + ((to - from) * n) / total;
    cues.push({ start: round(t), end: round(end), top: g[0], bottom: g[1] || null });
    t = end;
  }
  return cues;
}

/**
 * @param {object} p
 * @param {{voiceover: string}[]} p.scenes
 * @param {number[]} p.sceneSeconds
 * @param {string} p.mode   speech | voiceover | hybrid
 * @param {string|null} p.offer
 */
export function captionCues({ scenes, sceneSeconds, mode, offer }) {
  const total = sceneSeconds.reduce((a, b) => a + b, 0);
  let cues = [];
  if (mode === 'speech') {
    let start = 0;
    scenes.forEach((s, i) => {
      const secs = sceneSeconds[i] || 0;
      cues.push(...cuesFor(words(s.voiceover), start + 0.15, start + secs - 0.25));
      start += secs;
    });
  } else {
    const all = scenes.flatMap((s) => words(s.voiceover));
    cues = cuesFor(all, 0.2, Math.min(total - 0.3, 0.2 + all.length / VOICE_WORDS_PER_SECOND));
  }
  // punch-in for the second half of each talking scene (hybrid photo scenes already move)
  const punches = [];
  if (mode !== 'hybrid') {
    let start = 0;
    for (const secs of sceneSeconds) {
      if (secs >= 4) punches.push([round(start + secs / 2), round(start + secs)]);
      start += secs;
    }
  }
  const last = sceneSeconds.at(-1) || 0;
  const badge = offer ? { text: words(offer).join(' ').slice(0, 48), start: round(Math.max(0, total - last)), end: round(total) } : null;
  return { cues, badge, total, punches };
}

const ts = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, sec = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

/** The ASS subtitle file for the cues. Colours are &HAABBGGRR. */
export function toAss({ cues, badge }, aspectRatio = '9:16') {
  const [W, H] = aspectRatio === '16:9' ? [1280, 720] : [720, 1280];
  const size = aspectRatio === '16:9' ? 58 : 72;
  const lift = Math.round(H * 0.2);
  const style = (name, colour, marginV, extra = '1,6,2') => `Style: ${name},VimoCaption,${size},${colour},${colour},&H00000000,&H78000000,0,0,0,0,100,100,0,0,${extra},2,40,40,${marginV},1`;
  const pop = '{\\fad(60,0)\\fscx88\\fscy88\\t(0,140,\\fscx100\\fscy100)}';
  const events = [];
  for (const c of cues) {
    if (c.bottom) {
      events.push(`Dialogue: 0,${ts(c.start)},${ts(c.end)},Top,,0,0,0,,${pop}${rtl(c.top)}`);
      events.push(`Dialogue: 0,${ts(c.start)},${ts(c.end)},Bottom,,0,0,0,,${pop}${rtl(c.bottom)}`);
    } else {
      events.push(`Dialogue: 0,${ts(c.start)},${ts(c.end)},Bottom,,0,0,0,,${pop}${rtl(c.top)}`);
    }
  }
  if (badge) events.push(`Dialogue: 1,${ts(badge.start)},${ts(badge.end)},Badge,,0,0,0,,{\\fad(120,0)\\fscx80\\fscy80\\t(0,200,\\fscx100\\fscy100)}${rtl(badge.text)}`);
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 2', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style('Top', '&H00FFFFFF', lift + Math.round(size * 1.15)),
    style('Bottom', '&H0000D7FF', lift),
    `Style: Badge,VimoCaption,${Math.round(size * 0.9)},&H00101010,&H00101010,&H0000D7FF,&H0000D7FF,0,0,0,0,100,100,0,0,3,16,0,2,40,40,${lift + Math.round(size * 2.9)},1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events, '',
  ].join('\n');
}

const PUNCH = 1.1;

/** The video filter: punch-in zooms (if any), then the captions. */
export function captionFilter({ punches = [] } = {}, aspectRatio = '9:16') {
  const [W, H] = aspectRatio === '16:9' ? [1280, 720] : [720, 1280];
  const base = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
  if (!punches.length) return `${base},ass=c.ass:fontsdir=${FONTS_DIR}`;
  const on = punches.map(([a, b]) => `between(t\\,${a}\\,${b})`).join('+');
  const z = `if(${on}\\,${PUNCH}\\,1)`;
  return `${base},scale=w='trunc(${W}*${z}/2)*2':h='trunc(${H}*${z}/2)*2':eval=frame,crop=${W}:${H},ass=c.ass:fontsdir=${FONTS_DIR}`;
}

/** Burns the captions (and the punch-in zooms) into an MP4; audio copied as is. */
export async function burnCaptions(buffer, ass, { punches = [], aspectRatio = '9:16' } = {}) {
  if (!ffmpegPath()) throw new Error('ffmpeg مش موجود على السيرفر.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vimo-cap-'));
  try {
    const input = path.join(dir, 'in.mp4');
    const out = path.join(dir, 'out.mp4');
    await fs.writeFile(input, buffer);
    await fs.writeFile(path.join(dir, 'c.ass'), ass);
    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath(), ['-y', '-loglevel', 'error', '-i', 'in.mp4', '-vf', captionFilter({ punches }, aspectRatio),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'copy', '-movflags', '+faststart', 'out.mp4'], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d) => { err = (err + d).slice(-1000); });
      const timer = setTimeout(() => child.kill('SIGKILL'), 240000);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`captions failed: ${err.trim().split('\n').at(-1)}`)); });
    });
    return await fs.readFile(out);
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
