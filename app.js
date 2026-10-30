import { TOTAL_DAYS, loadState, saveState, dayQuote, drawThreeDays, toggleFavorite, recordVisit, validateQuotes } from './core.mjs';
import { SoundEngine, haptic, quoteText, copyText, shareText, createPoster, sharePoster } from './platform.js';
import { BackgroundMusic } from './assets/music-player.mjs';
import { MotionDirector } from './assets/motion.mjs';

const $ = id => document.getElementById(id);
const views = ['loading', 'error', 'focus', 'select', 'reading', 'library'];
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let storage;
try { storage = window.localStorage; } catch { storage = null; }
let persisted = loadState(storage);
let hasSavedMotion = !persisted.settings.followSystemMotion;
if (!hasSavedMotion) persisted.settings.reducedMotion = motionPreference.matches;
const audio = new SoundEngine();
let quotes = [];
let view = 'loading';
let tab = 'today';
let offeredDays = [];
let displayed = null;
let busy = false;
let choiceTimer = null;
let choiceToken = 0;
let holdFrame = null;
let holding = false;
let holdStarted = 0;
let toastTimer = null;
let storageWarned = false;
let poster = null;
let posterQuote = null;
let posterToken = 0;
let confirmAction = null;
const focusBeforeDialog = new WeakMap();
let libraryPage = 0;
let readingPart = 0;
let readingParts = [];
let resumeMusic = false;
let musicErrorShown = false;
let initializationToken = 0;
let readingFrame = null;
const motion = new MotionDirector(() => !persisted.settings.reducedMotion && !document.hidden);
const backgroundAudio = new Audio();
backgroundAudio.id = 'background-music';
backgroundAudio.hidden = true;
document.body.append(backgroundAudio);
const music = new BackgroundMusic({ audio: backgroundAudio, volume: .25, mode: 'all', onChange: state => {
  $('sound-button').dataset.playing = String(state.playing);
  if (state.error && !musicErrorShown) { musicErrorShown = true; toast('背景音樂暫時無法播放，可輕點音樂開關重試。'); }
  if (state.playing) musicErrorShown = false;
} });

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3200);
}
function persist() {
  if (!saveState(storage, persisted) && !storageWarned) {
    storageWarned = true;
    toast('目前無法儲存，這次的變更將只保留到關閉頁面。');
  }
}
function announce(message) { $('announcer').textContent = message; }
function applySettings() {
  const { sound, reducedMotion, haptics } = persisted.settings;
  document.documentElement.dataset.reducedMotion = String(reducedMotion);
  if (reducedMotion) motion.cancelAll();
  audio.setEnabled(sound);
  if ($('setting-sound')) $('setting-sound').checked = sound;
  if ($('setting-motion')) $('setting-motion').checked = reducedMotion;
  if ($('setting-haptics')) $('setting-haptics').checked = haptics;
  $('sound-button').setAttribute('aria-pressed', String(persisted.settings.music));
  $('sound-button').setAttribute('aria-label', persisted.settings.music ? '關閉背景音樂' : '開啟背景音樂');
}
function setSetting(key, value) {
  persisted.settings[key] = value;
  if (key === 'reducedMotion') { hasSavedMotion = true; persisted.settings.followSystemMotion = false; }
  applySettings(); persist();
  if (key === 'sound' && value) audio.chime(true);
}
motionPreference.addEventListener('change', event => {
  if (!hasSavedMotion) { persisted.settings.reducedMotion = event.matches; applySettings(); }
});

