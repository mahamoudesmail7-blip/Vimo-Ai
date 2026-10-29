// Product analysis from the photos alone, so the customer never has to write a
// long description: what the product is, its colors and visible details, sorted
// into what the photos clearly show (confirmed), what is probably true (likely)
// and what a buyer would ask that the photos can't answer (unknown). It also
// suggests a short Arabic description the customer can edit.
//
// Only "confirmed" facts (and what the seller writes) may be said in the ad.
import { askVision, parseJsonObject } from './script.js';
import { env } from '../config.js';

export const CATEGORIES = ['shoes', 'clothing', 'bag', 'accessory', 'beauty', 'kitchen', 'home', 'electronics', 'kids', 'sports', 'food', 'other'];

// How each kind of product is really used on camera (in English, for the scene directions).
export const USE_SCENES = {
  shoes: ['the person wears the shoes and walks a few steps toward the camera, feet clearly in frame', 'close-up of the feet in the shoes on the floor while the person shifts their weight comfortably'],
  clothing: ['the person wears the piece and turns slowly so its fit and fabric show', 'close-up of the fabric on the body while the person moves naturally'],
  bag: ['the person carries the bag on the shoulder or in hand while walking', 'the person opens the bag and puts their daily things inside'],
  accessory: ['the person wears it and shows it near the camera', 'close-up on the wrist, neck or hand wearing it'],
  beauty: ['the person applies a little of the product on their skin or hair', 'close-up of the result on the skin while the person smiles'],
  kitchen: ['the person uses it while cooking in a real Egyptian kitchen', 'close-up of the tool doing its job on real food'],
  home: ['the product in its place in a real home being used', 'the person uses it in daily home life'],
  electronics: ['the person uses the device the way it is meant to be used', 'close-up of the device working in hand'],
  kids: ['a parent uses it with a child at home', 'close-up of the product in a child-friendly home setting'],
  sports: ['the person uses it during a workout', 'close-up of the product in action during exercise'],
  food: ['the person tastes it and reacts honestly', 'close-up of the food being served'],
  other: ['the person uses the product the way it is meant to be used'],
};

const SYSTEM = 'You are a careful e-commerce product analyst in Egypt. You look at product photos and describe only what you can see. You reply with one JSON object only, no markdown.';

const REQUEST = [
  'Study ALL the attached photos of one product listing (they may show the same product in different colors or from different angles).',
  'Return exactly this JSON:',
  '{"category": one of ' + CATEGORIES.join('|') + ', "productAr": short Egyptian-Arabic product name (2-5 words, e.g. "كوتشي رجالي سليب أون"),',
  ' "colors": [Egyptian-Arabic color names, one per distinct color variant shown, e.g. "رمادي", "أسود", "كحلي"],',
  ' "confirmed": [Egyptian-Arabic short facts clearly visible in the photos: shape, parts, material look, closure, visible logo/brand text],',
  ' "likely": [Egyptian-Arabic things that are probably true but not certain from a photo],',
  ' "unknown": [Egyptian-Arabic things a buyer would ask that photos cannot show: sizes, real material, price, warranty...],',
  ' "description": one or two short Egyptian-Arabic sentences a seller would write, using ONLY confirmed facts and the colors}',
  'Never guess a price, size, brand that is not printed, material composition or a guarantee: those go in "unknown".',
].join('\n');

const list = (v, max = 8) => (Array.isArray(v) ? v : []).map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, max).map((x) => x.slice(0, 120));

/** Cleans what the model returned; never throws. */
export function normalizeAnalysis(data) {
  const d = data && typeof data === 'object' ? data : {};
  const category = CATEGORIES.includes(d.category) ? d.category : 'other';
  const colors = [...new Set(list(d.colors, 10))];
  const confirmed = list(d.confirmed);
  // a fact can't be both confirmed and unknown: the stricter list wins
  const unknown = list(d.unknown);
  const likely = list(d.likely).filter((x) => !confirmed.includes(x) && !unknown.includes(x));
  return {
    category,
    productAr: String(d.productAr || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    colors,
    confirmed: confirmed.filter((x) => !unknown.includes(x)),
    likely,
    unknown,
    description: String(d.description || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    useScenes: USE_SCENES[category],
  };
}

/** Reads the product from its photos. Returns null when no vision model is set up or it fails. */
export async function analyzeProduct(imageDataUrls) {
  if (!env.openAiKey() && !env.falKey()) return null;
  try {
    const reply = await askVision(REQUEST, imageDataUrls, SYSTEM, 0.2);
    return normalizeAnalysis(parseJsonObject(reply));
  } catch (err) {
    console.warn('[analyze] could not read the product photos:', err.message);
    return null;
  }
}

/** The analysis sent back by the browser (the customer may have edited the description). */
export function readAnalysis(v) {
  if (!v || typeof v !== 'object') return null;
  const a = normalizeAnalysis(v);
  return a.productAr || a.colors.length || a.confirmed.length ? a : null;
}
