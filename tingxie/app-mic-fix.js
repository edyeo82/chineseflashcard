'use strict';

const TINGXIE_MIC_FIX_VERSION = '20260720-1';

function isChromeOnIOS() {
  return /CriOS/i.test(navigator.userAgent || '');
}

function microphoneSettingsHint() {
  if (isChromeOnIOS()) {
    return 'On iPhone, open Settings → Chrome and turn on both Microphone and Speech Recognition. Then fully close and reopen Chrome.';
  }
  return 'Allow microphone access for this site in your browser settings, then reload the page.';
}

function resetVoiceNextButton() {
  state.voiceEnabled = false;
  state.microphoneCheckPending = false;
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

createRecognition = function createRecognitionWithDiagnostics() {
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
    if (state.voiceEnabled && !state.isSpeaking && panels.dictation.classList.contains('active')) {
      setTimeout(startListening, 450);
    }
  };

  return recognition;
};

startListening = function startListeningWithDiagnostics() {
  if (!state.voiceEnabled || state.isSpeaking || !panels.dictation.classList.contains('active')) return;
  if (!recognitionSupported()) {
    resetVoiceNextButton();
    setVoiceStatus('error', 'This browser does not support web voice commands. Use the Next button.');
    return;
  }
  if (state.recognitionActive) return;

  state.recognition = createRecognition();
  try {
    state.recognition.start();
  } catch (error) {
    state.recognitionActive = false;
    setVoiceStatus('error', `Voice listening could not start${error?.message ? `: ${error.message}` : '.'} Tap the microphone button again.`);
  }
};

toggleVoiceNext = async function toggleVoiceNextWithMicrophoneCheck(forceValue) {
  const nextValue = typeof forceValue === 'boolean' ? forceValue : !state.voiceEnabled;

  if (!nextValue) {
    state.voiceEnabled = false;
    state.microphoneCheckPending = false;
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
  button.disabled = false;
  button.textContent = '⏸ Stop voice “next”';
  setVoiceStatus('listening', 'Microphone access confirmed. Starting speech recognition…');
  startListening();
};

window.__tingxieMicrophoneDiagnostics = {
  version: TINGXIE_MIC_FIX_VERSION,
  verifyMicrophoneAccess,
  microphoneFailureMessage,
  isChromeOnIOS
};

document.documentElement.dataset.tingxieMicDiagnostics = 'true';