function cancelCardChoice() {
  choiceToken++;
  clearTimeout(choiceTimer); choiceTimer = null;
  busy = false;
  document.querySelectorAll('.number-choice').forEach(card => { card.disabled = false; card.classList.remove('chosen'); });
  $('random-button').disabled = false;
}
function stopHold() {
  holding = false;
  cancelAnimationFrame(holdFrame); holdFrame = null;
  $('hold-button').style.removeProperty('--hold-progress');
  $('hold-button').classList.remove('holding');
  document.querySelector('.book-scene').classList.remove('is-holding');
  $('hold-label').textContent = '按住，開啟一頁指引';
}
function setView(next, focus = true, animate = true) {
  motion.cancelWithin($('main-content'));
  cancelAnimationFrame(readingFrame); readingFrame = null;
  cancelCardChoice(); stopHold();
  if (view === 'focus' && next !== 'focus') audio.stop();
  view = next;
  document.querySelector('.app-shell').dataset.view = next;
  views.forEach(name => $(`${name}-view`).hidden = name !== next);
  document.querySelectorAll('.nav-item').forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (next === 'reading') scheduleReading();
  if (animate) {
    motion.reveal($(`${next}-view`), 'view-enter');
    if (next === 'focus') motion.stagger(document.querySelectorAll('#focus-view .intro, #focus-view .book-scene, #focus-view .ritual-actions'), 'home-enter');
    if (next === 'library') motion.stagger(document.querySelectorAll('.library-row'), 'library-enter');
  }
  if (focus) {
    const target = $(`${next}-title`) ?? $('main-content');
    target.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}
function dealCards() {
  if (busy || !quotes.length) return;
  offeredDays = drawThreeDays(TOTAL_DAYS);
  document.querySelectorAll('.number-choice').forEach((card, index) => {
    const day = offeredDays[index];
    card.dataset.day = String(day);
    card.querySelector('.number-value').textContent = String(day).padStart(3, '0');
    card.setAttribute('aria-label', `選擇第 ${day} 天的數字卡片`);
    card.classList.remove('chosen');
    card.disabled = false;
  });
  $('number-cards').classList.remove('dealt');
  void $('number-cards').offsetWidth;
  $('number-cards').classList.add('dealt');
  announce('三張數字卡片已展開，請選擇與你有共鳴的一張。');
}
function showSelection(pushState = true) {
  tab = 'today';
  setView('select');
  dealCards();
  if (pushState && window.location.hash !== '#select') {
    history.pushState({ view: 'select' }, '', '#select');
  }
}
function enterRitual() {
  stopHold(); showSelection();
  audio.chime(); haptic(persisted.settings.haptics);
}
function beginHold(event) {
  if (event.button !== 0 || holding || busy) return;
  holding = true; holdStarted = performance.now();
  $('hold-button').setPointerCapture?.(event.pointerId);
  $('hold-button').classList.add('holding');
  document.querySelector('.book-scene').classList.add('is-holding');
  $('hold-label').textContent = '慢慢呼吸，聽見自己…';
  const step = now => {
    if (!holding) return;
    const progress = Math.min(1, (now - holdStarted) / 1200);
    $('hold-button').style.setProperty('--hold-progress', String(progress));
    if (progress >= 1) enterRitual();
    else holdFrame = requestAnimationFrame(step);
  };
  holdFrame = requestAnimationFrame(step);
}
function chooseCard(index) {
  if (busy || view !== 'select' || !Number.isInteger(offeredDays[index])) return;
  const day = offeredDays[index];
  busy = true;
  const token = ++choiceToken;
  document.querySelectorAll('.number-choice').forEach((card, cardIndex) => {
    card.disabled = true;
    card.classList.toggle('chosen', cardIndex === index);
  });
  document.querySelectorAll('.number-choice').forEach((card, cardIndex) => {
    if (cardIndex !== index) motion.play(card, [{ opacity: 1 }, { opacity: .42, transform: 'translateY(5px) scale(.97)' }], { name: 'card-release', duration: 320 });
  });
  $('random-button').disabled = true;
  haptic(persisted.settings.haptics);
  const reveal = () => {
    if (token !== choiceToken || view !== 'select') return;
    busy = false; openQuote(day);
  };
  if (persisted.settings.reducedMotion) reveal();
  else choiceTimer = setTimeout(reveal, 320);
}
function refreshFavorite() {
  if (!displayed) return;
  const active = persisted.favorites.includes(displayed.day);
  $('favorite-button').setAttribute('aria-pressed', String(active));
  $('favorite-button').querySelector('span').textContent = active ? '已收藏' : '收藏';
}
function openQuote(day, pushState = true) {
  if (busy) return;
  const item = dayQuote(quotes, day);
  if (!item) { toast('這一頁的資料暫時無法使用。'); return; }
  const previousDay = view === 'reading' ? displayed?.day : null;
  const pageButton = document.activeElement;
  const keepPageFocus = previousDay !== null && ['previous-button', 'next-button'].includes(pageButton?.id);
  // Every reading action uses this same immutable snapshot, never the selection timer.
  displayed = Object.freeze({ ...item });
  tab = 'today';
  $('reading-day').textContent = `DAY ${String(item.day).padStart(3, '0')}`;
  if ($('reading-theme')) {
    $('reading-theme').textContent = item.theme;
    $('reading-theme').hidden = false;
  }
  $('reading-title').textContent = item.title;
  $('reading-title').hidden = false;
  $('reading-quote').hidden = false;
  $('reading-view').setAttribute('aria-label', `第 ${item.day} 天，${item.title}`);
  $('reading-view').removeAttribute('aria-labelledby');
  $('reading-title').setAttribute('aria-label', `第 ${item.day} 天，${item.title}`);
  $('reading-title').setAttribute('aria-describedby', 'reading-quote');
  $('reading-quote').textContent = item.quote;
  $('page-position').textContent = `${String(item.day).padStart(3, '0')} / ${TOTAL_DAYS}`;
  $('previous-button').disabled = item.day === 1;
  $('next-button').disabled = item.day === TOTAL_DAYS;
  refreshFavorite();
  persisted.history = recordVisit(persisted.history, item.day);
  persist();
  readingPart = 0;
  setView('reading', false, false);
  if (pushState && window.location.hash !== `#day=${item.day}`) {
    history.pushState({ view: 'reading', day: item.day }, '', `#day=${item.day}`);
  }
  const direction = previousDay === null ? 0 : Math.sign(day - previousDay);
  motion.play($('reading-paper'), [
    { opacity: .2, transform: `translate(${direction * 12}px, ${direction ? 0 : 9}px) rotate(${direction * .35}deg)` },
    { opacity: 1, transform: 'translate(0, 0) rotate(0)' },
  ], { name: direction > 0 ? 'page-next' : direction < 0 ? 'page-previous' : 'paper-open', duration: 340 });
  motion.play($('reading-quote'), [{ opacity: 0 }, { opacity: 1 }], { name: 'quote-reveal', duration: 300, delay: 65 });
  if (keepPageFocus) {
    (pageButton.disabled ? $(day === 1 ? 'next-button' : 'previous-button') : pageButton).focus({ preventScroll: true });
  } else $('reading-title').focus({ preventScroll: true });
  if (keepPageFocus) announce(`第 ${item.day} 天。${item.quote}`);
  window.scrollTo({ top: 0, behavior: 'instant' });
  audio.chime(true);
}
function scheduleReading() {
  cancelAnimationFrame(readingFrame);
  readingFrame = requestAnimationFrame(() => { readingFrame = null; paginateReading(); });
}
function relativeTime(timestamp) {
  const parts = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp));
  return `${parts} 閱讀`;
}
function renderReadingPart() {
  const target = $('reading-quote');
  readingPart = Math.max(0, Math.min(readingPart, readingParts.length - 1));
  const part = readingParts[readingPart] ?? { title: '', body: '' };
  $('reading-title').textContent = part.title;
  $('reading-title').hidden = !part.title;
  target.textContent = part.body;
  target.hidden = !part.body;
  $('reading-part-position').textContent = `${readingPart + 1} / ${Math.max(1, readingParts.length)}`;
  $('reading-part-prev').disabled = readingPart === 0;
  $('reading-part-next').disabled = readingPart >= readingParts.length - 1;
  $('reading-content-pages').hidden = readingParts.length <= 1;
}
function paginateReading() {
  if (!displayed || view !== 'reading') return;
  const controls = $('reading-content-pages');
  controls.hidden = true;
  const content = $('reading-content');
  const makeMeasure = target => {
    const style = getComputedStyle(target);
    const node = document.createElement('div');
    Object.assign(node.style, { position: 'fixed', left: '-10000px', top: '0', width: `${content.clientWidth}px`, font: style.font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, whiteSpace: 'pre-line', overflowWrap: 'anywhere', padding: '0', margin: '0', visibility: 'hidden' });
    document.body.append(node); return node;
  };
  const titleMeasure = makeMeasure($('reading-title'));
  const bodyMeasure = makeMeasure($('reading-quote'));
  const title = [...displayed.title], body = [...displayed.quote];
  const gap = parseFloat(getComputedStyle(content).rowGap) || 0;
  const height = (node, text) => { node.textContent = text; return node.getBoundingClientRect().height; };
  const fit = (node, chars, offset, available) => {
    let low = 1, high = chars.length - offset, count = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (height(node, chars.slice(offset, offset + mid).join('')) <= available) { count = mid; low = mid + 1; }
      else high = mid - 1;
    }
    return count;
  };
  const split = () => {
    const available = Math.max(20, content.clientHeight - 4);
    const parts = []; let ti = 0, bi = 0;
    while (ti < title.length || bi < body.length) {
      let heading = '', text = '';
      if (ti < title.length) {
        const count = Math.max(1, fit(titleMeasure, title, ti, available));
        heading = title.slice(ti, ti + count).join(''); ti += count;
      }
      const remaining = available - (heading ? height(titleMeasure, heading) + gap : 0);
      if (ti === title.length && bi < body.length) {
        let count = fit(bodyMeasure, body, bi, remaining);
        if (!heading) count = Math.max(1, count);
        text = body.slice(bi, bi + count).join(''); bi += count;
      }
      parts.push({ title: heading, body: text });
    }
    return parts;
  };
  let parts = split();
  if (parts.length > 1) { controls.hidden = false; parts = split(); }
  titleMeasure.remove(); bodyMeasure.remove();
  readingParts = parts; renderReadingPart();
}
function changeReadingPart(delta) {
  readingPart += delta; renderReadingPart();
  motion.reveal($('reading-quote'), 'quote-part');
  announce([$('reading-title').textContent, $('reading-quote').textContent].filter(Boolean).join('。'));
}
$('reading-part-prev').addEventListener('click', () => changeReadingPart(-1));
$('reading-part-next').addEventListener('click', () => changeReadingPart(1));
const readingObserver = new ResizeObserver(() => { if (view === 'reading') scheduleReading(); });
readingObserver.observe($('reading-content'));
document.fonts?.ready.then(() => { if (view === 'reading') paginateReading(); });
function renderLibrary(kind, keepPage = false) {
  if (!keepPage) libraryPage = 0;
  tab = kind;
  const favorite = kind === 'favorites';
  $('library-eyebrow').textContent = favorite ? 'PAGES TO KEEP' : 'YOUR QUIET JOURNEY';
  $('library-title').textContent = favorite ? '收藏的微光' : '走過的每一頁';
  $('library-description').textContent = favorite ? '把有共鳴的文字，留在隨時能回來的地方。' : '有些文字，再讀一次，又有不同的風景。';
  const items = favorite ? [...persisted.favorites].reverse().map(day => ({ day })) : persisted.history;
  const pageCount = Math.max(1, Math.ceil(items.length / 3));
  libraryPage = Math.max(0, Math.min(libraryPage, pageCount - 1));
  $('library-page').textContent = `${libraryPage + 1} / ${pageCount}`;
  $('library-prev').disabled = libraryPage === 0;
  $('library-next').disabled = libraryPage >= pageCount - 1;
  $('library-pages').hidden = items.length <= 3;
  $('library-count').textContent = `${items.length} ${favorite ? '篇收藏' : '篇閱讀足跡'}`;
  $('clear-history').hidden = favorite || !items.length;
  $('library-list').replaceChildren();
  for (const entry of items.slice(libraryPage * 3, libraryPage * 3 + 3)) {
    const quote = dayQuote(quotes, entry.day);
    if (!quote) continue;
    const row = document.createElement('button'); row.className = 'library-row'; row.dataset.day = String(entry.day);
    const number = document.createElement('span'); number.className = 'library-day';
    const dayLabel = document.createElement('small'); dayLabel.textContent = 'DAY';
    number.append(dayLabel, String(entry.day).padStart(3, '0'));
    const copy = document.createElement('span'); copy.className = 'library-row-copy';
    const title = document.createElement('strong'); title.textContent = quote.title;
    const detail = document.createElement('small'); detail.textContent = favorite ? quote.theme : relativeTime(entry.visitedAt);
    copy.append(title, detail);
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); arrow.classList.add('icon'); arrow.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#i-chevron'); arrow.append(use);
    row.append(number, copy, arrow); row.addEventListener('click', () => openQuote(entry.day));
    $('library-list').append(row);
  }
  $('library-empty').hidden = items.length > 0;
  $('empty-title').textContent = favorite ? '為自己收藏一點微光' : '你的旅程，從一頁開始';
  $('empty-copy').textContent = favorite ? '閱讀時輕點星號，喜歡的篇章就會留在這裡。' : '翻開過的篇章會留在這裡，陪你再次回訪。';
  setView('library', false);
  $('library-title').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function openDialog(id, opener = document.activeElement) {
  const dialog = $(id);
  if (dialog.open) return;
  focusBeforeDialog.set(dialog, opener);
  dialog.showModal();
  motion.play(dialog, [{ opacity: 0, transform: 'translateY(12px) scale(.985)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { name: 'dialog-enter', duration: 240 });
}
function restoreDialogFocus(dialog) {
  const target = focusBeforeDialog.get(dialog);
  if (target?.isConnected && target.getClientRects().length && !target.closest('[hidden]')) target.focus?.({ preventScroll: true });
}
function closeDialog(id) {
  const dialog = $(id);
  if (dialog.open) { dialog.close(); motion.cancelWithin(dialog); restoreDialogFocus(dialog); }
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog.id); });
  dialog.addEventListener('close', () => {
    motion.cancelWithin(dialog);
    restoreDialogFocus(dialog);
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog(dialog.id);
  });
}
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.close)));

