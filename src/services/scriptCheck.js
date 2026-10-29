// Automatic review of a script before the customer sees it (no AI, free):
// repeated words, made-up features, wrong or invented prices, long or formal
// sentences and lines too long for their scene. The script writer gets one
// round to fix what is found; whatever is left is shown to the customer.
import { egyptianNumber, speakOffer } from './numbers.js';

const STOP = new Set(['اللي', 'على', 'علي', 'عشان', 'علشان', 'كمان', 'بس', 'ده', 'دي', 'دا', 'دول', 'من', 'في', 'مع', 'عن', 'لحد', 'لما', 'كل', 'انت', 'إنت', 'انتي', 'إنتي', 'هو', 'هي', 'احنا', 'إحنا', 'مش', 'لو', 'او', 'أو', 'ولا', 'يعني', 'خالص', 'أوي', 'اوي', 'جدا', 'جدًا', 'جنيه', 'مية']);
// Formal Arabic (فصحى) that sounds like an AI or a translation in an Egyptian ad.
const FORMAL = ['سوف', 'لذلك', 'حيث', 'هذا', 'هذه', 'الذي', 'التي', 'لقد', 'ليس', 'لن', 'كيف', 'ماذا', 'الآن', 'جداً', 'إنه', 'إنها', 'أيضاً', 'أيضا', 'لكن'];
// Claims that must come from the seller (or be clearly visible), never from the writer's imagination.
const CLAIMS = ['ضمان', 'مقاوم للمية', 'ضد المية', 'جلد طبيعي', 'قطن', 'أصلي', 'اوريجينال', 'أورجينال', 'مستورد', 'طبي', 'شحن مجاني', 'الشحن مجاني', 'توصيل مجاني', 'استبدال', 'استرجاع', 'ساعة', 'ساعات', 'ساعتين', 'يوم', 'أيام', 'سنة', 'سنين', 'شهر', 'دقيقة', 'دقايق', 'ثانية', 'ثواني', 'كيلو', 'متر', 'سم', 'مقاس'];
const MAX_SENTENCE_WORDS = 10;

