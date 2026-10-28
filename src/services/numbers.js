// Prices and numbers are written out in Egyptian words before a line is
// spoken ("350" -> "تلاتمية وخمسين"), so the voice never reads digits
// wrong. Captions and the offer badge keep showing the digits.
const ONES = ['', 'واحد', 'اتنين', 'تلاتة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'تمانية', 'تسعة', 'عشرة',
  'حداشر', 'اتناشر', 'تلاتاشر', 'أربعتاشر', 'خمستاشر', 'ستاشر', 'سبعتاشر', 'تمنتاشر', 'تسعتاشر'];
const TENS = ['', '', 'عشرين', 'تلاتين', 'أربعين', 'خمسين', 'ستين', 'سبعين', 'تمانين', 'تسعين'];
// spelled the way they are said, so the voice reads them right ("تلاتمية", not "تلتمية")
const HUNDREDS = ['', 'مية', 'ميتين', 'تلاتمية', 'ربعمية', 'خمسمية', 'ستمية', 'سبعمية', 'تمانمية', 'تسعمية'];
const FEW_THOUSANDS = ['', 'ألف', 'ألفين', 'تلات تلاف', 'أربع تلاف', 'خمس تلاف', 'ست تلاف', 'سبع تلاف', 'تمن تلاف', 'تسع تلاف', 'عشر تلاف'];

function below1000(n) {
  const parts = [];
  if (n >= 100) parts.push(HUNDREDS[Math.floor(n / 100)]);
  const r = n % 100;
  if (r > 0 && r < 20) parts.push(ONES[r]);
  else if (r >= 20) parts.push(r % 10 ? `${ONES[r % 10]} و${TENS[Math.floor(r / 10)]}` : TENS[Math.floor(r / 10)]);
  return parts.join(' و');
}

/** An integer 0..999,999 in Egyptian words. */
export function egyptianNumber(n) {
  if (n === 0) return 'صفر';
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  const parts = [];
  if (th > 0) parts.push(th <= 10 ? FEW_THOUSANDS[th] : `${below1000(th)} ألف`);
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(' و');
}

const toLatin = (s) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** Replaces whole numbers (and "%") in a line with how an Egyptian says them. */
export function speakNumbers(text) {
  return toLatin(String(text || ''))
    .replace(/(\d)(?=[\u0621-\u064A])/g, '$1 ') // "350ج" -> "350 ج"
    .replace(/([\u0621-\u064A\u0640])(?=\d)/g, '$1 ') // "بدل700" -> "بدل 700"
    .replace(/(\d\s*)(?:ج\.?\s*م|ج)(?=$|[\s.,،!؟?])/g, '$1جنيه') // "350 ج" / "350 ج.م" -> "350 جنيه"
    .replace(/(^|[\s(])ب(?:ـ)?\s*(?=\d)/g, '$1بـ ') // "ب350" / "بـ350" -> "بـ 350": the number stays a word of its own
    .replace(/(\d{1,3}(?:,\d{3})+|\d+)(\s*%)?/g, (m, num, pct, offset, all) => {
      if (/[.\d]/.test(all[offset + m.length] || '') || /[.]/.test(all[offset - 1] || '')) return m; // decimals stay as is
      const n = Number(num.replace(/,/g, ''));
      if (!Number.isSafeInteger(n) || n > 999999) return m;
      return `${egyptianNumber(n)}${pct ? ' في المية' : ''}`;
    });
}

const CURRENCY = /جنيه|جنية|ج\.?\s*م|(^|[\s\d])ج($|[\s.,،])|ريال|درهم|دينار|دولار|\$|EGP|LE|L\.E/i;

/**
 * The price as it should be said: in words, and with "جنيه" after the first
 * price when the seller left the currency out ("500 بدل 800" ->
 * "خمسمية جنيه بدل تمانمية").
 */
export function speakOffer(offer) {
  const text = String(offer || '').trim();
  if (!text) return '';
  if (CURRENCY.test(text) || /%/.test(text)) return speakNumbers(text);
  return speakNumbers(text.replace(/(\d[\d,]*)/, '$1 جنيه'));
}
