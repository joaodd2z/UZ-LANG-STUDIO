// web/firebase.js  (CDN – app estático)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut,
  connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore, doc, getDoc,
  connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getStorage,
  connectStorageEmulator
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";
import {
  getAnalytics, isSupported as isAnalyticsSupported
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-analytics.js";

// === SUA CONFIG DO CONSOLE ===
const firebaseConfig = {
  apiKey: "AIzaSyBr7yRIyZZiQhIH0SMhlik-aJ6NZ1fWQLk",
  authDomain: "uz-lang-studio.firebaseapp.com",
  projectId: "uz-lang-studio",
  // use o domínio clássico do bucket para evitar erro no SDK web:
  storageBucket: "uz-lang-studio.appspot.com",
  appId: "1:660818120099:web:699baf23f4ca3f3ec0de16",
  messagingSenderId: "660818120099",
  measurementId: "G-DMYB8NR9XQ"
};

// Init
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const provider = new GoogleAuthProvider();

// Emuladores no dev
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  const host = location.hostname; // preserva o host atual
  try { connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true }); } catch {}
  try { connectFirestoreEmulator(db, host, 8080); } catch {}
  try { connectStorageEmulator(storage, host, 9199); } catch {}
  console.log(`[Firebase] Emulators conectados em ${host} (Auth:9099, Firestore:8080, Storage:9199)`);
}

// Helpers de auth
export async function signin() {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.warn("Popup falhou, tentando redirect...", err?.message);
    await signInWithRedirect(auth, provider);
  }
}
export async function signout() { await signOut(auth); }
export function watchAuth(cb) { return onAuthStateChanged(auth, cb); }

// Roles (Firestore)
export async function getUserRoles(uid) {
  if (!uid) return [];
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? (snap.data().roles || []) : [];
  } catch { return []; }
}

// Login de dev (emulador) por email/senha
export async function devSignin(email, password) {
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    if (e && e.code === "auth/user-not-found") {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      throw e;
    }
  }
}

// Analytics opcional
isAnalyticsSupported().then((ok) => { if (ok) try { getAnalytics(app); } catch {} });
