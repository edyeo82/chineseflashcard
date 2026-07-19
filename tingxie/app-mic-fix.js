'use strict';

const TINGXIE_MIC_FIX_VERSION = '20260720-3';
let voiceListeningTimer = null;
let voiceListeningWatchdog = null;
let voiceWaitStartedAt = 0;
const MAX_SPEECH_WAIT_MS = 3500;

function isChromeOnIOS() {
  return /CriOS/i.test(navigator.userAgent || '');
}

function microphoneSettingsHint() {
  if (isChromeOnIOS()) {
    return 'On iPhone, open Settings → Chrome and turn on both Microphone and Speech Recognition. Then fully close and reopen Chrome.';
  }
  return 'Allow microphone access for this site in your browser settings, then reload the page.';
}

function stopVoiceListeningTimers() {
  clearTimeout(voiceListeningTimer);
  voiceListeningTimer = null;
  clearInterval(voiceListeningWatchdog);
  voiceListeningWatchdog = null;
  voiceWaitStartedAt = 0;
}

function resetVoiceNextButton() {
  state.voiceEnabled = false;
  state.microphoneCheckPending = false;
  stopVoiceListeningTimers();
  const button = $('voiceNextButton');
  if (button) {
    button.disabled = false;
    button.textContent = '🎤 Enable voice “next”';
  }
}

async function verifyMicrophoneAccess() {
  if (!window.isSecureContext) {
    return { ok: false, code: 'insecure-context' };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, code: 'unsupported' };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    stream.getTracks().forEach(track => track.stop());
    return { ok: true, code: 'granted' };
  } catch (error) {
    return {
      ok: false,
      code: error?.name || 'unknown',
      message: error?.message || ''
    };
  }
}

function microphoneFailureMessage(result) {
  switch (result.code) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return `This site was not allowed to use the microphone. ${microphoneSettingsHint()}`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found. Disconnect and reconnect any headset, then try again.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The microphone is busy or unavailable. Close other apps using it, then try again.';
    case 'AbortError':
      return 'Microphone access was interrupted. Tap the microphone button and try again.';
    case 'insecure-context':
      return 'Microphone access requires the secure HTTPS version of this page.';
    case 'unsupported':
      return 'This browser cannot directly test microphone access. Try the latest Chrome or Safari.';
    default:
      return `The microphone could not be opened${result.message ? `: ${result.message}` : '.'} ${microphoneSettingsHint()}`;
  }
}

function createDiagnosticRecognition() {
  if (!recognitionSupported()) return null;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Recognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;
  recognition.lang = $('commandLanguage').value;

  recognition.onstart = () => {
    state.recognitionActive = true;
    voiceWaitStartedAt = 0;
    setVoiceStatus('listening', 'Listening for “next”…');
  };

  recognition.onaudiostart = () => {
    setVoiceStatus('listening', 'Microphone is active. Say “next,” “again,” “previous,” or “stop.”');
  };

  recognition.onresult = event => {
    const transcripts = [];
    for (let resultIndex = event.resultIndex; resultIndex < event.results.length; resultIndex += 1) {
      const result = event.results[resultIndex];
      for (let alternative = 0; alternative < result.length; alternative += 1) {
        transcripts.push(result[alternative].transcript.trim());
      }
    }
    const heard = transcripts[0] || '';
    $('heardCommand').textContent = heard ? `Heard: “${heard}”` : '';
    handleVoiceCommand(transcripts);
  };

  recognition.onerror = event => {
    state.recognitionActive = false;
    const error = event.error || 'unknown';

    if (error === 'not-allowed') {
      resetVoiceNextButton();
      const message = isChromeOnIOS()
        ? 'The microphone test passed, but Chrome denied speech recognition. Open Settings → Chrome → Speech Recognition, turn it on, then fully close and reopen Chrome.'
        : `Speech recognition permission was denied. ${microphoneSettingsHint()}`;
      setVoiceStatus('error', message);
      return;
    }

    if (error === 'service-not-allowed') {
      resetVoiceNextButton();
      const message = isChromeOnIOS()
        ? 'Chrome’s speech-recognition service is disabled or unavailable. Open Settings → Chrome → Speech Recognition, turn it on, then fully close and reopen Chrome.'
        : 'The browser’s speech-recognition service is disabled or unavailable. You can still use the Next button.';
      setVoiceStatus('error', message);
      return;
    }

    if (error === 'audio-capture') {
      resetVoiceNextButton();
      setVoiceStatus('error', 'Chrome could not capture microphone audio. Close other apps using the microphone and try again.');
      return;
    }

    if (error === 'network') {
      resetVoiceNextButton();
      setVoiceStatus('error', 'Speech recognition could not reach its online service. Check the internet connection and try again.');
      return;
    }

    if (error !== 'no-speech' && error !== 'aborted') {
      setVoiceStatus('error', `Voice command error: ${error}. You can still use the buttons.`);
    }
  };

  recognition.onend = () => {
    state.recognitionActive = false;
    if (state.voiceEnabled && panels.dictation.classList.contains('active')) {
      voiceListeningTimer = setTimeout(scheduleDiagnosticListening, 450);
    }
  };

  return recognition;
}

