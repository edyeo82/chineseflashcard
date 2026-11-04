'use strict';
// PUBLIC Firebase app configuration, NOT a Gemini API key.
// To activate V2 for ALL users, the SITE OWNER must:
// 1. In Firebase project chinese-flashcards-63883 enable AI Services > AI Logic > Gemini Developer API.
// 2. In Google Cloud create a reCAPTCHA Enterprise web site key for edyeo82.github.io.
// 3. Register that web key for this Firebase Web app in Firebase Security > App Check.
// 4. Paste the PUBLIC reCAPTCHA Enterprise site key into appCheckSiteKey below.
// 5. Ensure Firebase AI Logic App Check enforcement is enabled.
// End users enter nothing. Do not commit any secret API keys.
window.TINGXIE_V2_AI_CONFIG=Object.freeze({
  firebase:{
    apiKey:'AIzaSyAhQzUiDlZazIKi3180eT2BTXdaD5h81sI',
    authDomain:'chinese-flashcards-63883.firebaseapp.com',
    projectId:'chinese-flashcards-63883',
    storageBucket:'chinese-flashcards-63883.firebasestorage.app',
    messagingSenderId:'869052621203',
    appId:'1:869052621203:web:f79f36422ffcf5b9d54866'
  },
  appCheckSiteKey:'',
  model:'gemini-3.5-flash-lite'
});
