// Copyright — todos os direitos reservados a Henrique
import "dotenv/config";
import functions from "firebase-functions";
import admin from "firebase-admin";
import express from "express";
import cors from "cors";
import axios from "axios";
import FormData from "form-data";
import { requireRole, requireEditorOrAdmin } from "./auth/roles.js";

admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
// Strip "/api" prefix when coming from Firebase Hosting rewrites so Express routes like "/bridge/voices" match
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/')) {
    req.url = req.url.substring(4) || '/';
  }
  next();
});

// Auth middleware: verifica Firebase ID token e carrega roles do usuário
app.use(async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) {
      const idToken = authHeader.split(" ")[1];
      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;
      const userDoc = await db.collection("users").doc(uid).get();
      req.user = {
        uid,
        email: decoded.email,
        roles: userDoc.exists ? (userDoc.data().roles || []) : []
      };
    }
  } catch (e) {
    console.warn(`[AUTH] Falha verificar token. endpoint=${req.method} ${req.originalUrl} err=${e?.message}`);
  }
  next();
});

// Proteger prefixos admin e bridge apenas para admin
app.use("/admin", requireRole("admin"));
app.use("/bridge", requireRole("admin"));

function extractYoutubeId(urlOrId) {
  if (!urlOrId) return null;
  const idMatch = String(urlOrId).match(/([a-zA-Z0-9_-]{11})/);
  if (idMatch) return idMatch[1];
  try {
    const u = new URL(urlOrId);
    if (u.hostname.includes("youtube.com")) {
      return u.searchParams.get("v");
    }
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.slice(1);
    }
  } catch (e) { /* ignore */ }
  return null;
}

app.post("/ingest", requireRole("admin"), async (req, res) => {
  try {
    const { url } = req.body || {};
    const vid = extractYoutubeId(url);
    if (!vid) return res.status(400).json({ error: "youtubeId inválido" });

    const now = admin.firestore.FieldValue.serverTimestamp();

    const videoRef = db.collection("videos").doc(vid);
    const videoSnap = await videoRef.get();

    if (!videoSnap.exists) {
      // Fetch basic metadata from YouTube Data API if key present
      let title = "";
      let thumbnailUrl = "";
      let durationSec = 0;
      const apiKey = process.env.YOUTUBE_API_KEY || functions.config().youtube?.api_key;
      if (apiKey) {
        try {
          const yt = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
            params: { id: vid, key: apiKey, part: "snippet,contentDetails" }
          });
          const item = yt.data.items?.[0];
          if (item) {
            title = item.snippet?.title || "";
            thumbnailUrl = item.snippet?.thumbnails?.medium?.url || "";
            const iso = item.contentDetails?.duration || "PT0S";
            // Simple ISO8601 duration parser
            const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            const h = parseInt(m?.[1] || 0, 10);
            const min = parseInt(m?.[2] || 0, 10);
            const s = parseInt(m?.[3] || 0, 10);
            durationSec = h * 3600 + min * 60 + s;
          }
        } catch (err) {
          console.warn("YouTube API fallback", err.message);
        }
      }

      await videoRef.set({
        source: "youtube",
        title,
        thumbnailUrl,
        durationSec,
        status: "processing",
        langs: { pt: true, en: false, es: false },
        createdBy: req.user?.uid || null,
        lastJobId: null,
        createdAt: now
      }, { merge: true });
    }

    const jobRef = await db.collection("jobs").add({
      videoId: vid,
      steps: ["ingest","transcribe","translate-en","translate-es","tts-en","tts-es","mux"],
      currentStep: "ingest",
      status: "queued",
      log: ["Job criado"],
      createdAt: now,
      updatedAt: now
    });

    await videoRef.update({ lastJobId: jobRef.id });

    return res.json({ ok: true, videoId: vid, jobId: jobRef.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "erro interno" });
  }
});