function startDiagnosticListening() {
  if (!state.voiceEnabled || state.isSpeaking || !panels.dictation.classList.contains('active')) return false;
  if (!recognitionSupported()) {
    resetVoiceNextButton();
    setVoiceStatus('error', 'This browser does not support web voice commands. Use the Next button.');
    return false;
  }
  if (state.recognitionActive) return true;

  state.recognition = createDiagnosticRecognition();
  try {
    state.recognition.start();
    return true;
  } catch (error) {
    state.recognitionActive = false;
    setVoiceStatus('error', `Voice listening could not start${error?.message ? `: ${error.message}` : '.'} Tap the microphone button again.`);
    return false;
  }
}

function scheduleDiagnosticListening() {
  clearTimeout(voiceListeningTimer);
  voiceListeningTimer = null;
  if (!state.voiceEnabled || !panels.dictation.classList.contains('active')) {
    voiceWaitStartedAt = 0;
    return;
  }

  if (state.isSpeaking) {
    if (!voiceWaitStartedAt) voiceWaitStartedAt = Date.now();
    const waited = Date.now() - voiceWaitStartedAt;
    if (waited < MAX_SPEECH_WAIT_MS) {
      setVoiceStatus('speaking', 'Waiting for the spoken word to finish before listening…');
      voiceListeningTimer = setTimeout(scheduleDiagnosticListening, 120);
      return;
    }

    // Some iPhone Chrome builds occasionally fail to deliver the speech
    // synthesis onend event. The word is short, so after a bounded wait we
    // cancel the stale playback state and continue with recognition.
    window.speechSynthesis?.cancel();
    state.isSpeaking = false;
    setVoiceStatus('listening', 'Speech playback finished. Starting the microphone…');
  }

  voiceWaitStartedAt = 0;
  startDiagnosticListening();
}

function startVoiceListeningWatchdog() {
  clearInterval(voiceListeningWatchdog);
  voiceListeningWatchdog = setInterval(() => {
    if (!state.voiceEnabled || !panels.dictation.classList.contains('active')) return;
    if (!state.isSpeaking && !state.recognitionActive) scheduleDiagnosticListening();
  }, 700);
}

// Best-effort replacement for calls made by the original modules. The local
// functions above are also called directly, so the diagnostic flow does not
// depend on cross-script function rebinding.
try {
  createRecognition = createDiagnosticRecognition;
  startListening = startDiagnosticListening;
} catch {
  // Older WebKit builds may keep the original global function bindings.
}

toggleVoiceNext = async function toggleVoiceNextWithMicrophoneCheck(forceValue) {
  const nextValue = typeof forceValue === 'boolean' ? forceValue : !state.voiceEnabled;

  if (!nextValue) {
    state.voiceEnabled = false;
    state.microphoneCheckPending = false;
    stopVoiceListeningTimers();
    $('voiceNextButton').disabled = false;
    $('voiceNextButton').textContent = '🎤 Enable voice “next”';
    stopRecognition();
    setVoiceStatus('', 'Voice “next” is paused. Use the buttons or enable it again.');
    return;
  }

  if (state.microphoneCheckPending) return;
  if (!recognitionSupported()) {
    resetVoiceNextButton();
    setVoiceStatus('error', 'Voice commands are unavailable in this browser. Use the Next button.');
    return;
  }

  state.microphoneCheckPending = true;
  const button = $('voiceNextButton');
  button.disabled = true;
  button.textContent = 'Checking microphone…';
  setVoiceStatus('listening', 'Checking this site’s microphone access…');

  const microphone = await verifyMicrophoneAccess();
  state.microphoneCheckPending = false;

  if (!microphone.ok) {
    resetVoiceNextButton();
    setVoiceStatus('error', microphoneFailureMessage(microphone));
    return;
  }

  state.voiceEnabled = true;
  voiceWaitStartedAt = Date.now();
  button.disabled = false;
  button.textContent = '⏸ Stop voice “next”';
  setVoiceStatus('listening', 'Microphone access confirmed. Waiting for the spoken word to finish…');
  startVoiceListeningWatchdog();
  scheduleDiagnosticListening();
};

window.__tingxieMicrophoneDiagnostics = {
  version: TINGXIE_MIC_FIX_VERSION,
  verifyMicrophoneAccess,
  microphoneFailureMessage,
  isChromeOnIOS,
  scheduleDiagnosticListening,
  getState: () => ({
    voiceEnabled: state.voiceEnabled,
    recognitionActive: state.recognitionActive,
    isSpeaking: state.isSpeaking,
    voiceWaitStartedAt
  })
};

document.documentElement.dataset.tingxieMicDiagnostics = 'true';
