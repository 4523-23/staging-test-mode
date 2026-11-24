import { FirebaseApp, initializeApp } from 'firebase/app';
import {
  Auth,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { Firestore, getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import bundledProdConfig from '../../firebase-applet-config.json';
import { BRAND_CONFIG } from '../config/brand';

export interface FirebaseWebConfig {
  projectId?: string;
  appId?: string;
  apiKey?: string;
  authDomain?: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
}

export interface ExvisRuntimeConfig {
  appEnv?: 'production' | 'staging';
  isStaging?: boolean;
  paystackConnected?: boolean;
  paystackMode?: 'live' | 'test' | null;
  isTestMode?: boolean;
  firebaseConfigured?: boolean;
  firebaseConfig?: FirebaseWebConfig | null;
}

declare const __EXVIS_IS_STAGING_BUILD__: boolean | undefined;

declare global {
  interface Window {
    __EXVIS_RUNTIME_CONFIG__?: ExvisRuntimeConfig;
  }
}

function readRuntimeConfig(): ExvisRuntimeConfig {
  if (typeof window !== 'undefined' && window.__EXVIS_RUNTIME_CONFIG__) {
    return window.__EXVIS_RUNTIME_CONFIG__;
  }
  return {};
}

function readEnvFirebaseConfig(): FirebaseWebConfig {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    projectId: env.VITE_FIREBASE_PROJECT_ID?.trim() || undefined,
    appId: env.VITE_FIREBASE_APP_ID?.trim() || undefined,
    apiKey: env.VITE_FIREBASE_API_KEY?.trim() || undefined,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || undefined,
    firestoreDatabaseId: env.VITE_FIREBASE_DATABASE_ID?.trim() || undefined,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET?.trim() || undefined,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() || undefined,
    measurementId: env.VITE_FIREBASE_MEASUREMENT_ID?.trim() || undefined,
  };
}

const runtimeConfig = readRuntimeConfig();
const envAppMode = (import.meta.env.VITE_APP_ENV as string | undefined)?.trim().toLowerCase();
const isStagingBuild = typeof __EXVIS_IS_STAGING_BUILD__ !== 'undefined' && __EXVIS_IS_STAGING_BUILD__;

export const isStagingEnv = Boolean(
  runtimeConfig.isStaging ||
    runtimeConfig.appEnv === 'staging' ||
    isStagingBuild ||
    envAppMode === 'staging'
);

function resolveFirebaseConfig(): FirebaseWebConfig {
  const rtCfg = runtimeConfig.firebaseConfig;
  if (rtCfg && rtCfg.apiKey && rtCfg.projectId && rtCfg.appId) {
    return rtCfg;
  }

  const envCfg = readEnvFirebaseConfig();
  if (envCfg.apiKey && envCfg.projectId && envCfg.appId) {
    return envCfg;
  }

  // Staging builds/environments NEVER fall back to production firebase-applet-config.json
  if (isStagingEnv) {
    return {};
  }

  const prodCfg = bundledProdConfig as FirebaseWebConfig;
  if (prodCfg && prodCfg.apiKey && prodCfg.projectId && prodCfg.appId) {
    return prodCfg;
  }

  return {};
}

const resolvedFirebaseConfig = resolveFirebaseConfig();

export const isFirebaseConfigured = Boolean(
  resolvedFirebaseConfig.apiKey && resolvedFirebaseConfig.projectId && resolvedFirebaseConfig.appId
);
export const activeFirebaseProjectId = resolvedFirebaseConfig.projectId || '';
export const initialRuntimeConfig = runtimeConfig;

let app: FirebaseApp | null = null;
export let db: Firestore | null = null;
export let auth: Auth | null = null;

if (isFirebaseConfigured) {
  app = initializeApp({
    apiKey: resolvedFirebaseConfig.apiKey,
    authDomain: resolvedFirebaseConfig.authDomain,
    projectId: resolvedFirebaseConfig.projectId,
    storageBucket: resolvedFirebaseConfig.storageBucket,
    messagingSenderId: resolvedFirebaseConfig.messagingSenderId,
    appId: resolvedFirebaseConfig.appId,
    ...(resolvedFirebaseConfig.measurementId ? { measurementId: resolvedFirebaseConfig.measurementId } : {}),
  });
  const firestoreDatabaseId = resolvedFirebaseConfig.firestoreDatabaseId?.trim();
  db = firestoreDatabaseId ? getFirestore(app, firestoreDatabaseId) : getFirestore(app);
  auth = getAuth(app);
}

export const googleProvider = new GoogleAuthProvider();

export const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];
const producerGoogleProvider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  producerGoogleProvider.addScope(scope);
}

export const PRODUCER_ADMIN_EMAIL = BRAND_CONFIG.producerEmail;

// In-memory cache only for Google Workspace OAuth access token (never persisted in localStorage/sessionStorage)
let cachedGmailAccessToken: string | null = null;
const tokenListeners = new Set<(token: string | null) => void>();

function notifyTokenListeners() {
  for (const listener of tokenListeners) {
    listener(cachedGmailAccessToken);
  }
}

if (auth) {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedGmailAccessToken = null;
      notifyTokenListeners();
    }
  });
}

export function subscribeGmailToken(listener: (token: string | null) => void): () => void {
  tokenListeners.add(listener);
  listener(cachedGmailAccessToken);
  return () => {
    tokenListeners.delete(listener);
  };
}

export function getGmailAccessToken(): string | null {
  return cachedGmailAccessToken;
}

export function clearGmailAccessToken(): void {
  cachedGmailAccessToken = null;
  notifyTokenListeners();
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = auth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  if (!db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();

export async function signInWithGoogle() {
  if (!auth) {
    throw new Error(
      isStagingEnv
        ? 'Staging Firebase is not configured yet. Add FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_APP_ID, and FIREBASE_AUTH_DOMAIN in Render staging environment variables.'
        : 'Firebase authentication is not configured.'
    );
  }
  googleProvider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, googleProvider);
}

export async function signInProducerWithGmail(): Promise<string | null> {
  if (!auth) {
    throw new Error(
      isStagingEnv
        ? 'Staging Firebase is not configured yet. Add FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_APP_ID, and FIREBASE_AUTH_DOMAIN in Render staging environment variables.'
        : 'Firebase authentication is not configured.'
    );
  }
  producerGoogleProvider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, producerGoogleProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  cachedGmailAccessToken = credential?.accessToken || null;
  notifyTokenListeners();
  return cachedGmailAccessToken;
}

export async function signOutAccount() {
  cachedGmailAccessToken = null;
  notifyTokenListeners();
  if (!auth) return;
  return signOut(auth);
}

export function isProducerAdminEmail(email?: string | null, emailVerified?: boolean): boolean {
  return Boolean(email && email.toLowerCase() === PRODUCER_ADMIN_EMAIL && emailVerified);
}