app.get("/analytics/:videoId", async (req, res) => {
  // TODO: Implement OAuth flow and call YouTube Analytics API using project service account or channel credentials
  // For now, return a stub series to unblock UI
  const { videoId } = req.params;
  const series = Array.from({ length: 20 }).map((_, i) => ({ t: i, r: Math.max(0, 100 - i * 3 + (i%5)*2) }));
  return res.json({ videoId, series, source: "stub" });
});

// Channels API
app.get("/channels", async (_req, res) => {
  try {
    const snap = await db.collection("channels").orderBy("createdAt", "desc").limit(50).get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({ items });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro interno" });
  }
});

app.post("/channels", requireEditorOrAdmin, async (req, res) => {
  try {
    const { channelId, title } = req.body || {};
    if (!channelId || !title) return res.status(400).json({ error: "channelId e title obrigatórios" });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const ref = db.collection("channels").doc(channelId);

    // Try fetch basic stats from YouTube Data API
    let stats = { subscribers: 0, views: 0, videos: 0 };
    const apiKey = process.env.YOUTUBE_API_KEY || functions.config().youtube?.api_key;
    if (apiKey) {
      try {
        const yt = await axios.get("https://www.googleapis.com/youtube/v3/channels", {
          params: { id: channelId, key: apiKey, part: "statistics,snippet" }
        });
        const item = yt.data.items?.[0];
        if (item?.statistics) {
          stats.subscribers = Number(item.statistics.subscriberCount || 0);
          stats.views = Number(item.statistics.viewCount || 0);
          stats.videos = Number(item.statistics.videoCount || 0);
        }
      } catch (err) {
        console.warn("YouTube Channel stats fallback", err.message);
      }
    }

    await ref.set({
      title,
      stats,
      createdAt: now,
      createdBy: req.user?.uid || null
    }, { merge: true });

    return res.status(201).json({ ok: true, id: channelId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro interno" });
  }
});

// TTS trigger API (stub job)
app.post("/tts", async (req, res) => {
  try {
    const roles = req.user?.roles || [];
    const allowed = roles.includes("admin") || roles.includes("editor");
    if (!allowed) {
      console.warn(`[403] uid=${req.user?.uid||'anon'} roles=${JSON.stringify(roles)} endpoint=${req.method} ${req.originalUrl}`);
      return res.status(403).json({ status: 'error', code: 'FORBIDDEN', message: 'sem permissão', uid: req.user?.uid||null, roles });
    }

    const { videoId, lang } = req.body || {};
    if (!videoId || !lang) return res.status(400).json({ error: "videoId e lang obrigatórios" });
    if (!['en','es'].includes(lang)) return res.status(400).json({ error: "lang inválido" });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const jobRef = await db.collection("jobs").add({
      videoId,
      steps: ["tts-"+lang],
      currentStep: "tts-"+lang,
      status: "queued",
      log: ["TTS solicitado via API"],
      createdAt: now,
      updatedAt: now,
      kind: "tts",
      lang
    });

    return res.json({ ok: true, jobId: jobRef.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro interno" });
  }
});

// NOVO: Tradução
app.post("/translate", async (req, res) => {
  try {
    const roles = req.user?.roles || [];
    const allowed = roles.includes("admin") || roles.includes("editor");
    if (!allowed) {
      console.warn(`[403] uid=${req.user?.uid||'anon'} roles=${JSON.stringify(roles)} endpoint=${req.method} ${req.originalUrl}`);
      return res.status(403).json({ status: 'error', code: 'FORBIDDEN', message: 'sem permissão', uid: req.user?.uid||null, roles });
    }

    const { videoId, lang } = req.body || {};
    if (!videoId || !lang) return res.status(400).json({ error: "videoId e lang obrigatórios" });
    if (!['en','es'].includes(lang)) return res.status(400).json({ error: "lang inválido" });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const jobRef = await db.collection("jobs").add({
      videoId,
      steps: ["translate-"+lang],
      currentStep: "translate-"+lang,
      status: "queued",
      log: ["Tradução solicitada via API"],
      createdAt: now,
      updatedAt: now,
      kind: "translate",
      lang
    });

    return res.json({ ok: true, jobId: jobRef.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro interno" });
  }
});

// NOVO: Vozes (listar/criar)
app.get("/voices", async (_req, res) => {
  try {
    const snap = await db.collection("voices").orderBy("createdAt", "desc").limit(100).get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({ items });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro interno" });
  }
});

app.post("/voices", async (req, res) => {
  try {
    const roles = req.user?.roles || [];
    const allowed = roles.includes("admin") || roles.includes("editor");
    if (!allowed) {
      console.warn(`[403] uid=${req.user?.uid||'anon'} roles=${JSON.stringify(roles)} endpoint=${req.method} ${req.originalUrl}`);
      return res.status(403).json({ status: 'error', code: 'FORBIDDEN', message: 'sem permissão', uid: req.user?.uid||null, roles });
    }

    const { name, lang, description } = req.body || {};
    if (!name) return res.status(400).json({ error: "name obrigatório" });
    const now = admin.firestore.FieldValue.serverTimestamp();
    const ref = await db.collection("voices").add({
      name,
      lang: lang || "en",
      description: description || "",
      status: "active",
      createdAt: now,
      createdBy: req.user?.uid || null
    });

    return res.json({ ok: true, id: ref.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro interno" });
  }
});

// NOVO: Publicação (stub)
app.post("/publish", requireEditorOrAdmin, async (req, res) => {
  try {
    const { videoId, title, description, tags } = req.body || {};
    if (!videoId) return res.status(400).json({ error: "videoId obrigatório" });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const jobRef = await db.collection("jobs").add({
      videoId,
      steps: ["publish"],
      currentStep: "publish",
      status: "queued",
      log: ["Publicação solicitada via API"],
      createdAt: now,
      updatedAt: now,
      kind: "publish",
      meta: { title: title || null, description: description || null, tags: tags || [] }
    });

    return res.json({ ok: true, jobId: jobRef.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro interno" });
  }
});

// Admin: App config (somente admin)
app.get("/admin/config", async (_req, res) => {
  try {
    const snap = await db.collection("config").doc("app").get();
    const data = snap.exists ? snap.data() : {};
    return res.json({ ok: true, config: data });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro interno" });
  }
});

app.post("/admin/config", async (req, res) => {
  try {
    // requireRole("admin") já aplicado no prefixo /admin
    const { apiBase, ttsEnabled } = req.body || {};
    const now = admin.firestore.FieldValue.serverTimestamp();
    const ref = db.collection("config").doc("app");
    const payload = { updatedAt: now };
    if (apiBase !== undefined) payload.apiBase = apiBase;
    if (ttsEnabled !== undefined) payload.ttsEnabled = !!ttsEnabled;
    await ref.set(payload, { merge: true });
    return res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro interno" });
  }
});

app.put("/admin/config", async (req, res) => {
  try {
    const roles = req.user?.roles || [];
    if (!roles.includes("admin")) {
      console.warn(`[403] uid=${req.user?.uid||'anon'} roles=${JSON.stringify(roles)} endpoint=${req.method} ${req.originalUrl}`);
      return res.status(403).json({ error: "forbidden", reason: "requires role: admin", uid: req.user?.uid||null, roles });
    }

    const { apiBase, ttsEnabled } = req.body || {};
    const now = admin.firestore.FieldValue.serverTimestamp();
    const ref = db.collection("config").doc("app");
    const payload = { updatedAt: now };
    if (apiBase !== undefined) payload.apiBase = apiBase;
    if (ttsEnabled !== undefined) payload.ttsEnabled = !!ttsEnabled;
    await ref.set(payload, { merge: true });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro interno" });
  }
});

// Admin: Roles de usuários (somente admin)
app.get("/admin/users/:uid/roles", async (req, res) => {
  try {
    const roles = req.user?.roles || [];
    if (!roles.includes("admin")) {
      console.warn(`[403] uid=${req.user?.uid||'anon'} roles=${JSON.stringify(roles)} endpoint=${req.method} ${req.originalUrl}`);
      return res.status(403).json({ error: "forbidden", reason: "requires role: admin", uid: req.user?.uid||null, roles });
    }

    const { uid } = req.params;
    if (!uid) return res.status(400).json({ error: "uid obrigatório" });
    const usnap = await db.collection("users").doc(uid).get();
    const userRoles = usnap.exists ? (usnap.data().roles || []) : [];
    return res.json({ uid, roles: userRoles });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro interno" });
  }
});

app.post("/admin/users/:uid/roles", async (req, res) => {
  try {
    const roles = req.user?.roles || [];
    if (!roles.includes("admin")) {
      console.warn(`[403] uid=${req.user?.uid||'anon'} roles=${JSON.stringify(roles)} endpoint=${req.method} ${req.originalUrl}`);
      return res.status(403).json({ error: "forbidden", reason: "requires role: admin", uid: req.user?.uid||null, roles });
    }

    const { uid } = req.params;
    if (!uid) return res.status(400).json({ error: "uid obrigatório" });
    const newRoles = Array.isArray(req.body?.roles) ? req.body.roles : null;
    if (!newRoles) return res.status(400).json({ error: "roles deve ser array" });
    const unique = Array.from(new Set(newRoles.map(r => String(r).trim()).filter(Boolean)));

    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("users").doc(uid).set({ roles: unique, updatedAt: now }, { merge: true });
    // Propagar roles para custom claims para regras de Storage
    await admin.auth().setCustomUserClaims(uid, { roles: unique });
    await admin.auth().revokeRefreshTokens(uid);
    return res.json({ ok: true, uid, roles: unique, claimsUpdated: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro interno" });
  }
});

export const api = functions.region("us-central1").https.onRequest(app);

// duplicado removido: onJobCreate já exportado acima


function getElevenApiKey() {
  // Ordem de prioridade: secret manager (functions:config), variável de ambiente.
  // Nunca logar o valor.
  return (
    functions.config().secret?.elevenlabs_api_key ||
    functions.config().elevenlabs?.api_key ||
    process.env.TTS_API_KEY ||
    process.env.ELEVENLABS_API_KEY ||
    null
  );
}

// Substitui o uso do SDK por chamadas REST
async function elevenListVoices() {
  const apiKey = getElevenApiKey();
  // Fallback: sem API key, retorna lista vazia para permitir UI funcionar em desenvolvimento
  if (!apiKey) return [];
  const r = await axios.get("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey } });
  return r.data?.voices || r.data || [];
}

async function elevenGetVoicesWithFallback() {
  // Agora apenas REST (sem SDK) com fallback silencioso
  try {
    return await elevenListVoices();
  } catch (_e) {
    return [];
  }
}

async function elevenGetVoiceStatus(voiceId) {
  const apiKey = getElevenApiKey();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY não configurada");
  // Simples GET REST com pequeno backoff
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await axios.get(`https://api.elevenlabs.io/v1/voices/${voiceId}`, { headers: { "xi-api-key": apiKey }});
      return r.data;
    } catch (e) {
      lastErr = e;
      await new Promise(res => setTimeout(res, 300 * (attempt+1)));
    }
  }
  throw lastErr || new Error("Falha ao consultar voz");
}

async function elevenTtsGenerate(voiceId, text, outputFormat) {
  const apiKey = getElevenApiKey();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY não configurada");
  const accept = outputFormat?.startsWith('mp3') ? 'audio/mpeg' : outputFormat?.startsWith('ogg') ? 'audio/ogg' : 'audio/opus';
  const headers = { 'xi-api-key': apiKey, 'accept': accept, 'Content-Type': 'application/json' };
  const body = { text, output_format: outputFormat };
  const resp = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, body, { headers, responseType: 'arraybuffer' });
  return Buffer.from(resp.data);
}

async function generateV4SignedUrl(bucketName, filePath, expiresInSeconds = 3600) {
  const bucket = storage.bucket(bucketName);
  const [url] = await bucket.file(filePath).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInSeconds * 1000,
    contentType: undefined
  });
  return url;
}

// Diagnostics
app.get("/bridge/ping", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ status: "error", code: "AUTH_INVALID", message: "Usuário não autenticado" });
    const list = await elevenGetVoicesWithFallback();
    return res.json({ status: "ok", provider: "elevenlabs", voices_count: (Array.isArray(list) ? list.length : 0) });
  } catch (e) {
    const code = e?.status || e?.code || 'AUTH_INVALID';
    return res.status(400).json({ status: "error", code, message: e.message || 'Falha no ping' });
  }
});

// Listar vozes unificando ElevenLabs e perfis mapeados no Firestore
app.get("/bridge/voices", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ status: 'error', code: 'AUTH_INVALID', message: 'Usuário não autenticado' });
    const list = await elevenGetVoicesWithFallback();
    const snap = await db.collection('voice_profiles').limit(200).get();
    const profiles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({ status: 'ok', items: list, profiles });
  } catch (e) {
    return res.status(500).json({ status: 'error', code: 'LIST_VOICES_FAIL', message: e.message });
  }
});

