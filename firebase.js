// Copyright — todos os direitos reservados a Henrique
// Firebase web bootstrap
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, collection, query, where, onSnapshot, getDocs, doc, getDoc, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getStorage, ref, getDownloadURL, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

// TODO: preencher via environment/hosting headers se possível
const firebaseConfig = {
  apiKey: window.env?.FIREBASE_API_KEY || "",
  authDomain: window.env?.FIREBASE_AUTH_DOMAIN || "",
  projectId: window.env?.FIREBASE_PROJECT_ID || "",
  storageBucket: window.env?.FIREBASE_STORAGE_BUCKET || "",
  appId: window.env?.FIREBASE_APP_ID || ""
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Conectar aos Emulators automaticamente em dev
try {
  const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
  if (isLocal) {
    // Ports from firebase.json emulators
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectStorageEmulator(storage, 'localhost', 9199);
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    console.log('[Firebase] Emulators conectados (Firestore:8080, Storage:9199, Auth:9099)');
  }
} catch (e) {
  console.warn('Falha ao conectar emulators:', e);
}

export const provider = new GoogleAuthProvider();
export async function signin() { await signInWithPopup(auth, provider); }
export async function signout() { await signOut(auth); }
export function watchAuth(cb) { return onAuthStateChanged(auth, cb); }

export async function getUserRoles(uid) {
  if (!uid) return [];
  try {
    const uref = doc(db, "users", uid);
    const usnap = await getDoc(uref);
    const roles = usnap.exists() ? (usnap.data().roles || []) : [];
    return roles;
  } catch (e) { return []; }
}