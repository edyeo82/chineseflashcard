'use strict';

(async () => {
  const scripts = ['app-core.js', 'app-ocr.js', 'app-camera.js', 'app-dictation.js', 'app-marking.js', 'app-init.js'];
  for (const src of scripts) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Unable to load ${src}`));
      document.head.appendChild(script);
    });
  }
})().catch(error => {
  console.error(error);
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = 'The app could not start. Reload the page.';
    toast.classList.add('show');
  }
});