// Status da voz no provider (reposto)
app.get("/bridge/voices/:voiceId/status", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ status: 'error', code: 'AUTH_INVALID', message: 'Usuário não autenticado' });
    const { voiceId } = req.params || {};
    if (!voiceId) return res.status(400).json({ status:'error', code:'INVALID_INPUT', message:'voiceId obrigatório' });
    const data = await elevenGetVoiceStatus(voiceId);
    return res.json({ status: 'ok', voice: data });
  } catch (e) {
    const status = e?.response?.status;
    const code = status === 404 ? 'VOICE_NOT_FOUND' : status === 401 ? 'AUTH_INVALID' : status === 429 ? 'RATE_LIMITED' : 'STATUS_FAIL';
    const msg = e?.response?.data?.message || e.message || 'Falha ao consultar status';
    const httpStatus = status && status >= 400 ? status : 500;
    return res.status(httpStatus).json({ status: 'error', code, message: msg });
  }
});

// Mapear voice_id existente para um profile interno (reposto)
app.post("/bridge/voices/map", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ status: 'error', code: 'AUTH_INVALID', message: 'Usuário não autenticado' });
    const roles = req.user?.roles || [];
    if (!(roles.includes('admin') || roles.includes('editor'))) {
      console.warn(`[403] uid=${req.user?.uid||'anon'} roles=${JSON.stringify(roles)} endpoint=${req.method} ${req.originalUrl}`);
      return res.status(403).json({ status: 'error', code: 'FORBIDDEN', message: 'sem permissão', uid: req.user?.uid||null, roles });
    }
    const { project = 'default', voice_name, voice_id } = req.body || {};
    if (!voice_name || !voice_id) return res.status(400).json({ status:'error', code:'INVALID_INPUT', message:'voice_name e voice_id obrigatórios' });
    const now = admin.firestore.FieldValue.serverTimestamp();
    const docId = `${project}__${voice_name}`;
    await db.collection('voice_profiles').doc(docId).set({ project, voice_name, voice_id, createdAt: now, createdBy: req.user?.uid || null }, { merge: true });
    return res.json({ status: 'ok', voice_profile_id: docId });
  } catch (e) {
    return res.status(500).json({ status: 'error', code: 'MAP_FAIL', message: e.message });
  }
});


