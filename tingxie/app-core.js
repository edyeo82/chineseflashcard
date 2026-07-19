'use strict';

const STORAGE_KEYS = {
  lastList: 'tingxie:lastList:v1',
  history: 'tingxie:history:v1',
  profile: 'tingxie:profile:v1',
  settings: 'tingxie:settings:v1'
};

const state = {
  sourceFile: null,
  answerFile: null,
  words: [],
  sessionWords: [],
  sessionMode: 'full',
  currentIndex: 0,
  voices: [],
  voiceEnabled: false,
  recognition: null,
  recognitionActive: false,
  isSpeaking: false,
  markRows: [],
  extraAnswers: [],
  mistakes: [],
  deferredInstallPrompt: null,
  toastTimer: null
};

const $ = id => document.getElementById(id);
const panels = {
  setup: $('setupPanel'),
  dictation: $('dictationPanel'),
  marking: $('markingPanel'),
  review: $('reviewPanel')
};

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function setPanel(name) {
  Object.entries(panels).forEach(([key, panel]) => panel.classList.toggle('active', key === name));
  document.querySelectorAll('.step').forEach(step => step.classList.toggle('active', step.dataset.step === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeChinese(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s\u3000]/g, '')
    .replace(/[，。、“”‘’：；！？,."'!?;:·•—_()（）\[\]【】]/g, '')
    .trim();
}

function removeHanSpaces(value) {
  let result = value;
  let previous;
  do {
    previous = result;
    result = result.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1');
  } while (result !== previous);
  return result;
}

function cleanOcrLine(value) {
  return removeHanSpaces(value)
    .replace(/^\s*(?:第?\s*\d+\s*[题題]?|[0-9一二三四五六七八九十]+)\s*[.、:：)）\]-]?\s*/, '')
    .replace(/[|｜]/g, '')
    .replace(/^[-—–•·*]+\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractItems(rawText) {
  if (!rawText) return [];
  const prepared = rawText
    .replace(/\r/g, '\n')
    .replace(/(?:^|\s)(\d{1,2})\s*[.、:：)）]\s*/g, '\n')
    .replace(/[；;]/g, '\n')
    .replace(/\t+/g, '\n');

  const ignored = /^(听写|聽寫|听写词语|聽寫詞語|姓名|日期|班级|班級|家长签名|家長簽名|订正|訂正|分数|分數)$/;
  const items = [];

  prepared.split('\n').forEach(rawLine => {
    const chunks = rawLine.split(/\s{3,}/);
    chunks.forEach(chunk => {
      const line = cleanOcrLine(chunk);
      if (!line || ignored.test(normalizeChinese(line))) return;
      if (!/[\u3400-\u9fffA-Za-z0-9]/.test(line)) return;
      items.push(line);
    });
  });

  return items;
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = normalizeChinese(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function updateWordCount() {
  const items = extractItems($('wordList').value);
  $('wordCount').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
  $('startDictationButton').disabled = items.length === 0;
}

function setImagePreview(file, imageElement) {
  if (!file) {
    imageElement.classList.add('hidden');
    imageElement.removeAttribute('src');
    return;
  }
  const reader = new FileReader();
  reader.onload = event => {
    imageElement.src = event.target.result;
    imageElement.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function setOcrProgress(prefix, payload) {
  const progressBlock = $(`${prefix}Progress`);
  const progressBar = $(`${prefix}ProgressBar`);
  const progressText = $(`${prefix}ProgressText`);
  progressBlock.classList.remove('hidden');

  const statusLabels = {
    'loading tesseract core': 'Loading text reader…',
    'initializing tesseract': 'Starting text reader…',
    'loading language traineddata': 'Loading Chinese language data…',
    'initializing api': 'Preparing recognition…',
    'recognizing text': 'Reading the photo…'
  };
  const percent = Math.max(0, Math.min(100, Math.round((payload.progress || 0) * 100)));
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${statusLabels[payload.status] || 'Processing…'} ${percent ? `${percent}%` : ''}`.trim();
}

async function runOcr(file, prefix) {
  if (!file) throw new Error('Choose a photo first.');
  if (!window.Tesseract) throw new Error('The OCR library did not load. Check your internet connection and reload.');

  const result = await window.Tesseract.recognize(file, 'chi_sim+eng', {
    logger: payload => setOcrProgress(prefix, payload)
  });
  $(`${prefix}ProgressBar`).style.width = '100%';
  $(`${prefix}ProgressText`).textContent = 'Finished reading the photo.';
  return result.data.text || '';
}

function populateVoices() {
  const allVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const mandarin = allVoices.filter(voice => /^zh/i.test(voice.lang));
  state.voices = mandarin.length ? mandarin : allVoices;

  const select = $('voiceSelect');
  const saved = safeJsonParse(localStorage.getItem(STORAGE_KEYS.settings), {});
  select.replaceChildren();

  if (!state.voices.length) {
    const option = new Option('Default Mandarin voice', '');
    select.add(option);
    return;
  }

  state.voices.forEach((voice, index) => {
    const localLabel = voice.localService ? 'device' : 'online';
    const option = new Option(`${voice.name} · ${voice.lang} · ${localLabel}`, String(index));
    select.add(option);
  });

  const preferredIndex = state.voices.findIndex(voice => voice.name === saved.voiceName);
  const singaporeIndex = state.voices.findIndex(voice => /^zh[-_]SG/i.test(voice.lang));
  const chinaIndex = state.voices.findIndex(voice => /^zh[-_]CN/i.test(voice.lang));
  select.value = String(preferredIndex >= 0 ? preferredIndex : singaporeIndex >= 0 ? singaporeIndex : Math.max(0, chinaIndex));
}

function saveSettings() {
  const selectedVoice = state.voices[Number($('voiceSelect').value)] || null;
  const settings = {
    voiceName: selectedVoice ? selectedVoice.name : '',
    rate: $('rateSelect').value,
    repeat: $('repeatSelect').value,
    commandLanguage: $('commandLanguage').value
  };
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

function loadSettings() {
  const settings = safeJsonParse(localStorage.getItem(STORAGE_KEYS.settings), {});
  if (settings.rate) $('rateSelect').value = settings.rate;
  if (settings.repeat) $('repeatSelect').value = settings.repeat;
  if (settings.commandLanguage) $('commandLanguage').value = settings.commandLanguage;
  $('profileName').value = localStorage.getItem(STORAGE_KEYS.profile) || '';
}

function stopRecognition() {
  if (!state.recognition) return;
  try { state.recognition.stop(); } catch { /* already stopped */ }
  state.recognitionActive = false;
}

function setVoiceStatus(type, message) {
  const box = $('voiceStatus');
  box.classList.remove('listening', 'speaking', 'error');
  if (type) box.classList.add(type);
  box.querySelector('span:last-child').textContent = message;
}

function speechSupported() {
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function recognitionSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function createRecognition() {
  if (!recognitionSupported()) return null;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Recognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;
  recognition.lang = $('commandLanguage').value;

  recognition.onstart = () => {
    state.recognitionActive = true;
    setVoiceStatus('listening', 'Listening for “next”…');
  };

  recognition.onresult = event => {
    const transcripts = [];
    for (let resultIndex = event.resultIndex; resultIndex < event.results.length; resultIndex += 1) {
      const result = event.results[resultIndex];
      for (let alt = 0; alt < result.length; alt += 1) transcripts.push(result[alt].transcript.trim());
    }
    const heard = transcripts[0] || '';
    $('heardCommand').textContent = heard ? `Heard: “${heard}”` : '';
    handleVoiceCommand(transcripts);
  };

  recognition.onerror = event => {
    state.recognitionActive = false;
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      state.voiceEnabled = false;
      $('voiceNextButton').textContent = '🎤 Enable voice “next”';
      setVoiceStatus('error', 'Microphone permission was not granted. Use the Next button or enable it in browser settings.');
      return;
    }
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      setVoiceStatus('error', `Voice command error: ${event.error}. You can still use the buttons.`);
    }
  };

  recognition.onend = () => {
    state.recognitionActive = false;
    if (state.voiceEnabled && !state.isSpeaking && panels.dictation.classList.contains('active')) {
      setTimeout(startListening, 450);
    }
  };

  return recognition;
}

function startListening() {
  if (!state.voiceEnabled || state.isSpeaking || !panels.dictation.classList.contains('active')) return;
  if (!recognitionSupported()) {
    state.voiceEnabled = false;
    setVoiceStatus('error', 'This browser does not support voice commands. Use the Next button.');
    return;
  }
  if (state.recognitionActive) return;

  state.recognition = createRecognition();
  try {
    state.recognition.start();
  } catch {
    setVoiceStatus('error', 'Voice listening could not restart. Tap the microphone button again.');
  }
}

function handleVoiceCommand(transcripts) {
  const normalized = transcripts.map(value => value.toLowerCase().replace(/[.,!?，。！？]/g, '').trim());
  const matchesAny = commands => normalized.some(text => commands.some(command => text === command || text.includes(` ${command}`) || text.startsWith(`${command} `)));

  if (matchesAny(['next', 'skip', 'continue', '下一个', '下一個', '下一题', '下一題', '继续', '繼續'])) {
    nextItem();
  } else if (matchesAny(['again', 'repeat', 'say again', '再说一次', '再說一次', '重复', '重複'])) {
    speakCurrentItem();
  } else if (matchesAny(['previous', 'back', 'go back', '上一个', '上一個', '上一题', '上一題'])) {
    previousItem();
  } else if (matchesAny(['stop', 'pause', '停止', '暂停', '暫停'])) {
    toggleVoiceNext(false);
  } else {
    setVoiceStatus('listening', 'Command not recognised. Say “next,” “again,” “previous,” or “stop.”');
  }
}