async function showPoster() {
  if (!displayed) return;
  const snapshot = displayed;
  const token = ++posterToken;
  poster = null; posterQuote = snapshot;
  $('poster-preview').setAttribute('aria-busy', 'true');
  $('poster-preview').replaceChildren(); $('poster-help').textContent = '正在製作日簽…'; $('poster-save').disabled = true;
  openDialog('poster-dialog', $('poster-button'));
  try {
    const image = await createPoster(snapshot);
    if (token !== posterToken || !$('poster-dialog').open) return;
    poster = image;
    const preview = new Image(); preview.alt = `第 ${snapshot.day} 天「${snapshot.title}」日簽預覽`;
    preview.src = image.dataUrl;
    $('poster-preview').append(preview);
    motion.reveal(preview, 'poster-ready');
    $('poster-help').textContent = '日簽已準備好。可透過系統分享，選擇保存的目的地。';
    $('poster-save').disabled = false;
  } catch { if (token === posterToken && $('poster-dialog').open) $('poster-help').textContent = '這次無法產生日簽，仍可使用文字分享。'; }
  finally { if (token === posterToken) $('poster-preview').removeAttribute('aria-busy'); }
}
function resultToast(result, image = false) {
  if (result.status === 'cancelled') return null;
  const messages = { copied: '已將這一頁複製到剪貼簿', shared: '已交給系統分享', opened: '已開啟系統分享，請選擇目的地', downloaded: '已開始下載日簽，請查看瀏覽器下載項目', unsupported: '此平台暫不支援圖片分享，請使用文字分享', error: image ? '無法分享日簽，請稍後再試或使用文字分享。' : '這次未能完成，請確認分享或剪貼簿權限後再試。' };
  const message = messages[result.status] ?? messages.error;
  toast(message);
  return message;
}
function askClear(historyOnly) {
  confirmAction = () => {
    persisted.history = [];
    if (!historyOnly) persisted.favorites = [];
    persist(); refreshFavorite();
    closeDialog('confirm-dialog');
    if (view === 'library') renderLibrary(tab);
    toast(historyOnly ? '已清除閱讀足跡' : '已清除收藏與閱讀足跡');
  };
  $('confirm-title').textContent = historyOnly ? '清除閱讀足跡？' : '清除閱讀資料？';
  $('confirm-copy').textContent = historyOnly ? '這將移除本機閱讀足跡，收藏仍會保留。此操作無法復原。' : '這將移除本機收藏與閱讀足跡，閱讀偏好仍會保留。此操作無法復原。';
  openDialog('confirm-dialog', $('clear-history'));
}