// Gerar TTS com ElevenLabs e publicar no Storage
app.post("/bridge/tts/generate", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ status: 'error', code: 'AUTH_INVALID', message: 'Usuário não autenticado' });
    const roles = req.user?.roles || [];
    if (!(roles.includes('admin') || roles.includes('editor'))) {
      console.warn(`[403] uid=${req.user?.uid||'anon'} roles=${JSON.stringify(roles)} endpoint=${req.method} ${req.originalUrl}`);
      return res.status(403).json({ status: 'error', code: 'FORBIDDEN', message: 'sem permissão', uid: req.user?.uid||null, roles });
    }
    const { voice_profile_id, text, format = 'mp3', speed = 1.0, pitch = 0, project = 'default' } = req.body || {};
    if (!text) {
      return res.status(400).json({ status: 'error', code:'INVALID_INPUT', message: 'text é obrigatório' });
    }

    // Resolver voice_id: profile -> env fallback
    let voice_id = null;
    if (voice_profile_id) {
      const prof = await db.collection('voice_profiles').doc(voice_profile_id).get();
      if (prof.exists) {
        voice_id = prof.data()?.voice_id || null;
      } else {
        // Fallback para variável de ambiente se não encontrar o perfil
        voice_id = process.env.TTS_VOICE_ID || null;
        if (!voice_id) return res.status(404).json({ status:'error', code:'PROFILE_NOT_FOUND', message:'perfil de voz não encontrado e TTS_VOICE_ID ausente' });
      }
    } else {
      voice_id = process.env.TTS_VOICE_ID || null;
    }

    if (!voice_id) {
      return res.status(400).json({ status:'error', code:'VOICE_ID_NOT_RESOLVED', message:'Não foi possível resolver um voice_id. Configure voice_profile ou TTS_VOICE_ID.' });
    }

    // Nota: SDK removido; usar REST
    const outputFormat = (format === 'ogg') ? 'ogg_44100' : (format === 'opus') ? 'opus_48000' : 'mp3_44100';

    let audioBuffer;
    try {
      audioBuffer = await elevenTtsGenerate(voice_id, text, outputFormat);
    } catch (e) {
      return res.status(500).json({ status:'error', code:'TTS_GENERATION_ERROR', message: e.message });
    }

    // Upload em Firebase Storage
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || admin.app().options.storageBucket;
    if (!bucketName) return res.status(500).json({ status:'error', code:'STORAGE_BUCKET_NOT_SET', message:'Bucket não configurado' });
    const fileName = `bridge_tts/${project}/${voice_profile_id||'env'}/${Date.now()}.${format}`;
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(fileName);
    await file.save(audioBuffer, { resumable: false, contentType: (format==='mp3'?'audio/mpeg': format==='ogg'?'audio/ogg':'audio/opus') });

    const signedUrl = await generateV4SignedUrl(bucketName, fileName, 3600);

    return res.json({ status:'ok', audio_url: signedUrl, duration_ms: null, voice_id, format, voice_profile_id: voice_profile_id || null });
  } catch (e) {
    const status = e?.response?.status;
    const code = e.message?.includes('ELEVENLABS_API_KEY') ? 'AUTH_INVALID' : status === 429 ? 'RATE_LIMITED' : 'UNKNOWN';
    const httpStatus = status && status >= 400 ? status : 500;
    return res.status(httpStatus).json({ status:'error', code, message: e.message });
  }
});

