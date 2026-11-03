'use strict';

const PHOTO_TARGETS = {
  source: {
    inputId: 'sourceImage',
    previewId: 'sourcePreview',
    scanButtonId: 'scanSourceButton',
    progressId: 'sourceProgress',
    stateKey: 'sourceFile',
    title: 'Photograph the 听写 list'
  },
  answer: {
    inputId: 'answerImage',
    previewId: 'answerPreview',
    scanButtonId: 'scanAnswerButton',
    progressId: 'answerProgress',
    stateKey: 'answerFile',
    title: 'Photograph the completed work'
  }
};

let cameraStream = null;
let activeCameraTarget = null;
let cameraBusy = false;

function addCameraStylesheet() {
  if (document.querySelector('link[data-tingxie-camera-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'camera.css';
  link.dataset.tingxieCameraStyle = 'true';
  document.head.appendChild(link);
}

function buildCameraDialog() {
  if ($('cameraDialog')) return;

  const dialog = document.createElement('div');
  dialog.id = 'cameraDialog';
  dialog.className = 'camera-dialog hidden';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'cameraTitle');
  dialog.innerHTML = `
    <div class="camera-backdrop" data-camera-close></div>
    <div class="camera-sheet">
      <div class="camera-heading">
        <div>
          <p class="section-kicker">Camera</p>
          <h2 id="cameraTitle">Take a photo</h2>
        </div>
        <button id="cameraCloseButton" class="camera-close-button" type="button" aria-label="Close camera">×</button>
      </div>
      <div class="camera-viewport">
        <video id="cameraVideo" autoplay muted playsinline></video>
        <div id="cameraLoading" class="camera-loading">Starting camera…</div>
      </div>
      <p class="camera-help">Keep the whole page inside the frame and hold the phone steady.</p>
      <div class="camera-actions">
        <button id="cameraCancelButton" class="secondary-button" type="button">Cancel</button>
        <button id="cameraCaptureButton" class="accent-button camera-capture-button" type="button" disabled>Take photo</button>
      </div>
    </div>`;

  document.body.appendChild(dialog);
  $('cameraCloseButton').addEventListener('click', closeInBrowserCamera);
  $('cameraCancelButton').addEventListener('click', closeInBrowserCamera);
  dialog.querySelector('[data-camera-close]').addEventListener('click', closeInBrowserCamera);
  $('cameraCaptureButton').addEventListener('click', captureCameraFrame);
}

function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  const video = $('cameraVideo');
  if (video) video.srcObject = null;
}

function closeInBrowserCamera() {
  stopCameraStream();
  activeCameraTarget = null;
  cameraBusy = false;
  document.body.classList.remove('camera-open');
  $('cameraDialog')?.classList.add('hidden');
}

function applyPhotoFile(targetName, file) {
  const target = PHOTO_TARGETS[targetName];
  if (!target || !file) return;
  state[target.stateKey] = file;
  setImagePreview(file, $(target.previewId));
  $(target.scanButtonId).disabled = false;
  $(target.progressId).classList.add('hidden');
  showToast('Photo loaded. Tap the purple button to read it.');
}

async function openInBrowserCamera(targetName) {
  const target = PHOTO_TARGETS[targetName];
  if (!target) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('The in-browser camera is unavailable here. Choose the photo from Photos instead.');
    $(target.inputId).click();
    return;
  }

  buildCameraDialog();
  stopCameraStream();
  activeCameraTarget = targetName;
  cameraBusy = true;
  $('cameraTitle').textContent = target.title;
  $('cameraLoading').textContent = 'Starting camera…';
  $('cameraLoading').classList.remove('hidden');
  $('cameraCaptureButton').disabled = true;
  $('cameraDialog').classList.remove('hidden');
  document.body.classList.add('camera-open');

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1440 }
      }
    });

    const video = $('cameraVideo');
    video.srcObject = cameraStream;
    await video.play();

    if (!video.videoWidth) {
      await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));
    }

    $('cameraLoading').classList.add('hidden');
    $('cameraCaptureButton').disabled = false;
    cameraBusy = false;
  } catch (error) {
    console.error(error);
    closeInBrowserCamera();
    const permissionProblem = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
    showToast(permissionProblem
      ? 'Camera permission was not allowed. Choose the photo from Photos, or allow Camera in Safari settings.'
      : 'The camera could not start. Choose the photo from Photos instead.');
  }
}

function canvasToJpegFile(canvas, filename) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('The photo could not be created.'));
        return;
      }
      resolve(new File([blob], filename, { type: 'image/jpeg', lastModified: Date.now() }));
    }, 'image/jpeg', 0.9);
  });
}

async function captureCameraFrame() {
  if (cameraBusy || !activeCameraTarget) return;
  const video = $('cameraVideo');
  if (!video?.videoWidth || !video?.videoHeight) {
    showToast('The camera is not ready yet.');
    return;
  }

  cameraBusy = true;
  const button = $('cameraCaptureButton');
  button.disabled = true;
  button.textContent = 'Saving photo…';

  try {
    const maxDimension = 2200;
    const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const targetName = activeCameraTarget;
    const file = await canvasToJpegFile(canvas, `tingxie-${targetName}-${Date.now()}.jpg`);
    closeInBrowserCamera();
    applyPhotoFile(targetName, file);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'The photo could not be saved.');
    cameraBusy = false;
    button.disabled = false;
  } finally {
    button.textContent = 'Take photo';
  }
}

function setupPhotoTarget(targetName) {
  const target = PHOTO_TARGETS[targetName];
  const input = $(target.inputId);
  const label = document.querySelector(`label[for="${target.inputId}"]`);
  if (!input || !label || label.dataset.cameraEnhanced === 'true') return;

  label.dataset.cameraEnhanced = 'true';
  input.removeAttribute('capture');

  const strong = label.querySelector('strong');
  const small = label.querySelector('small');
  if (strong) strong.textContent = 'Choose an existing photo';
  if (small) small.textContent = 'Select from Photos or Files.';

  const cameraButton = document.createElement('button');
  cameraButton.type = 'button';
  cameraButton.className = 'primary-button full-width in-browser-camera-button';
  cameraButton.textContent = '📷 Take photo in browser';
  cameraButton.addEventListener('click', () => openInBrowserCamera(targetName));
  label.insertAdjacentElement('afterend', cameraButton);

  input.addEventListener('click', () => {
    input.value = '';
  });

  input.addEventListener('input', event => {
    const file = event.target.files?.[0];
    if (file) applyPhotoFile(targetName, file);
  });
}

function initPhotoCapture() {
  addCameraStylesheet();
  buildCameraDialog();
  setupPhotoTarget('source');
  setupPhotoTarget('answer');

  window.addEventListener('pagehide', stopCameraStream);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && cameraStream) closeInBrowserCamera();
  });
}

initPhotoCapture();