$('hold-button').addEventListener('pointerdown', beginHold);
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('hold-button').addEventListener(event, stopHold);
$('hold-button').addEventListener('click', event => { if (event.detail === 0) enterRitual(); });
$('skip-button').addEventListener('click', showSelection);
$('select-back').addEventListener('click', () => setView('focus'));
$('choose-again').addEventListener('click', showSelection);
$('empty-read').addEventListener('click', showSelection);
document.querySelectorAll('.number-choice').forEach((card, index) => card.addEventListener('click', () => chooseCard(index)));
$('random-button').addEventListener('click', dealCards);
$('previous-button').addEventListener('click', () => { if (displayed?.day > 1) openQuote(displayed.day - 1); });
$('next-button').addEventListener('click', () => { if (displayed?.day < TOTAL_DAYS) openQuote(displayed.day + 1); });
$('favorite-button').addEventListener('click', () => {
  if (!displayed) return;
  persisted.favorites = toggleFavorite(persisted.favorites, displayed.day); persist(); refreshFavorite();
  haptic(persisted.settings.haptics);
  motion.play($('favorite-button').querySelector('.icon'), [
    { transform: 'scale(1) rotate(0deg)' }, { transform: 'scale(1.28) rotate(-10deg)', offset: .45 }, { transform: 'scale(1) rotate(0deg)' },
  ], { name: 'favorite-feedback', duration: 300 });
  announce(persisted.favorites.includes(displayed.day) ? '已加入收藏' : '已移除收藏');
});
async function readingAction(button, action) {
  if (!displayed || button.disabled) return;
  const snapshot = displayed;
  button.disabled = true; button.setAttribute('aria-busy', 'true');
  try { resultToast(await action(snapshot)); }
  catch { resultToast({ status: 'error' }); }
  finally { button.disabled = false; button.removeAttribute('aria-busy'); }
}
$('copy-button').addEventListener('click', event => readingAction(event.currentTarget, snapshot => copyText(quoteText(snapshot))));
$('share-button').addEventListener('click', event => readingAction(event.currentTarget, shareText));
$('poster-button').addEventListener('click', showPoster);
$('poster-save').addEventListener('click', async () => {
  if (!poster || !posterQuote) return;
  const token = posterToken;
  const snapshot = poster;
  const day = posterQuote.day;
  $('poster-save').disabled = true;
  try {
    const result = await sharePoster(snapshot, day);
    if (token !== posterToken || !$('poster-dialog').open) return;
    const message = resultToast(result, true);
    if (message) $('poster-help').textContent = message;
  }
  catch { if (token === posterToken && $('poster-dialog').open) resultToast({ status: 'error' }, true); }
  finally { if (token === posterToken) $('poster-save').disabled = !poster; }
});
$('poster-dialog').addEventListener('close', () => { posterToken++; poster = null; posterQuote = null; $('poster-preview').replaceChildren(); $('poster-preview').removeAttribute('aria-busy'); });


