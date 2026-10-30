export const TOTAL_DAYS = 364;
export const STORAGE_KEY = 'miracle-book.state.v1';
export const HISTORY_LIMIT = 100;
export const DEFAULT_SETTINGS = Object.freeze({ sound: false, music: true, reducedMotion: false, haptics: true, followSystemMotion: true });

const validDay = day => Number.isInteger(day) && day >= 1 && day <= TOTAL_DAYS;
// Finite numbers can still be outside JavaScript Date's representable range.
const validTimestamp = value => Number.isFinite(value) && value >= 0 && value <= 8.64e15;
const requireDay = day => { if (!validDay(day)) throw new RangeError('day must be an integer from 1 to 364'); };
const uniqueDays = values => [...new Set(Array.isArray(values) ? values.filter(validDay) : [])];

function normalizedHistory(history) {
  const seen = new Set();
  return (Array.isArray(history) ? history : [])
    .filter(item => item && validDay(item.day) && validTimestamp(item.visitedAt))
    .map(({ day, visitedAt }) => ({ day, visitedAt }))
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .filter(item => { if (seen.has(item.day)) return false; seen.add(item.day); return true; })
    .slice(0, HISTORY_LIMIT);
}

function normalizeState(value) {
  const source = value && value.version === 1 ? value : {};
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(settings)) {
    if (typeof source.settings?.[key] === 'boolean') settings[key] = source.settings[key];
  }
  return { version: 1, favorites: uniqueDays(source.favorites), history: normalizedHistory(source.history), settings };
}

export function loadState(storage) {
  try { return normalizeState(JSON.parse(storage.getItem(STORAGE_KEY))); }
  catch { return normalizeState(null); }
}

export function saveState(storage, state) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state))); return true; }
  catch { return false; }
}

export function dayQuote(quotes, day) {
  requireDay(day);
  return quotes.find(quote => quote.day === day) ?? null;
}

export function pickRandomDay(total, cryptoLike = globalThis.crypto) {
  if (!Number.isInteger(total) || total < 1 || total > 0x100000000) throw new RangeError('total is outside the random range');
  if (typeof cryptoLike?.getRandomValues !== 'function') return Math.floor(Math.random() * total) + 1;
  const sample = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / total) * total;
  do { cryptoLike.getRandomValues(sample); } while (sample[0] >= limit);
  return (sample[0] % total) + 1;
}

export function drawThreeDays(total = TOTAL_DAYS, cryptoLike = globalThis.crypto) {
  if (!Number.isInteger(total) || total < 3 || total > 0x100000000) throw new RangeError('total must be an integer from 3 to 4294967296');
  // A sparse partial Fisher-Yates shuffle avoids allocating the entire day pool.
  const swaps = new Map();
  const result = [];
  for (let index = 0; index < 3; index++) {
    let shift = 0;
    const random = typeof cryptoLike?.getRandomValues === 'function' ? {
      getRandomValues(array) {
        cryptoLike.getRandomValues(array);
        const value = (array[0] + shift) >>> 0;
        array[0] = value;
        // Translation is a bijection, preserving uniform independent samples.
        // A rejected constant test source becomes zero on its next attempt.
        shift = (shift - value) >>> 0;
        return array;
      },
    } : cryptoLike;
    const selected = index + pickRandomDay(total - index, random) - 1;
    result.push(swaps.get(selected) ?? selected + 1);
    swaps.set(selected, swaps.get(index) ?? index + 1);
  }
  return result;
}

export function toggleFavorite(favorites, day) {
  requireDay(day);
  const clean = uniqueDays(favorites);
  return clean.includes(day) ? clean.filter(value => value !== day) : [...clean, day];
}

export function recordVisit(history, day, now = Date.now()) {
  requireDay(day);
  if (!validTimestamp(now)) throw new RangeError('visitedAt must be a nonnegative timestamp within the JavaScript Date range');
  return normalizedHistory([{ day, visitedAt: now }, ...normalizedHistory(history).filter(item => item.day !== day)]);
}

export function validateQuotes(quotes) {
  if (!Array.isArray(quotes) || quotes.length !== TOTAL_DAYS) throw new Error('Expected exactly 364 source quotes');
  const days = new Set();
  for (const item of quotes) {
    if (!item || !validDay(item.day) || days.has(item.day)) throw new Error('Invalid or duplicate quote day');
    days.add(item.day);
    for (const key of ['title', 'theme', 'quote', 'raw_title']) {
      if (typeof item[key] !== 'string' || !item[key].trim()) throw new Error(`Day ${item.day}: missing ${key}`);
    }
    if (item.contentType !== 'source-image' || !['ocr-reviewed', 'ocr-unreviewed'].includes(item.verification) || item.quote === item.title || 'yinyang' in item) throw new Error(`Day ${item.day}: invalid content metadata`);
    if (typeof item.sourceImage !== 'string' || !item.sourceImage.trim() || !/^[a-f0-9]{64}$/i.test(item.imageSha256)) throw new Error(`Day ${item.day}: invalid source image provenance`);
    if (!item.sourceUrl || !item.sourceTitle) throw new Error(`Day ${item.day}: incomplete source metadata`);
    if (item.sourceUrl !== null) {
      let url;
      try { url = new URL(item.sourceUrl); } catch { throw new Error(`Day ${item.day}: invalid source URL`); }
      if (typeof item.sourceUrl !== 'string' || url.protocol !== 'https:' || url.username || url.password || typeof item.sourceTitle !== 'string' || !item.sourceTitle.trim()) throw new Error(`Day ${item.day}: invalid source`);
    }
  }
  return true;
}