const plainAr = (t) => String(t || '').replace(/[ً-ٰٟـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
const wordsOf = (t) => plainAr(t).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
const STOP_PLAIN = new Set([...STOP].map((w) => plainAr(w)));
const content = (w) => w.length >= 3 && !STOP_PLAIN.has(w) && !STOP_PLAIN.has(stem(w));
const stem = (w) => w.replace(/^(و|ف|ب)(?=..)/, '').replace(/^ال(?=...)/, '');

/** Number phrases the seller gave (price, discount, sizes...), as they will be spoken. */
function allowedNumbers(sources) {
  const out = new Set();
  for (const m of String(sources).matchAll(/\d[\d,]*/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isSafeInteger(n) && n <= 999999) out.add(plainAr(egyptianNumber(n)));
  }
  return out;
}

// number words after plainAr ("خمس مية" -> "خمس ميه"); a lone "ميه" is water, not a number
const numberWords = (withCurrency) => new RegExp(`(^|\\s)((تلات|ربع|خمس|ست|سبع|تمن|تمان|تسع) ?ميه|ميتين|الف|الفين|تلاف|عشرين|تلاتين|اربعين|خمسين|ستين|سبعين|تمانين|تسعين${withCurrency ? '|جنيه' : ''})(?=\\s|$)`);

/**
 * @param {object} p
 * @param {{voiceover: string}[]} p.scenes
 * @param {number[]} p.limits        max spoken words per scene
 * @param {string|null} p.offer
 * @param {string} [p.facts]         everything the seller wrote + what the photos clearly show
 * @returns {{ok: boolean, issues: {scene: number|null, kind: string, message: string}[], passed: string[]}}
 */
export function checkScript({ scenes, limits = [], offer = null, facts = '' }) {
  const issues = [];
  const add = (scene, kind, message) => issues.push({ scene, kind, message });
  const lines = scenes.map((s) => String(s?.voiceover || ''));
  const sources = plainAr(`${facts} ${offer || ''}`);

  lines.forEach((line, i) => {
    const n = line.split(/\s+/).filter(Boolean).length;
    if (limits[i] && n > limits[i]) add(i, 'TOO_LONG', `المشهد ${i + 1} فيه ${n} كلمة، والمسموح ${limits[i]}.`);
    for (const sentence of line.split(/[.!؟?،,]/)) {
      if (sentence.split(/\s+/).filter(Boolean).length > MAX_SENTENCE_WORDS) add(i, 'LONG_SENTENCE', `جملة طويلة في المشهد ${i + 1}: «${sentence.trim()}».`);
    }
    if (/\d/.test(line)) add(i, 'DIGITS', `المشهد ${i + 1} فيه أرقام مكتوبة بالأرقام، لازم تتكتب كلام.`);
    const w = wordsOf(line);
    const formal = FORMAL.filter((f) => w.includes(plainAr(f)) || w.some((x) => /^[وف]/.test(x) && x.slice(1) === plainAr(f)));
    if (formal.length) add(i, 'FORMAL', `كلام فصحى في المشهد ${i + 1}: ${formal.join('، ')}.`);
    for (const claim of CLAIMS) {
      const c = plainAr(claim);
      if (` ${w.join(' ')} `.includes(` ${c} `) && !sources.includes(c)) add(i, 'INVENTED', `المشهد ${i + 1} بيقول «${claim}» ومفيش حاجة زي كده في بيانات المنتج.`);
    }
  });

  // the same word twice in one line, or in two lines next to each other
  for (let i = 0; i < lines.length; i++) {
    const here = wordsOf(lines[i]).filter(content).map(stem);
    const seen = new Set();
    for (const w of here) {
      if (seen.has(w)) { add(i, 'REPEAT', `كلمة «${w}» متكررة في المشهد ${i + 1}.`); break; }
      seen.add(w);
    }
    if (i > 0) {
      const prev = new Set(wordsOf(lines[i - 1]).filter(content).map(stem));
      const twice = here.find((w) => prev.has(w) && w.length >= 4);
      if (twice) add(i, 'REPEAT', `كلمة «${twice}» متكررة في المشهد ${i} و${i + 1}.`);
    }
  }

  // prices: exactly the seller's, said in the last scene, and none invented
  const all = plainAr(lines.join(' '));
  const allowed = allowedNumbers(`${facts} ${offer || ''}`);
  if (offer) {
    const want = [...allowedNumbers(offer)];
    const missing = want.filter((p) => !all.includes(p));
    if (missing.length) add(lines.length - 1, 'PRICE', `السعر مش متقال صح، المفروض: «${speakOffer(offer)}».`);
  }
  let rest = all;
  for (const p of [...allowed].sort((a, b) => b.length - a.length)) rest = rest.split(p).join(' ');
  if (numberWords(!offer).test(rest)) add(null, 'PRICE', offer ? 'في رقم أو سعر في السكريبت مش من السعر اللي كتبته.' : 'السكريبت فيه سعر أو رقم، وإنت ما كتبتش سعر.');

  const LABELS = { REPEAT: 'مفيش كلام متكرر', INVENTED: 'مفيش مميزات متألفة', PRICE: offer ? 'السعر متقال صح' : 'مفيش أسعار متألفة', LONG_SENTENCE: 'الجمل قصيرة', TOO_LONG: 'الكلام على قد وقت كل مشهد', FORMAL: 'عامية مصرية مش فصحى', DIGITS: 'الأرقام مكتوبة كلام' };
  const failed = new Set(issues.map((x) => x.kind));
  return { ok: !issues.length, issues, passed: Object.entries(LABELS).filter(([k]) => !failed.has(k)).map(([, v]) => v) };
}