$('sound-button').addEventListener('click', () => {
  persisted.settings.music = !persisted.settings.music;
  applySettings(); persist();
  if (persisted.settings.music) void music.play(); else { resumeMusic = false; music.pause(); }
});






$('clear-history').addEventListener('click', () => askClear(true));
$('library-prev').addEventListener('click', () => { libraryPage--; renderLibrary(tab, true); });
$('library-next').addEventListener('click', () => { libraryPage++; renderLibrary(tab, true); });

$('confirm-clear').addEventListener('click', () => confirmAction?.());
document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => {
  if (!quotes.length) return;
  if (button.dataset.tab === 'today') { tab = 'today'; setView(displayed ? 'reading' : 'focus', false); window.scrollTo({ top: 0, behavior: 'instant' }); }
  else renderLibrary(button.dataset.tab);
}));
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); tab = 'today'; setView(quotes.length ? 'focus' : view); });
document.addEventListener('visibilitychange', () => {
  document.documentElement.dataset.background = String(document.hidden);
  if (document.hidden) { motion.cancelAll(); stopHold(); cancelCardChoice(); audio.stop(); resumeMusic = resumeMusic || music.state.playing || music.state.loading; music.pause(); }
  else if (resumeMusic && persisted.settings.music) { resumeMusic = false; void music.play(); }
});
window.addEventListener('blur', () => { stopHold(); audio.stop(); });

