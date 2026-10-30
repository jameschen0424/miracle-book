/* Native capabilities are optional: a failed sound/share never blocks reading. */
function nativePlugin(name) {
  const cap = globalThis.Capacitor;
  if (!cap?.isNativePlatform?.() || !cap.isPluginAvailable?.(name)) return null;
  return cap.registerPlugin?.(name) ?? cap.Plugins?.[name] ?? null;
}

const cancelled = error => /cancel|abort|dismiss/i.test(`${error?.name ?? ''} ${error?.message ?? ''}`);

export class SoundEngine {
  constructor() { this.context = null; this.enabled = false; this.nodes = new Set(); this.generation = 0; }
  setEnabled(value) { this.enabled = value; if (!value) this.stop(); }
  async chime(soft = false) {
    if (!this.enabled || document.hidden) return;
    const generation = this.generation;
    try {
      const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Audio) return;
      this.context ??= new Audio();
      if (this.context.state === 'suspended') await this.context.resume();
      if (!this.enabled || document.hidden || generation !== this.generation) return;
      const now = this.context.currentTime;
      [523.25, 783.99].forEach((frequency, index) => {
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        osc.frequency.value = frequency;
        const start = now + index * 0.045;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(soft ? 0.025 : 0.065, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.6);
        osc.connect(gain); gain.connect(this.context.destination);
        this.nodes.add(osc);
        osc.onended = () => { osc.disconnect(); gain.disconnect(); this.nodes.delete(osc); };
        osc.start(start); osc.stop(start + 1.7);
      });
    } catch { /* Unsupported or interrupted audio is intentionally non-fatal. */ }
  }
  stop() { this.generation++; for (const node of this.nodes) { try { node.stop(); } catch {} } this.nodes.clear(); }
}

export async function haptic(enabled) {
  if (!enabled) return;
  try {
    const plugin = nativePlugin('Haptics');
    if (plugin) await plugin.impact({ style: 'LIGHT' });
    else globalThis.navigator?.vibrate?.(15);
  } catch { /* Optional hardware capability. */ }
}

export function quoteText(quote) {
  return `《奇蹟之書》DAY ${String(quote.day).padStart(3, '0')}

${quote.title}

${quote.quote}`;
}

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { status: 'copied' };
    }
    const previous = document.activeElement;
    const input = document.createElement('textarea');
    input.value = text; input.className = 'sr-only'; input.setAttribute('aria-label', '複製文字');
    document.body.append(input);
    let success;
    try { input.focus(); input.select(); success = document.execCommand('copy'); }
    finally { input.remove(); previous?.focus?.(); }
    return { status: success ? 'copied' : 'error' };
  } catch (error) { return { status: 'error', error }; }
}

export async function shareText(quote) {
  const text = quoteText(quote);
  try {
    const share = nativePlugin('Share');
    if (share) { await share.share({ title: '奇蹟之書 · 留一頁給自己', text, dialogTitle: '分享這一頁' }); return { status: 'shared' }; }
    if (navigator.share) { await navigator.share({ title: '奇蹟之書', text }); return { status: 'shared' }; }
    return await copyText(text);
  } catch (error) { return { status: cancelled(error) ? 'cancelled' : 'error', error }; }
}

export async function sharePoster(poster, day) {
  try {
    const plugin = nativePlugin('CardShare');
    if (plugin) return await plugin.share({ dataUrl: poster.dataUrl, title: `奇蹟之書 · 第 ${day} 天` });
    // A native WebView without its image plugin must not pretend it downloaded a file.
    if (globalThis.Capacitor?.isNativePlatform?.()) return { status: 'unsupported' };
    const file = new File([poster.blob], `奇蹟之書_Day${String(day).padStart(3, '0')}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ title: '奇蹟之書', files: [file] });
      return { status: 'shared' };
    }
    const url = URL.createObjectURL(poster.blob);
    const link = document.createElement('a'); link.href = url; link.download = file.name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { status: 'downloaded' };
  } catch (error) { return { status: cancelled(error) ? 'cancelled' : 'error', error }; }
}

/** Character wrapping also supports unspaced Chinese and exceptionally long titles. */
export function wrapText(context, text, width) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const character of paragraph) {
      if (line && context.measureText(line + character).width > width) { lines.push(line); line = character; }
      else line += character;
    }
    lines.push(line);
  }
  return lines;
}

export async function createPoster(quote) {
  await document.fonts?.load('64px "教育部隸書"');
  await document.fonts?.ready;
  const loadArtwork = url => new Promise(resolve => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = url;
  });
  const [landscape, taiji] = await Promise.all([loadArtwork('assets/ink-landscape.png'), loadArtwork('assets/taiji-ink.svg')]);
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Canvas unavailable');
  const serif = '"教育部隸書", "正風毛筆", serif';
  const sans = serif;
  const textWidth = 790;
  
  c.font = `64px ${serif}`; const titles = wrapText(c, quote.title, textWidth);
  c.font = `52px ${serif}`; const quotes = wrapText(c, quote.quote, textWidth);
  const contentHeight = titles.length * 104 + quotes.length * 88 + 72;
  canvas.height = Math.max(1620, 1100 + contentHeight);
  const height = canvas.height;
  c.fillStyle = '#eee8d9'; c.fillRect(0, 0, 1080, height);
  if (landscape) { c.globalAlpha = 0.67; c.drawImage(landscape, 0, 0, 1080, height); c.globalAlpha = 1; }
  c.strokeStyle = '#787c67'; c.lineWidth = 1.5; c.strokeRect(37, 37, 1006, height - 74);
  c.fillStyle = '#272c28'; c.textAlign = 'center';
  c.font = `44px ${serif}`; c.fillText('奇 蹟 之 書', 540, 116);
  c.fillStyle = 'rgba(248,244,233,0.91)'; c.fillRect(80, 174, 920, height - 330);
  // Deterministic paper grain; generated locally, without image/font downloads.
  c.fillStyle = 'rgba(103,84,49,0.035)';
  for (let i = 0; i < 1800; i++) c.fillRect(80 + (i * 137 % 920), 174 + (i * 277 % (height - 330)), 2, 2);
  c.fillStyle = '#65705b'; c.font = `24px ${sans}`;
  c.fillText(`DAY ${String(quote.day).padStart(3, '0')}   /   ${quote.theme}`, 540, 260);
  if (taiji) c.drawImage(taiji, 466, 278, 148, 148);
  else { c.font = '76px serif'; c.fillStyle = '#272c28'; c.fillText('☯', 540, 365); }

  let y = 512;
  c.fillStyle = '#272c28'; c.font = `64px ${serif}`;
  for (const line of titles) { c.fillText(line, 540, y); y += 104; }
  y += 15;
  c.strokeStyle = '#889078'; c.beginPath(); c.moveTo(450, y); c.lineTo(630, y); c.stroke(); y += 85;
  c.font = `52px ${serif}`;
  for (const line of quotes) { c.fillText(line, 540, y); y += 88; }
  y += 30;
  c.strokeStyle = '#b9beab'; c.beginPath(); c.moveTo(145, y); c.lineTo(935, y); c.stroke(); y += 62;
  c.textAlign = 'center'; c.fillStyle = '#7b745f'; c.font = `20px ${sans}`;
  c.fillText('原始金句 · 留一頁給自己', 540, height - 217);
  c.fillStyle = '#983d32'; c.font = `27px ${serif}`; c.fillText('一 陰 一 陽 之 謂 道', 540, height - 85);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG export failed')), 'image/png'));
  return { blob, dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height, contentBottom: y, contentLimit: height - 265 };
}
