'use strict';

const TINGXIE_WORD_CHECKLIST_VERSION = '20260802-2';
const TINGXIE_SKIPPED_WORDS_KEY = 'tingxie:skippedWords:v1';

const legacyChecklistUpdateWordCount = updateWordCount;
const legacyChecklistSaveCurrentList = saveCurrentList;

let skippedWordStore = loadSkippedWordStore();
let checklistRenderTimer = null;

function loadSkippedWordStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TINGXIE_SKIPPED_WORDS_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveSkippedWordStore() {
  localStorage.setItem(TINGXIE_SKIPPED_WORDS_KEY, JSON.stringify(skippedWordStore));
}

function currentMemoryContext() {
  const profile = window.__tingxieProfileMemory?.activeProfile?.();
  if (!profile?.id) return 'legacy:default';
  return `${profile.id}:${profile.activeListId || 'draft'}`;
}

function wordStorageKey(word) {
  return normalizeChinese(word);
}

function currentAllWords() {
  return uniqueItems(extractItems($('wordList')?.value || ''));
}

function currentSkippedSet(context = currentMemoryContext()) {
  const validKeys = new Set(currentAllWords().map(wordStorageKey));
  return new Set((skippedWordStore[context] || []).filter(key => validKeys.has(key)));
}

function persistSkippedSet(set, context = currentMemoryContext()) {
  const keys = [...set].filter(Boolean);
  if (keys.length) skippedWordStore[context] = keys;
  else delete skippedWordStore[context];
  saveSkippedWordStore();
}

function transferSkippedContext(beforeContext, afterContext, skippedSet) {
  if (!beforeContext || !afterContext || beforeContext === afterContext) return;
  if (skippedSet.size) {
    const existing = new Set(skippedWordStore[afterContext] || []);
    skippedSet.forEach(key => existing.add(key));
    skippedWordStore[afterContext] = [...existing];
  }
  delete skippedWordStore[beforeContext];
  saveSkippedWordStore();
}

function activeReadingWords() {
  const skipped = currentSkippedSet();
  return currentAllWords().filter(word => !skipped.has(wordStorageKey(word)));
}

function updateChecklistSummary() {
  const all = currentAllWords();
  const skipped = currentSkippedSet();
  const activeCount = all.filter(word => !skipped.has(wordStorageKey(word))).length;
  const summary = $('wordChecklistSummary');
  if (summary) summary.textContent = `${activeCount} active · ${skipped.size} skipped`;
  const wordCount = $('wordCount');
  if (wordCount) wordCount.textContent = `${activeCount} active · ${skipped.size} skipped`;
  const start = $('startDictationButton');
  if (start) start.disabled = activeCount === 0;
}