window.addEventListener('popstate', event => {
  const openDialogEl = [...document.querySelectorAll('dialog[open]')].at(-1);
  if (openDialogEl) {
    closeDialog(openDialogEl.id);
    return;
  }
  const state = event.state;
  if (!state || state.view === 'focus') {
    tab = 'today';
    setView('focus', false, true);
  } else if (state.view === 'select') {
    tab = 'today';
    setView('select', false, true);
  } else if (state.view === 'reading' && state.day) {
    openQuote(state.day, false);
  } else if (state.view === 'library') {
    renderLibrary(state.tab || 'favorites');
  } else {
    tab = 'today';
    setView('focus', false, true);
  }
});

window.MiracleAppBack = () => {
  const open = [...document.querySelectorAll('dialog[open]')].at(-1);
  if (open) { closeDialog(open.id); return true; }
  if (view !== 'focus' && quotes.length) { tab = 'today'; setView('focus'); return true; }
  return false;
};
window.addEventListener('pagehide', () => { motion.cancelAll(); cancelCardChoice(); stopHold(); audio.stop(); resumeMusic = music.state.playing || music.state.loading || resumeMusic; music.pause(); });
window.addEventListener('pageshow', () => { if (resumeMusic && persisted.settings.music && !document.hidden) { resumeMusic = false; void music.play(); } });
const startBackground = event => {
  if (event.target.closest?.('#sound-button') || document.hidden) return;
  if (persisted.settings.music && !music.state.playing && !music.state.loading) void music.play();
  document.removeEventListener('pointerdown', startBackground);
  document.removeEventListener('keydown', startBackground);
};
document.addEventListener('pointerdown', startBackground);
document.addEventListener('keydown', startBackground);

