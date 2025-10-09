// Preencha com as credenciais do seu app Firebase Web (ambiente de desenvolvimento)
window.__ENV__ = {
  FIREBASE_API_KEY: "AIzaSyBr7yRIyZZiQhIH0SMhlik-aJ6NZ1fWQLk",
  FIREBASE_AUTH_DOMAIN: "uz-lang-studio.firebaseapp.com",
  FIREBASE_PROJECT_ID: "uz-lang-studio",
  FIREBASE_STORAGE_BUCKET: "uz-lang-studio.appspot.com",
  FIREBASE_APP_ID: "1:660818120099:web:699baf23f4ca3f3ec0de16",

  YOUTUBE_API_KEY: "AIzaSyBo2Y38zNYfkWaEVQZECCaNC7cXAGuBaYk",

  // flags da UI (somente isso; sem secrets aqui)
  TTS_ENABLED: true,
  TTS_PROVIDER: "elevenlabs",

  // API_BASE opcional: se quiser apontar preview estático para Hosting em dev
  // Em dev/hosting, deixe vazio para usar rewrites ("/api"); em produção, app.js usa fallback Functions absoluto
  API_BASE: ""
};

// Compatibilidade: manter window.env para o app atual
window.env = window.__ENV__;