function renderWordChecklist() {
  const list = $('wordChecklistRows');
  if (!list) return;
  const words = currentAllWords();
  const skipped = currentSkippedSet();
  list.replaceChildren();

  if (!words.length) {
    const empty = document.createElement('p');
    empty.className = 'word-checklist-empty';
    empty.textContent = 'Add words above and they will appear here.';
    list.append(empty);
    updateChecklistSummary();
    return;
  }

  words.forEach((word, index) => {
    const key = wordStorageKey(word);
    const row = document.createElement('label');
    row.className = `word-checklist-row${skipped.has(key) ? ' skipped' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = skipped.has(key);
    checkbox.dataset.wordKey = key;
    checkbox.setAttribute('aria-label', `Skip ${word}`);

    const number = document.createElement('span');
    number.className = 'word-checklist-number';
    number.textContent = String(index + 1);

    const text = document.createElement('span');
    text.className = 'word-checklist-text';
    text.textContent = word;

    const status = document.createElement('span');
    status.className = 'word-checklist-status';
    status.textContent = skipped.has(key) ? 'Skipped' : 'Read';

    checkbox.addEventListener('change', () => {
      const next = currentSkippedSet();
      if (checkbox.checked) next.add(key);
      else next.delete(key);
      persistSkippedSet(next);
      row.classList.toggle('skipped', checkbox.checked);
      status.textContent = checkbox.checked ? 'Skipped' : 'Read';
      updateChecklistSummary();
      showToast(checkbox.checked ? `“${word}” will be skipped.` : `“${word}” is enabled again.`);
    });

    row.append(checkbox, number, text, status);
    list.append(row);
  });

  updateChecklistSummary();
}

function scheduleChecklistRender() {
  clearTimeout(checklistRenderTimer);
  checklistRenderTimer = setTimeout(renderWordChecklist, 30);
}

function setAllWordsSkipped(shouldSkip) {
  const all = currentAllWords();
  const next = shouldSkip ? new Set(all.map(wordStorageKey)) : new Set();
  persistSkippedSet(next);
  renderWordChecklist();
  showToast(shouldSkip ? 'All words are skipped. Tick again to enable them.' : 'All words are enabled.');
}

function installWordChecklist() {
  const wordList = $('wordList');
  if (!wordList || $('wordChecklistBox')) return;

  const box = document.createElement('section');
  box.id = 'wordChecklistBox';
  box.className = 'word-checklist-box';
  box.setAttribute('aria-label', 'Choose which words to read');
  box.innerHTML = `
    <div class="word-checklist-heading">
      <div>
        <strong>Choose words for this reading</strong>
        <p>Tick a word to skip it. It remains saved and can be unticked later.</p>
      </div>
      <span id="wordChecklistSummary" class="pill">0 active · 0 skipped</span>
    </div>
    <div class="word-checklist-actions">
      <button id="enableAllWordsButton" class="small-button" type="button">Enable all</button>
      <button id="skipAllWordsButton" class="small-button" type="button">Skip all</button>
    </div>
    <div id="wordChecklistRows" class="word-checklist-rows"></div>
  `;
  wordList.insertAdjacentElement('afterend', box);

  $('enableAllWordsButton').addEventListener('click', () => setAllWordsSkipped(false));
  $('skipAllWordsButton').addEventListener('click', () => setAllWordsSkipped(true));
  wordList.addEventListener('input', scheduleChecklistRender);

  ['memoryProfileSelect', 'memoryListSelect'].forEach(id => {
    $(id)?.addEventListener('change', () => setTimeout(renderWordChecklist, 30));
  });
  ['newMemoryListButton', 'deleteListButton', 'deleteProfileButton', 'loadLastButton'].forEach(id => {
    $(id)?.addEventListener('click', () => setTimeout(renderWordChecklist, 50));
  });

  const style = document.createElement('style');
  style.dataset.tingxieWordChecklist = 'true';
  style.textContent = `
    .word-checklist-box {
      display: grid;
      gap: 12px;
      margin: 12px 0 10px;
      padding: 14px;
      border: 1px solid rgba(35, 118, 112, .22);
      border-radius: 16px;
      background: rgba(248, 253, 252, .92);
    }
    .word-checklist-heading { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .word-checklist-heading strong { display: block; margin-bottom: 3px; }
    .word-checklist-heading p { margin: 0; color: var(--muted); font-size: .82rem; line-height: 1.4; }
    .word-checklist-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .word-checklist-rows { display: grid; gap: 7px; max-height: 360px; overflow: auto; padding-right: 2px; }
    .word-checklist-row {
      display: grid;
      grid-template-columns: auto 28px minmax(0, 1fr) auto;
      gap: 9px;
      align-items: center;
      min-height: 44px;
      padding: 8px 10px;
      border: 1px solid rgba(35, 118, 112, .16);
      border-radius: 12px;
      background: white;
      cursor: pointer;
      transition: opacity .16s ease, background .16s ease;
    }
    .word-checklist-row input { width: 21px; height: 21px; margin: 0; accent-color: var(--primary); }
    .word-checklist-number { color: var(--muted); font-size: .8rem; font-weight: 800; text-align: center; }
    .word-checklist-text { font-size: 1rem; font-weight: 760; overflow-wrap: anywhere; }
    .word-checklist-status { color: var(--primary-dark); font-size: .74rem; font-weight: 850; }
    .word-checklist-row.skipped { opacity: .5; background: #f0f1ef; }
    .word-checklist-row.skipped .word-checklist-text { text-decoration: line-through; text-decoration-thickness: 1px; }
    .word-checklist-row.skipped .word-checklist-status { color: var(--muted); }
    .word-checklist-empty { margin: 0; padding: 10px; color: var(--muted); text-align: center; }
    @media (max-width: 520px) {
      .word-checklist-heading { display: grid; }
      .word-checklist-row { grid-template-columns: auto 24px minmax(0, 1fr); }
      .word-checklist-status { grid-column: 3; }
    }
  `;
  document.head.appendChild(style);
  renderWordChecklist();
}

saveCurrentList = function saveListWithSkippedWords(words) {
  const beforeContext = currentMemoryContext();
  const beforeSkipped = currentSkippedSet(beforeContext);
  const result = legacyChecklistSaveCurrentList(words);
  const afterContext = currentMemoryContext();
  transferSkippedContext(beforeContext, afterContext, beforeSkipped);
  setTimeout(renderWordChecklist, 20);
  return result;
};

updateWordCount = function updateWordCountWithChecklist() {
  legacyChecklistUpdateWordCount();
  scheduleChecklistRender();
};

function installChecklistStartButton() {
  const original = $('startDictationButton');
  if (!original || original.dataset.checklistStart === 'true') return;
  const replacement = original.cloneNode(true);
  replacement.dataset.checklistStart = 'true';
  original.replaceWith(replacement);

  replacement.addEventListener('click', () => {
    const allWords = currentAllWords();
    const readingWords = activeReadingWords();
    if (!allWords.length) return;
    if (!readingWords.length) {
      showToast('All words are skipped. Untick at least one word first.');
      return;
    }
    saveCurrentList(allWords);
    beginDictation(readingWords, 'full');
  });
  updateChecklistSummary();
}

function mandarinVoiceScore(voice) {
  const lang = String(voice?.lang || '').replace('_', '-');
  const name = String(voice?.name || '');
  let score = 0;
  if (/^zh-CN/i.test(lang)) score += 100;
  else if (/^zh-SG/i.test(lang)) score += 95;
  else if (/^zh-TW/i.test(lang)) score += 75;
  else if (/^cmn/i.test(lang)) score += 70;
  if (voice?.localService) score += 30;
  if (/Ting[- ]?Ting|Xiaoxiao|Huihui|Mei[- ]?Jia|Mandarin|普通话|普通話/i.test(name)) score += 12;
  if (/online|cloud|network/i.test(name)) score -= 12;
  return score;
}

function isMandarinVoice(voice) {
  const lang = String(voice?.lang || '').replace('_', '-');
  if (/^zh-(HK|MO)/i.test(lang) || /^yue/i.test(lang)) return false;
  return /^zh-(CN|SG|TW)/i.test(lang) || /^cmn/i.test(lang);
}

function populateStableMandarinVoices() {
  const allVoices = window.speechSynthesis?.getVoices?.() || [];
  const mandarin = allVoices.filter(isMandarinVoice).sort((left, right) => mandarinVoiceScore(right) - mandarinVoiceScore(left));
  state.voices = mandarin.length ? mandarin : allVoices.slice().sort((left, right) => Number(Boolean(right.localService)) - Number(Boolean(left.localService)));

  const select = $('voiceSelect');
  if (!select) return;
  const settings = safeJsonParse(localStorage.getItem(STORAGE_KEYS.settings), {});
  select.replaceChildren();

  if (!state.voices.length) {
    select.add(new Option('Default Mandarin voice', ''));
    return;
  }

  state.voices.forEach((voice, index) => {
    const recommended = index === 0 && mandarin.length ? '★ Recommended · ' : '';
    const localLabel = voice.localService ? 'device' : 'online';
    select.add(new Option(`${recommended}${voice.name} · ${voice.lang} · ${localLabel}`, String(index)));
  });

  const savedIndex = state.voices.findIndex(voice => voice.name === settings.voiceName && isMandarinVoice(voice));
  select.value = String(savedIndex >= 0 ? savedIndex : 0);
  saveSettings();
}

function speakSelectedVoicePreview() {
  if (!speechSupported()) {
    showToast('Speech is unavailable in this browser.');
    return;
  }
  const sample = activeReadingWords()[0] || '老师，请听写。';
  const voice = state.voices[Number($('voiceSelect').value)] || null;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(sample);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || 'zh-CN';
  utterance.rate = Number($('rateSelect').value) || 0.48;
  utterance.pitch = 1;
  utterance.volume = 1;
  utterance.onstart = () => showToast(`Testing ${voice?.name || 'the default Mandarin voice'}…`);
  utterance.onerror = () => showToast('That voice could not be played. Try another Mandarin voice.');
  window.speechSynthesis.speak(utterance);
}

function chooseRecommendedVoice() {
  if (!state.voices.length) return;
  $('voiceSelect').value = '0';
  saveSettings();
  speakSelectedVoicePreview();
}

function installVoiceQualityControls() {
  const select = $('voiceSelect');
  if (!select || $('voiceQualityControls')) return;
  const controls = document.createElement('div');
  controls.id = 'voiceQualityControls';
  controls.className = 'voice-quality-controls';
  controls.innerHTML = `
    <button id="testVoiceButton" class="small-button" type="button">🔊 Test selected voice</button>
    <button id="recommendedVoiceButton" class="small-button" type="button">★ Use recommended Mandarin</button>
    <p>Recommended mode prefers a local Mandarin voice and avoids Cantonese voices. Exact pronunciation still depends on voices installed on this device.</p>
  `;
  select.insertAdjacentElement('afterend', controls);
  $('testVoiceButton').addEventListener('click', speakSelectedVoicePreview);
  $('recommendedVoiceButton').addEventListener('click', chooseRecommendedVoice);

  const style = document.createElement('style');
  style.dataset.tingxieVoiceQuality = 'true';
  style.textContent = `
    .voice-quality-controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .voice-quality-controls p { flex: 1 1 100%; margin: 0; color: var(--muted); font-size: .78rem; line-height: 1.4; }
  `;
  document.head.appendChild(style);

  populateVoices = populateStableMandarinVoices;
  window.speechSynthesis.onvoiceschanged = populateStableMandarinVoices;
  populateStableMandarinVoices();
}

function installPersistentHubButton() {
  const link = $('learningHubLink');
  if (!link) return;
  link.textContent = '🏠 Learning apps';
  link.setAttribute('aria-label', 'Return to all learning apps');
  document.body.appendChild(link);

  const style = document.createElement('style');
  style.dataset.tingxiePersistentHub = 'true';
  style.textContent = `
    #learningHubLink {
      position: fixed;
      right: 14px;
      bottom: calc(14px + env(safe-area-inset-bottom));
      z-index: 1200;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      margin: 0;
      padding: 10px 14px;
      border: 1px solid rgba(35, 118, 112, .28);
      border-radius: 999px;
      background: rgba(255, 255, 255, .96);
      box-shadow: 0 8px 24px rgba(31, 61, 58, .18);
      color: var(--primary-dark);
      font-size: .82rem;
      font-weight: 850;
      text-decoration: none;
      backdrop-filter: blur(10px);
    }
    #learningHubLink:hover, #learningHubLink:focus-visible { text-decoration: none; transform: translateY(-1px); }
  `;
  document.head.appendChild(style);
}

installWordChecklist();
installChecklistStartButton();
installVoiceQualityControls();
installPersistentHubButton();

document.documentElement.dataset.tingxieWordChecklist = 'true';

window.__tingxieWordChecklist = {
  version: TINGXIE_WORD_CHECKLIST_VERSION,
  activeWords: activeReadingWords,
  allWords: currentAllWords,
  skipped: () => [...currentSkippedSet()],
  render: renderWordChecklist,
  context: currentMemoryContext
};
