'use strict';

const TINGXIE_PASTE_VERSION = 'tingxie-paste-v1';

function stripPastedMarkdown(line) {
  return String(line || '')
    .replace(/^\s*>+\s*/, '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*[-+*•]\s+/, '')
    .replace(/^\s*(?:\*\*|__)?\d{1,2}\s*[.、:：)）-]\s*(?:\*\*|__)?/, '')
    .replace(/[`*_~]/g, '')
    .trim();
}

function isPastedListMetadata(line) {
  const compact = String(line || '').replace(/[\s\u3000]/g, '');
  if (!compact) return true;
  if (/^(?:听写|聽寫)(?:[（(][^）)]*[）)])?(?:第[一二三四五六七八九十百\d]+课)?(?:\d+月\d+日)?$/.test(compact)) return true;
  if (/^(?:第[一二三四五六七八九十百\d]+课|日期[:：]?.*|姓名[:：]?.*|班级[:：]?.*|班級[:：]?.*|答案[:：]?|词语[:：]?|詞語[:：]?|句子[:：]?)$/.test(compact)) return true;
  return false;
}

function splitPastedAnswerLine(line) {
  const prepared = String(line || '')
    .replace(/(?:^|\s)(\d{1,2})\s*[.、:：)）-]\s*/g, '\n')
    .replace(/[；;]/g, '\n')
    .replace(/\t+/g, '\n');
  return prepared
    .split('\n')
    .flatMap(part => part.split(/\s{3,}/))
    .map(stripPastedMarkdown)
    .filter(Boolean);
}

function cleanPastedTingXieList(rawText) {
  if (!rawText) return [];
  const candidates = [];
  String(rawText).replace(/\r/g, '\n').split('\n').forEach(rawLine => {
    if (/^\s*```/.test(rawLine)) return;
    const line = stripPastedMarkdown(rawLine);
    if (!line || !/[\u3400-\u9fff]/.test(line)) return;

    // Explanatory prose copied from ChatGPT may contain both English and a
    // Chinese worksheet title. Actual spelling answers in this app are Chinese.
    if (/[A-Za-z]/.test(line)) return;
    if (isPastedListMetadata(line)) return;

    // Do not use the OCR line cleaner here: it intentionally strips Chinese
    // numerals used as worksheet numbering, which would corrupt real answers
    // such as 五颗星 and 一座山.
    splitPastedAnswerLine(line).forEach(cleaned => {
      if (!/[\u3400-\u9fff]/.test(cleaned)) return;
      if (isPastedListMetadata(cleaned)) return;
      candidates.push(cleaned);
    });
  });
  return uniqueItems(candidates);
}

function setPastedList(items, sourceLabel = 'Pasted') {
  const wordList = $('wordList');
  wordList.value = items.join('\n');
  updateWordCount();
  wordList.focus({ preventScroll: true });
  wordList.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const status = $('pasteListStatus');
  if (status) status.textContent = `${sourceLabel} ${items.length} item${items.length === 1 ? '' : 's'}. Check the list, then tap Start 听写.`;
  showToast(`${sourceLabel} ${items.length} item${items.length === 1 ? '' : 's'}.`);
}

async function pasteTingXieListFromClipboard() {
  const status = $('pasteListStatus');
  try {
    if (!navigator.clipboard?.readText) throw new Error('clipboard-unavailable');
    const text = await navigator.clipboard.readText();
    const items = cleanPastedTingXieList(text);
    if (!items.length) {
      if (status) status.textContent = 'No Chinese list was found on the clipboard. Copy the list from ChatGPT and try again.';
      showToast('No Chinese list found on the clipboard.');
      return;
    }
    setPastedList(items);
  } catch (error) {
    const wordList = $('wordList');
    wordList.focus();
    if (status) status.textContent = 'Automatic paste was blocked. Long-press inside the list box and choose Paste.';
    showToast('Long-press inside the list box and choose Paste.');
  }
}

function installPasteListUi() {
  const wordList = $('wordList');
  const fieldRow = wordList?.closest('.card')?.querySelector('.field-row');
  if (!wordList || !fieldRow || $('pasteListButton')) return;

  const style = document.createElement('style');
  style.dataset.tingxiePasteStyle = 'true';
  style.textContent = `
    .ai-paste-box {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      margin-bottom: 16px;
      padding: 15px;
      border: 1px solid rgba(120, 85, 217, .28);
      border-radius: 16px;
      background: linear-gradient(135deg, var(--soft-purple), #fffdfa);
    }
    .ai-paste-copy { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
    .ai-paste-icon { font-size: 1.45rem; line-height: 1.2; }
    .ai-paste-copy strong { display: block; margin-bottom: 3px; }
    .ai-paste-copy p { margin: 0; color: var(--muted); font-size: .82rem; line-height: 1.4; }
    .ai-paste-box .primary-button { white-space: nowrap; }
    #pasteListStatus { grid-column: 1 / -1; margin: -4px 0 0; }
    @media (max-width: 680px) {
      .ai-paste-box { grid-template-columns: 1fr; }
      .ai-paste-box .primary-button { width: 100%; }
      #pasteListStatus { grid-column: 1; }
    }
  `;
  document.head.appendChild(style);

  const box = document.createElement('section');
  box.className = 'ai-paste-box';
  box.setAttribute('aria-label', 'Paste a list read by ChatGPT');
  box.innerHTML = `
    <div class="ai-paste-copy">
      <span class="ai-paste-icon" aria-hidden="true">✨</span>
      <div>
        <strong>Use ChatGPT AI Vision</strong>
        <p>Ask ChatGPT to read the photo, copy its list, then paste it here. Numbering and Markdown are removed automatically.</p>
      </div>
    </div>
    <button id="pasteListButton" class="primary-button" type="button">📋 Paste copied list</button>
    <p id="pasteListStatus" class="help-text" role="status" aria-live="polite">You can also tap inside the list box below and paste manually.</p>
  `;
  fieldRow.before(box);

  $('pasteListButton').addEventListener('click', pasteTingXieListFromClipboard);
  wordList.addEventListener('paste', event => {
    if (wordList.value.trim()) return;
    const text = event.clipboardData?.getData('text/plain');
    const items = cleanPastedTingXieList(text);
    if (!items.length) return;
    event.preventDefault();
    setPastedList(items, 'Added');
  });

  document.documentElement.dataset.tingxiePasteReady = 'true';
}

installPasteListUi();

window.__tingxiePasteList = {
  version: TINGXIE_PASTE_VERSION,
  clean: cleanPastedTingXieList,
  apply: text => {
    const items = cleanPastedTingXieList(text);
    if (items.length) setPastedList(items);
    return items;
  }
};
