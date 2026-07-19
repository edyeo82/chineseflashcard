'use strict';

(async () => {
  const VERSION = '20260719-4';

  // Remove the old offline worker first. Mixed cached module versions can leave
  // the page visible while none of the buttons have working event handlers.
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
    } catch (error) {
      console.warn('Unable to unregister old service worker', error);
    }
  }

  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames
        .filter(name => name.startsWith('tingxie-shell-'))
        .map(name => caches.delete(name)));
    } catch (error) {
      console.warn('Unable to clear old Ting Xie caches', error);
    }
  }

  const scripts = [
    'boot.js',
    'app-core.js',
    'app-ocr.js',
    'app-camera.js',
    'app-dictation.js',
    'app-marking.js',
    'app-init.js'
  ];

  for (const src of scripts) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${src}?v=${VERSION}`;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Unable to load ${src}`));
      document.head.appendChild(script);
    });
  }

  document.documentElement.dataset.tingxieReady = 'true';
})().catch(error => {
  console.error(error);
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = `The app could not start: ${error.message || 'unknown error'}`;
    toast.classList.add('show');
  } else {
    alert(`The app could not start: ${error.message || 'unknown error'}`);
  }
});