export const onJobCreate = functions.firestore
  .document("jobs/{jobId}")
  .onCreate(async (snap, context) => {
    const jobRef = snap.ref;
    const now = admin.firestore.FieldValue.serverTimestamp();
    try {
      await jobRef.update({ status: "running", updatedAt: now, log: admin.firestore.FieldValue.arrayUnion("Job em execução") });
      // Worker irá observar jobs com status=running
    } catch (e) {
      await jobRef.update({ status: "failed", updatedAt: now, log: admin.firestore.FieldValue.arrayUnion(`Falha ao iniciar: ${e.message}`) });
    }
  });

async function fetchTrainingBuffers(filesSpec = []) {
  // filesSpec: array de { url?: string, storagePath?: string, filename?: string }
  const results = [];
  const bucket = admin.storage().bucket();
  for (const item of filesSpec) {
    if (item?.url) {
      const r = await axios.get(item.url, { responseType: 'arraybuffer' });
      const buf = Buffer.from(r.data);
      const name = item.filename || item.url.split('/').pop() || 'audio.wav';
      results.push({ buffer: buf, filename: name });
    } else if (item?.storagePath) {
      // storagePath pode ser "folder/file.wav" ou "gs://bucket/folder/file.wav"
      let fileRef;
      if (item.storagePath.startsWith('gs://')) {
        const u = new URL(item.storagePath);
        const b = u.host;
        const p = u.pathname.replace(/^\//, '');
        fileRef = admin.storage().bucket(b).file(p);
      } else {
        fileRef = bucket.file(item.storagePath);
      }
      const [buf] = await fileRef.download();
      const name = item.filename || fileRef.name.split('/').pop() || 'audio.wav';
      results.push({ buffer: buf, filename: name });
    }
  }
  return results;
}

// Clonagem de voz: requer consentimento explícito e arquivos de treino
app.post("/bridge/voices/clone", async (req, res) => {
  try {
    const userId = req.user?.uid || null;
    const { name, project, consent, files = [], training_files = [], webhook_url } = req.body || {};

    if (!userId) return res.status(401).json({ status: 'error', code: 'AUTH_INVALID', message: 'Usuário não autenticado' });
    if (!consent) return res.status(400).json({ status: 'error', code: 'CONSENT_REQUIRED', message: 'Consentimento explícito é obrigatório' });
    if (!name) return res.status(400).json({ status: 'error', code: 'INVALID_INPUT', message: 'Nome da voz é obrigatório' });

    const filesSpec = (Array.isArray(files) && files.length ? files :
      (Array.isArray(training_files) ? training_files.map(s => {
        const str = String(s||'').trim(); if (!str) return null;
        return str.startsWith('http') ? { url: str } : { storagePath: str };
      }).filter(Boolean) : []));

    if (!Array.isArray(filesSpec) || filesSpec.length === 0) {
      return res.status(400).json({ status: 'error', code: 'INVALID_INPUT', message: 'Forneça ao menos um arquivo de treino (url ou storagePath)' });
    }

    // Busca buffers dos arquivos
    const buffers = await fetchTrainingBuffers(filesSpec);
    if (buffers.length === 0) return res.status(400).json({ status: 'error', code: 'FILES_NOT_FOUND', message: 'Não foi possível obter os arquivos de treino' });

    const apiKey = getElevenApiKey();
    if (!apiKey) return res.status(500).json({ status: 'error', code: 'CONFIG_ERROR', message: 'ELEVENLABS_API_KEY não configurada' });

    const form = new FormData();
    form.append('name', name);
    for (const f of buffers) {
      form.append('files', f.buffer, { filename: f.filename || 'audio.wav' });
      form.append('files[]', f.buffer, { filename: f.filename || 'audio.wav' });
    }

    const headers = { ...form.getHeaders(), 'xi-api-key': apiKey };

    const resp = await axios.post('https://api.elevenlabs.io/v1/voices/add', form, { headers });
    const data = resp.data || {};
    const voiceId = data.voice_id || data.voice?.voice_id || data?.id || null;
    if (!voiceId) {
      return res.status(502).json({ status: 'error', code: 'VOICE_TRAIN_FAIL', message: 'Resposta inesperada da API de voz' });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const record = { profile_id: null, name, voice_id: voiceId, project: project || null, user_id: userId, source: 'elevenlabs', created_at: now };
    const docRef = await db.collection('voice_profiles').add(record);
    await docRef.update({ profile_id: docRef.id });

    if (webhook_url) {
      axios.post(webhook_url, { status: 'ok', event: 'voice_cloned', voice_id: voiceId, profile_id: docRef.id, user_id: userId }).catch(() => {});
    }

    return res.json({ status: 'ok', voice_id: voiceId, profile_id: docRef.id });
  } catch (e) {
    const status = e?.response?.status;
    const code = status === 401 ? 'AUTH_INVALID' : status === 429 ? 'RATE_LIMITED' : status === 400 ? 'INVALID_INPUT' : 'VOICE_TRAIN_FAIL';
    const msg = e?.response?.data?.message || e.message || 'Falha ao clonar voz';
    const httpStatus = status && status >= 400 ? status : 500;
    return res.status(httpStatus).json({ status: 'error', code, message: msg });
  }
});

// Comentado: middlewares e rotas duplicadas adicionadas no final
// app.use("/admin", requireRole("admin"));
// app.use("/bridge", requireRole("admin"));
// app.post("/channels", requireEditorOrAdmin, async (req, res) => { /* duplicado */ });
// app.post("/publish", requireEditorOrAdmin, async (req, res) => { /* duplicado */ });