'use strict';

const TINGXIE_STANDARD_VOICE_VERSION = '20260809-1';
const TINGXIE_STANDARD_VOICE_POLICY_KEY = 'tingxie:standardMandarinVoice:v1';

// The Web Speech API exposes a voice's name/language/local-service status but
// not a portable gender field. These are deliberately conservative name hints
// for common female Mandarin voices; explicit "female" labels are also used
// when a browser provides them in the human-readable voice name.
const TINGXIE_FEMALE_VOICE_HINT = /female|woman|女声|女聲|Ting[- ]?Ting|Xiaoxiao|Huihui|Yaoyao|Mei[- ]?Jia|Xiaoyi|Xiaomeng|Xiaohan|Xiaomo|Xiaoqiu|Xiaorui|Xiaoshuang|Xiaoxuan|Xiaoyan|Xiaoyou|Xiaozhen/i;
const TINGXIE_MALE_VOICE_HINT = /male|man|男声|男聲|Kangkang|Yunxi|Yunjian|Yunyang|Yunze|Yunfeng|Daming/i;

function standardVoiceLanguage(voice) {
  return String(voice?.lang || '').replace('_', '-');
}

function standardVoiceName(voice) {
  return String(voice?.name || '');
}

function isSingaporeMandarinVoice(voice) {
  return /^zh-SG/i.test(standardVoiceLanguage(voice));
}

function isStandardMandarinVoice(voice) {
  const lang = standardVoiceLanguage(voice);
  if (/^zh-(HK|MO)/i.test(lang) || /^yue/i.test(lang)) return false;
  return /^zh-(SG|CN|TW)/i.test(lang) || /^cmn/i.test(lang);
}

function voiceLooksFemale(voice) {
  return TINGXIE_FEMALE_VOICE_HINT.test(standardVoiceName(voice));
}

function voiceLooksMale(voice) {
  return TINGXIE_MALE_VOICE_HINT.test(standardVoiceName(voice));
}

function standardFemaleVoiceScore(voice) {
  const lang = standardVoiceLanguage(voice);
  const name = standardVoiceName(voice);
  let score = 0;

  // Female is the primary requirement; Singapore Mandarin is the preferred
  // accent when the browser exposes a suitable female zh-SG voice.
  if (voiceLooksFemale(voice)) score += 240;
  if (voiceLooksMale(voice)) score -= 260;

  if (/^zh-SG/i.test(lang)) score += 190;
  else if (/^zh-CN/i.test(lang)) score += 135;
  else if (/^cmn/i.test(lang)) score += 120;
  else if (/^zh-TW/i.test(lang)) score += 75;

  if (voice?.localService) score += 45;
  if (voice?.default) score += 8;
  if (/Mandarin|普通话|普通話|Chinese/i.test(name)) score += 10;
  if (/online|cloud|network/i.test(name)) score -= 15;
  return score;
}

function standardFemaleVoiceLabel(voice, index) {
  const prefix = index === 0 ? '★ Recommended standard female · ' : '';
  const lang = standardVoiceLanguage(voice);
  const accent = isSingaporeMandarinVoice(voice) ? 'Singapore Mandarin' : 'Mandarin';
  const local = voice.localService ? 'device' : 'online';
  const female = voiceLooksFemale(voice) ? 'female' : 'female preferred';
  return `${prefix}${voice.name} · ${accent} (${lang}) · ${female} · ${local}`;
}

function populateStandardFemaleMandarinVoices() {
  const allVoices = window.speechSynthesis?.getVoices?.() || [];
  const mandarin = allVoices
    .filter(isStandardMandarinVoice)
    .sort((left, right) => standardFemaleVoiceScore(right) - standardFemaleVoiceScore(left));

  state.voices = mandarin.length
    ? mandarin
    : allVoices.slice().sort((left, right) => Number(Boolean(right.localService)) - Number(Boolean(left.localService)));

  const select = $('voiceSelect');
  if (!select) return;
  const settings = safeJsonParse(localStorage.getItem(STORAGE_KEYS.settings), {});
  const policyApplied = localStorage.getItem(TINGXIE_STANDARD_VOICE_POLICY_KEY) === TINGXIE_STANDARD_VOICE_VERSION;
  select.replaceChildren();

  if (!state.voices.length) {
    select.add(new Option('Default Mandarin voice', ''));
    localStorage.setItem(TINGXIE_STANDARD_VOICE_POLICY_KEY, TINGXIE_STANDARD_VOICE_VERSION);
    updateStandardVoiceNote(null);
    return;
  }

  state.voices.forEach((voice, index) => {
    const label = mandarin.length
      ? standardFemaleVoiceLabel(voice, index)
      : `${voice.name} · ${voice.lang} · ${voice.localService ? 'device' : 'online'}`;
    select.add(new Option(label, String(index)));
  });

  // On the first load of this policy, deliberately migrate away from the old
  // arbitrary saved Mandarin choice. After that, a parent's manual selection
  // remains respected as long as that voice still exists on the device.
  const savedIndex = policyApplied
    ? state.voices.findIndex(voice => voice.name === settings.voiceName && isStandardMandarinVoice(voice))
    : -1;
  select.value = String(savedIndex >= 0 ? savedIndex : 0);
  localStorage.setItem(TINGXIE_STANDARD_VOICE_POLICY_KEY, TINGXIE_STANDARD_VOICE_VERSION);
  saveSettings();
  updateStandardVoiceNote(state.voices[Number(select.value)] || null);
}

