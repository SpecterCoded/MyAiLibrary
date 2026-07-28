import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

export function normalizeFirebaseConfigValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

const firebaseConfig: FirebaseOptions = {
  apiKey: normalizeFirebaseConfigValue(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: normalizeFirebaseConfigValue(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: normalizeFirebaseConfigValue(import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: normalizeFirebaseConfigValue(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: normalizeFirebaseConfigValue(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: normalizeFirebaseConfigValue(import.meta.env.VITE_FIREBASE_APP_ID),
};

const requiredConfig = [
  ['VITE_FIREBASE_API_KEY', firebaseConfig.apiKey],
  ['VITE_FIREBASE_AUTH_DOMAIN', firebaseConfig.authDomain],
  ['VITE_FIREBASE_PROJECT_ID', firebaseConfig.projectId],
  ['VITE_FIREBASE_STORAGE_BUCKET', firebaseConfig.storageBucket],
  ['VITE_FIREBASE_MESSAGING_SENDER_ID', firebaseConfig.messagingSenderId],
  ['VITE_FIREBASE_APP_ID', firebaseConfig.appId],
] as const;

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firestore: Firestore | null = null;

function missingFirebaseConfig(): string[] {
  return requiredConfig
    .filter(([, value]) => typeof value !== 'string' || value.trim().length === 0)
    .map(([name]) => name);
}

function getFirebaseApp(): FirebaseApp {
  const missing = missingFirebaseConfig();
  if (missing.length > 0) {
    throw new Error(
      `Authentication is unavailable because this build is missing Firebase configuration (${missing.join(', ')}).`,
    );
  }

  if (!firebaseApp) {
    firebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);
  }
  return firebaseApp;
}

export function isFirebaseConfigured(): boolean {
  return missingFirebaseConfig().length === 0;
}

export function getFirebaseAuth(): Auth {
  if (!firebaseAuth) firebaseAuth = getAuth(getFirebaseApp());
  return firebaseAuth;
}

export function getFirebaseDb(): Firestore {
  if (!firestore) firestore = getFirestore(getFirebaseApp());
  return firestore;
}