async function initialize() {
  const token = ++initializationToken;
  quotes = [];
  $('retry-button').disabled = true;
  setView('loading', false);
  applySettings();
  $('today-date').textContent = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  $('today-date').dateTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
  try {
    const response = await fetch('data/quotes.json');
    if (!response.ok) throw new Error('Data unavailable');
    const data = await response.json(); validateQuotes(data);
    // Do not reveal a partially styled screen while the single bundled face is loading.
    const faces = await document.fonts.load('16px "教育部隸書"', '奇蹟之書陰陽靜心0123456789');
    if (!faces.length || faces.some(face => face.status !== 'loaded')) throw new Error('Bundled calligraphy font unavailable');
    await document.fonts.load('16px "正風毛筆"', '蹟');
    if (token !== initializationToken) return;
    quotes = data;
    const hash = window.location.hash;
    const dayMatch = hash.match(/#day=(\d+)/);
    if (dayMatch) {
      const targetDay = Number(dayMatch[1]);
      if (targetDay >= 1 && targetDay <= TOTAL_DAYS) {
        openQuote(targetDay, false);
        return;
      }
    }
    tab = 'today'; setView('focus', false);
  } catch (error) { if (token === initializationToken) { console.warn('Bundled quote data could not be loaded.', error); quotes = []; setView('error', false); } }
  finally {
    if (token === initializationToken) $('retry-button').disabled = false;
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
}
$('retry-button').addEventListener('click', initialize);
initialize();