function updateStandardVoiceNote(voice) {
  const note = $('standardFemaleVoiceNote');
  if (!note) return;
  if (!voice) {
    note.textContent = 'Using the browser’s default Mandarin voice. A female Singapore Mandarin voice is preferred when available.';
    return;
  }
  if (isSingaporeMandarinVoice(voice) && voiceLooksFemale(voice)) {
    note.textContent = `Default: ${voice.name} — female Singapore Mandarin (${voice.lang}).`;
  } else if (voiceLooksFemale(voice)) {
    note.textContent = `Default: ${voice.name} — female Mandarin. This device does not expose a higher-priority female Singapore Mandarin voice.`;
  } else if (isSingaporeMandarinVoice(voice)) {
    note.textContent = `Default: ${voice.name} — Singapore Mandarin. The browser does not identify a known female voice for this locale.`;
  } else {
    note.textContent = `Default: ${voice.name} — Mandarin. Female Singapore Mandarin will be used automatically if this device provides it.`;
  }
}

function useStandardFemaleVoice(preview = true) {
  if (!state.voices.length) return;
  const select = $('voiceSelect');
  select.value = '0';
  localStorage.setItem(TINGXIE_STANDARD_VOICE_POLICY_KEY, TINGXIE_STANDARD_VOICE_VERSION);
  saveSettings();
  updateStandardVoiceNote(state.voices[0]);
  if (preview && typeof speakSelectedVoicePreview === 'function') speakSelectedVoicePreview();
}

function installStandardFemaleVoiceUi() {
  const controls = $('voiceQualityControls');
  const select = $('voiceSelect');
  if (!select) return;

  const oldRecommended = $('recommendedVoiceButton');
  if (oldRecommended) {
    const replacement = oldRecommended.cloneNode(true);
    replacement.id = 'recommendedVoiceButton';
    replacement.textContent = '★ Use standard female voice';
    oldRecommended.replaceWith(replacement);
    replacement.addEventListener('click', () => useStandardFemaleVoice(true));
  }

  if (controls && !$('standardFemaleVoiceNote')) {
    const note = document.createElement('p');
    note.id = 'standardFemaleVoiceNote';
    controls.appendChild(note);
  }

  select.addEventListener('change', () => {
    localStorage.setItem(TINGXIE_STANDARD_VOICE_POLICY_KEY, TINGXIE_STANDARD_VOICE_VERSION);
    updateStandardVoiceNote(state.voices[Number(select.value)] || null);
  });

  // Replace both the initial population function and any later voiceschanged
  // callback, then apply the standard voice immediately.
  populateVoices = populateStandardFemaleMandarinVoices;
  window.speechSynthesis.onvoiceschanged = populateStandardFemaleMandarinVoices;
  populateStandardFemaleMandarinVoices();
  document.documentElement.dataset.tingxieStandardFemaleVoice = 'true';
}

installStandardFemaleVoiceUi();

window.__tingxieStandardFemaleVoice = {
  version: TINGXIE_STANDARD_VOICE_VERSION,
  score: standardFemaleVoiceScore,
  isMandarin: isStandardMandarinVoice,
  isSingapore: isSingaporeMandarinVoice,
  looksFemale: voiceLooksFemale,
  selected: () => state.voices[Number($('voiceSelect')?.value)] || null,
  useDefault: useStandardFemaleVoice,
  repopulate: populateStandardFemaleMandarinVoices
};
