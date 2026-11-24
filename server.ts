import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { BRAND_CONFIG } from './src/config/brand.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const EXPLICIT_APP_ENV = (process.env.APP_ENV || process.env.VITE_APP_ENV || '').trim().toLowerCase();
const IS_STAGING = EXPLICIT_APP_ENV === 'staging';
const APP_ENV: 'staging' | 'production' = IS_STAGING ? 'staging' : 'production';
const USD_TO_GHS = 15.8;

const ROOT_DIR = process.cwd();
const PERSISTENT_STORAGE_ROOT = process.env.PERSISTENT_STORAGE_DIR?.trim()
  ? path.resolve(process.env.PERSISTENT_STORAGE_DIR.trim())
  : ROOT_DIR;
const DATA_DIR = process.env.DATA_DIR?.trim()
  ? path.resolve(process.env.DATA_DIR.trim())
  : path.join(PERSISTENT_STORAGE_ROOT, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR?.trim()
  ? path.resolve(process.env.UPLOADS_DIR.trim())
  : path.join(PERSISTENT_STORAGE_ROOT, 'uploads');
const UPLOADS_REAL_ROOT = path.resolve(UPLOADS_DIR);
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const STORE_BACKUP_FILE = path.join(DATA_DIR, 'store.backup.json');
const STORE_TMP_FILE = path.join(DATA_DIR, 'store.json.tmp');
const PRODUCER_ADMIN_EMAIL = BRAND_CONFIG.producerEmail.toLowerCase();
const STUDIO_DOMAIN = BRAND_CONFIG.domain;
const BRAND_NAME = BRAND_CONFIG.brandName;
const STUDIO_PORTAL_NAME = BRAND_CONFIG.studioPortalName;
const BRAND_FILE_PREFIX = BRAND_NAME.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Studio';

interface FirebaseClientConfig {
  projectId?: string;
  appId?: string;
  apiKey?: string;
  authDomain?: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
}

function resolveServerFirebaseConfig(): FirebaseClientConfig {
  const jsonEnv = process.env.FIREBASE_CONFIG_JSON?.trim();
  if (jsonEnv) {
    try {
      const parsed = JSON.parse(jsonEnv) as FirebaseClientConfig;
      if (parsed.apiKey && parsed.projectId && parsed.appId) {
        return parsed;
      }
    } catch {
      console.warn('[firebase] Invalid FIREBASE_CONFIG_JSON format; ignoring.');
    }
  }

  const envCfg: FirebaseClientConfig = {
    projectId: (process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '').trim() || undefined,
    appId: (process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || '').trim() || undefined,
    apiKey: (process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '').trim() || undefined,
    authDomain: (process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim() || undefined,
    firestoreDatabaseId: (process.env.FIREBASE_DATABASE_ID || process.env.VITE_FIREBASE_DATABASE_ID || '').trim() || undefined,
    storageBucket: (process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim() || undefined,
    messagingSenderId: (process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim() || undefined,
    measurementId: (process.env.FIREBASE_MEASUREMENT_ID || process.env.VITE_FIREBASE_MEASUREMENT_ID || '').trim() || undefined,
  };

  if (envCfg.apiKey && envCfg.projectId && envCfg.appId) {
    return envCfg;
  }

  // Staging NEVER falls back to production firebase-applet-config.json
  if (IS_STAGING) {
    return {};
  }

  try {
    const fbCfgPath = path.join(ROOT_DIR, 'firebase-applet-config.json');
    if (fs.existsSync(fbCfgPath)) {
      const fbCfg = JSON.parse(fs.readFileSync(fbCfgPath, 'utf-8')) as FirebaseClientConfig;
      return {
        projectId: fbCfg.projectId,
        appId: fbCfg.appId,
        apiKey: fbCfg.apiKey,
        authDomain: fbCfg.authDomain,
        firestoreDatabaseId: fbCfg.firestoreDatabaseId,
        storageBucket: fbCfg.storageBucket,
        messagingSenderId: fbCfg.messagingSenderId,
        measurementId: fbCfg.measurementId,
      };
    }
  } catch {
    // Ignore read errors
  }

  return {};
}

const SERVER_FIREBASE_CONFIG = resolveServerFirebaseConfig();
const FIREBASE_WEB_API_KEY = SERVER_FIREBASE_CONFIG.apiKey || '';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export interface BeatRecord {
  id: string;
  title: string;
  genre: 'Afrobeats' | 'Amapiano' | 'Trap' | 'Drill' | 'UK Drill' | 'Hip-Hop' | 'R&B' | 'Dancehall';
  bpm: number;
  musicalKey: string;
  durationSec: number;
  mood: string;
  coverUrl: string;
  audioUrl: string;
  wavUrl?: string;
  stemsUrl?: string;
  mp3Price: number;
  wavPrice: number;
  stemsPrice: number;
  exclusivePrice: number;
  plays: number;
  published: boolean;
  producerUid: string;
  createdAtIso: string;
}

export interface ServerOrderItem {
  id: string;
  beatId: string;
  beatTitle: string;
  licenseTier: 'mp3' | 'wav' | 'stems' | 'exclusive';
  price: number;
  licenseCode: string;
  audioUrl: string;
  wavUrl?: string;
  stemsUrl?: string;
}

export interface ServerOrder {
  id: string;
  buyerUid: string;
  buyerName: string;
  buyerEmail: string;
  paymentMethod: 'mastercard' | 'mtn_momo';
  paymentDetailMasked: string;
  paymentReference: string;
  totalAmount: number;
  currency: 'USD' | 'GHS';
  usdEquivalent: number;
  status: 'pending' | 'completed';
  downloadToken?: string;
  downloadExpiresAtIso?: string;
  emailDeliveryStatus?: 'pending' | 'awaiting_payment_confirmation' | 'sent' | 'smtp_not_configured' | 'failed';
  emailDeliveryMessage?: string;
  emailSentAtIso?: string;
  paidAtIso?: string;
  confirmedBy?: string;
  isTestMode?: boolean;
  items: ServerOrderItem[];
  createdAtIso: string;
}

export interface ServerPayoutConfig {
  id: string;
  methodType: 'bank_mastercard' | 'mtn_momo';
  accountLabel: string;
  accountHolderName: string;
  institutionOrNetwork: string;
  maskedIdentifier: string;
  currency: 'USD' | 'GHS';
  country: string;
  isDefault: boolean;
  updatedAtIso: string;
}

export interface ServerPayoutRequest {
  id: string;
  methodType: 'bank_mastercard' | 'mtn_momo';
  destinationSummary: string;
  amountUsd: number;
  currency: 'USD' | 'GHS';
  referenceCode: string;
  status: 'processing' | 'settled';
  createdAtIso: string;
}

interface StoreData {
  beats: BeatRecord[];
  orders: ServerOrder[];
  payoutConfigs: ServerPayoutConfig[];
  payoutRequests: ServerPayoutRequest[];
}

const STARTER_BEATS: BeatRecord[] = [];

function normalizeStoreData(parsed: Partial<StoreData>): StoreData {
  return {
    beats: Array.isArray(parsed.beats) ? parsed.beats : [],
    orders: Array.isArray(parsed.orders) ? parsed.orders : [],
    payoutConfigs: Array.isArray(parsed.payoutConfigs) ? parsed.payoutConfigs : [],
    payoutRequests: Array.isArray(parsed.payoutRequests) ? parsed.payoutRequests : [],
  };
}

function readStore(): StoreData {
  if (!fs.existsSync(STORE_FILE)) {
    if (fs.existsSync(STORE_BACKUP_FILE)) {
      try {
        const backupRaw = fs.readFileSync(STORE_BACKUP_FILE, 'utf-8');
        const restored = normalizeStoreData(JSON.parse(backupRaw) as Partial<StoreData>);
        writeStore(restored);
        return restored;
      } catch {
        // Ignore corrupt backup and initialize clean store
      }
    }
    const initial: StoreData = {
      beats: [],
      orders: [],
      payoutConfigs: [],
      payoutRequests: [],
    };
    writeStore(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf-8');
    return normalizeStoreData(JSON.parse(raw) as Partial<StoreData>);
  } catch (err) {
    console.error('[store] Primary store.json read failed, attempting backup recovery:', err instanceof Error ? err.message : err);
    if (fs.existsSync(STORE_BACKUP_FILE)) {
      try {
        const backupRaw = fs.readFileSync(STORE_BACKUP_FILE, 'utf-8');
        return normalizeStoreData(JSON.parse(backupRaw) as Partial<StoreData>);
      } catch {
        // Fall back to empty store
      }
    }
    return {
      beats: [],
      orders: [],
      payoutConfigs: [],
      payoutRequests: [],
    };
  }
}

function writeStore(data: StoreData): void {
  const serialized = JSON.stringify(data, null, 2);
  fs.writeFileSync(STORE_TMP_FILE, serialized, 'utf-8');
  fs.renameSync(STORE_TMP_FILE, STORE_FILE);
  try {
    fs.writeFileSync(STORE_BACKUP_FILE, serialized, 'utf-8');
  } catch (err) {
    console.warn('[store] Failed to update store.backup.json:', err instanceof Error ? err.message : err);
  }
}

// Synthesizes a clean, multi-layered 16-bit PCM WAV buffer tailored to beat BPM/genre
const synthCache = new Map<string, Buffer>();

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function generateBeatWav(beat: BeatRecord): Buffer {
  const cached = synthCache.get(beat.id);
  if (cached) return cached;

  const sampleRate = 22050;
  const durationSec = 24;
  const totalSamples = sampleRate * durationSec;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = totalSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const bpm = beat.bpm || 110;
  const stepSec = 60 / bpm / 4; // 16th note duration
  const totalSteps = Math.floor(durationSec / stepSec);

  // Choose scale root based on key string
  const keyMap: Record<string, number> = {
    'C# Min': 49,
    'D Min': 50,
    'Eb Maj': 51,
    'F# Min': 54,
    'G Min': 55,
    'A Min': 57,
  };
  const rootMidi = keyMap[beat.musicalKey] ?? 54;
  const minorIntervals = [0, 2, 3, 5, 7, 8, 10, 12];
  const majorIntervals = [0, 2, 4, 5, 7, 9, 11, 12];
  const scale = beat.musicalKey.includes('Maj') ? majorIntervals : minorIntervals;

  // Genre-specific drum patterns (16 steps)
  const isAfro = beat.genre === 'Afrobeats' || beat.genre === 'Dancehall';
  const isAmapiano = beat.genre === 'Amapiano';
  const isDrill = beat.genre === 'Drill';

  const kickSteps = isAfro
    ? new Set([0, 3, 6, 8, 11, 14])
    : isAmapiano
      ? new Set([0, 4, 8, 12])
      : isDrill
        ? new Set([0, 6, 10])
        : new Set([0, 3, 10]);

  const snareSteps = isAfro
    ? new Set([3, 6, 12, 14])
    : isDrill
      ? new Set([4, 14])
      : new Set([4, 12]);

  const hatSteps = isAmapiano
    ? new Set([2, 6, 10, 14, 15])
    : new Set([0, 2, 4, 6, 8, 10, 12, 13, 14, 15]);

  const chordProgression = [0, 5, 3, 4]; // i - VI - iv - v

  // Pre-render into float buffer then normalize
  const samples = new Float32Array(totalSamples);

  // Deterministic pseudo-random for crisp hi-hat/snare texture
  let seed = 1337;
  const nextRand = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return (seed / 4294967296) * 2 - 1;
  };

  for (let step = 0; step < totalSteps; step++) {
    const stepInBar = step % 16;
    const bar = Math.floor(step / 16);
    const startSample = Math.floor(step * stepSec * sampleRate);

    // Kick / 808
    if (kickSteps.has(stepInBar)) {
      const kickLen = Math.floor(sampleRate * (isDrill || beat.genre === 'Trap' ? 0.34 : 0.22));
      for (let j = 0; j < kickLen && startSample + j < totalSamples; j++) {
        const t = j / sampleRate;
        const freq = 48 + 115 * Math.exp(-t * 28);
        const env = Math.exp(-t * (isDrill || beat.genre === 'Trap' ? 6.5 : 11));
        samples[startSample + j] += Math.sin(2 * Math.PI * freq * t) * env * 0.55;
      }
    }

    // Snare / Rimshot
    if (snareSteps.has(stepInBar)) {
      const snLen = Math.floor(sampleRate * 0.14);
      for (let j = 0; j < snLen && startSample + j < totalSamples; j++) {
        const t = j / sampleRate;
        const tone = Math.sin(2 * Math.PI * (isAfro ? 340 : 190) * t) * Math.exp(-t * 24);
        const noise = nextRand() * Math.exp(-t * 22);
        samples[startSample + j] += (tone * 0.3 + noise * 0.28);
      }
    }

    // Hi-hat / Shaker
    if (hatSteps.has(stepInBar)) {
      const hatLen = Math.floor(sampleRate * 0.045);
      for (let j = 0; j < hatLen && startSample + j < totalSamples; j++) {
        const t = j / sampleRate;
        const hp = nextRand() - (j > 0 ? nextRand() * 0.5 : 0);
        samples[startSample + j] += hp * Math.exp(-t * 65) * 0.16;
      }
    }

    // Amapiano log drum or sub-bass bounce
    const chordDeg = chordProgression[bar % chordProgression.length];
    const bassNote = rootMidi - 12 + scale[chordDeg % scale.length];
    if (stepInBar === 0 || (isAmapiano && (stepInBar === 6 || stepInBar === 11)) || (!isAmapiano && stepInBar === 10)) {
      const bassLen = Math.floor(sampleRate * 0.28);
      const bassFreq = midiToFreq(bassNote + (stepInBar === 11 ? 7 : 0));
      for (let j = 0; j < bassLen && startSample + j < totalSamples; j++) {
        const t = j / sampleRate;
        const pitchDrop = isAmapiano ? 1 + 0.5 * Math.exp(-t * 35) : 1;
        const env = Math.exp(-t * 7.5);
        samples[startSample + j] += Math.sin(2 * Math.PI * bassFreq * pitchDrop * t) * env * 0.36;
      }
    }

    // Warm electric piano / Rhodes pad on beat 1 of each bar
    if (stepInBar === 0 || stepInBar === 6) {
      const chordLen = Math.floor(sampleRate * stepSec * 5.5);
      const n1 = midiToFreq(rootMidi + 12 + scale[chordDeg % scale.length]);
      const n2 = midiToFreq(rootMidi + 12 + scale[(chordDeg + 2) % scale.length]);
      const n3 = midiToFreq(rootMidi + 12 + scale[(chordDeg + 4) % scale.length]);
      for (let j = 0; j < chordLen && startSample + j < totalSamples; j++) {
        const t = j / sampleRate;
        const attack = Math.min(1, t / 0.015);
        const env = attack * Math.exp(-t * 2.4);
        const chordWave =
          (Math.sin(2 * Math.PI * n1 * t) +
            Math.sin(2 * Math.PI * n2 * t) * 0.8 +
            Math.sin(2 * Math.PI * n3 * t) * 0.7) /
          2.5;
        samples[startSample + j] += chordWave * env * 0.26;
      }
    }

    // Pluck melody motif
    if (stepInBar === 2 || stepInBar === 5 || stepInBar === 9 || stepInBar === 13) {
      const melDeg = (chordDeg + stepInBar) % scale.length;
      const melFreq = midiToFreq(rootMidi + 24 + scale[melDeg]);
      const melLen = Math.floor(sampleRate * 0.2);
      for (let j = 0; j < melLen && startSample + j < totalSamples; j++) {
        const t = j / sampleRate;
        const env = Math.exp(-t * 14);
        const wave = Math.sin(2 * Math.PI * melFreq * t) + 0.3 * Math.sin(4 * Math.PI * melFreq * t);
        samples[startSample + j] += wave * env * 0.14;
      }
    }
  }

  // Soft limiter & write 16-bit PCM
  for (let i = 0; i < totalSamples; i++) {
    const s = Math.tanh(samples[i] * 0.95);
    const int16 = Math.max(-32767, Math.min(32767, Math.round(s * 32767)));
    buffer.writeInt16LE(int16, 44 + i * 2);
  }

  synthCache.set(beat.id, buffer);
  return buffer;
}

const DOWNLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function makeDownloadExpiryIso(): string {
  return new Date(Date.now() + DOWNLOAD_TTL_MS).toISOString();
}

function isDownloadExpired(order: ServerOrder): boolean {
  if (!order.downloadExpiresAtIso) return false;
  const expiryMs = Date.parse(order.downloadExpiresAtIso);
  return Number.isFinite(expiryMs) && Date.now() > expiryMs;
}

function resolveItemAssetUrl(item: ServerOrderItem, store: StoreData): string {
  const beat = store.beats.find((b) => b.id === item.beatId);
  if (item.licenseTier === 'stems' || item.licenseTier === 'exclusive') {
    return item.stemsUrl || beat?.stemsUrl || item.wavUrl || beat?.wavUrl || item.audioUrl;
  }
  if (item.licenseTier === 'wav') {
    return item.wavUrl || beat?.wavUrl || item.audioUrl;
  }
  return item.audioUrl;
}

function sanitizeOrderForClient(order: ServerOrder, includeDownloadToken = true): ServerOrder {
  if (order.status === 'completed' && includeDownloadToken) {
    return order;
  }
  const { downloadToken: _hidden, ...rest } = order;
  return {
    ...rest,
    status: order.status === 'completed' ? 'completed' : 'pending',
  };
}

function sanitizeBeatForPublic(beat: BeatRecord) {
  const { wavUrl, stemsUrl, ...rest } = beat;
  return {
    ...rest,
    hasWavMaster: Boolean(wavUrl),
    hasTrackoutStems: Boolean(stemsUrl),
  };
}

function resolveUploadPath(rawFilename: string): { safeName: string; fullPath: string } | null {
  let decoded = rawFilename;
  try {
    decoded = decodeURIComponent(rawFilename);
  } catch {
    return null;
  }
  const safeName = path.basename(decoded);
  if (!safeName || safeName === '.' || safeName === '..' || safeName.startsWith('.chunk_')) {
    return null;
  }
  const resolved = path.resolve(UPLOADS_REAL_ROOT, safeName);
  if (!resolved.startsWith(`${UPLOADS_REAL_ROOT}${path.sep}`)) {
    return null;
  }
  return { safeName, fullPath: resolved };
}

function resolveAuthoritativeOrderItems(
  rawItems: Array<{
    beatId: string;
    beatTitle?: string;
    licenseTier: 'mp3' | 'wav' | 'stems' | 'exclusive';
    price?: number;
    audioUrl?: string;
    wavUrl?: string;
    stemsUrl?: string;
  }>,
  store: StoreData,
  orderId: string
): { ok: true; items: ServerOrderItem[]; usdTotal: number } | { ok: false; error: string } {
  const items: ServerOrderItem[] = [];
  let usdTotal = 0;

  for (let idx = 0; idx < rawItems.length; idx++) {
    const reqItem = rawItems[idx];
    const beat = store.beats.find((b) => b.id === reqItem.beatId);
    if (!beat) {
      return {
        ok: false,
        error: `Beat "${reqItem.beatTitle || reqItem.beatId}" is no longer available in the catalog.`,
      };
    }
    if (!beat.published) {
      return {
        ok: false,
        error: `"${beat.title}" is currently unavailable (sold exclusively or unpublished).`,
      };
    }

    const tier: ServerOrderItem['licenseTier'] =
      reqItem.licenseTier === 'mp3' ||
      reqItem.licenseTier === 'wav' ||
      reqItem.licenseTier === 'stems' ||
      reqItem.licenseTier === 'exclusive'
        ? reqItem.licenseTier
        : 'wav';

    const price =
      tier === 'mp3'
        ? beat.mp3Price
        : tier === 'wav'
          ? beat.wavPrice
          : tier === 'stems'
            ? beat.stemsPrice
            : beat.exclusivePrice;

    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, error: `Invalid license pricing configured for "${beat.title}".` };
    }

    usdTotal += price;
    items.push({
      id: `${orderId}_${idx + 1}`,
      beatId: beat.id,
      beatTitle: beat.title,
      licenseTier: tier,
      price,
      licenseCode: `LIC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      audioUrl: beat.audioUrl,
      wavUrl: beat.wavUrl,
      stemsUrl: beat.stemsUrl,
    });
  }

  return { ok: true, items, usdTotal: Math.round(usdTotal * 100) / 100 };
}

function unpublishExclusiveBeats(order: ServerOrder, store: StoreData): string[] {
  const unpublishedIds: string[] = [];
  for (const item of order.items) {
    if (item.licenseTier === 'exclusive') {
      const beat = store.beats.find((b) => b.id === item.beatId);
      if (beat && beat.published) {
        beat.published = false;
        unpublishedIds.push(beat.id);
      }
    }
  }
  return unpublishedIds;
}

async function verifyFirebaseUser(
  req: Request
): Promise<
  | { ok: true; uid: string; email: string; emailVerified: boolean }
  | { ok: false; status: number; error: string }
> {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const idToken = match?.[1]?.trim();
  if (!idToken) {
    return {
      ok: false,
      status: 401,
      error: `Authentication required. Please sign in.`,
    };
  }
  if (!FIREBASE_WEB_API_KEY) {
    return {
      ok: false,
      status: 503,
      error: IS_STAGING
        ? 'Staging Firebase authentication is not configured yet.'
        : 'Firebase API key not configured on server.',
    };
  }

  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) {
      return { ok: false, status: 401, error: 'Invalid or expired Firebase session.' };
    }
    const payload = (await resp.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    };
    const account = payload.users?.[0];
    if (!account?.email) {
      return { ok: false, status: 401, error: 'Unable to identify authenticated user.' };
    }
    return {
      ok: true,
      uid: account.localId || '',
      email: account.email,
      emailVerified: account.emailVerified === true,
    };
  } catch {
    return { ok: false, status: 500, error: 'Unable to verify authentication session.' };
  }
}

async function verifyProducerAdmin(
  req: Request
): Promise<{ ok: true; email: string } | { ok: false; status: number; error: string }> {
  const userCheck = await verifyFirebaseUser(req);
  if (!userCheck.ok) {
    return userCheck;
  }
  if (userCheck.email.toLowerCase() !== PRODUCER_ADMIN_EMAIL || !userCheck.emailVerified) {
    return {
      ok: false,
      status: 403,
      error: `Only verified producer (${PRODUCER_ADMIN_EMAIL}) is authorized for ${STUDIO_PORTAL_NAME}.`,
    };
  }
  return { ok: true, email: userCheck.email };
}

function getAppOrigin(req: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured && configured !== 'MY_APP_URL' && /^https?:\/\//i.test(configured)) {
    return configured.replace(/\/+$/, '');
  }
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = typeof protoHeader === 'string' ? protoHeader.split(',')[0].trim() : req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host') || `localhost:${PORT}`;
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function isOrderOrServerTestMode(order?: Pick<ServerOrder, 'isTestMode'>): boolean {
  const key = process.env.PAYSTACK_SECRET_KEY?.trim() || '';
  return Boolean(order?.isTestMode || IS_STAGING || key.startsWith('sk_test_'));
}

function buildLicenseText(order: ServerOrder, item: ServerOrderItem, isTestMode = isOrderOrServerTestMode(order)): string {
  const issuedAt = order.paidAtIso || order.createdAtIso;
  const activeSiteUrl =
    process.env.APP_URL?.trim() && process.env.APP_URL.trim() !== 'MY_APP_URL'
      ? process.env.APP_URL.trim().replace(/\/+$/, '')
      : BRAND_CONFIG.websiteUrl;
  const rightsMap: Record<string, string> = {
    mp3: `MP3 License (Non-Exclusive) · 320kbps MP3 · Up to 50,000 commercial streams · 1 Music Video · No Content ID registration permitted · Credit required: "${BRAND_CONFIG.licenseCreditText}"`,
    wav: `WAV License (Non-Exclusive) · 24-bit WAV + MP3 · Up to 250,000 commercial streams · Unlimited Music Videos · Commercial Radio · No Content ID registration permitted · Credit required: "${BRAND_CONFIG.licenseCreditText}"`,
    stems: `Trackout License (Non-Exclusive) · Multi-track Stems + WAV + MP3 · Unlimited streams & commercial sales · Unlimited Music Videos · No Content ID registration permitted · Credit required: "${BRAND_CONFIG.licenseCreditText}"`,
    exclusive: `Exclusive License · Full Stems + WAV + MP3 · Beat removed from storefront catalog · Full copyright transfer requires a separate written exclusive agreement signed by ${BRAND_NAME}`,
  };

  return [
    '====================================================================',
    isTestMode
      ? `             ${BRAND_NAME.toUpperCase()} — [TEST MODE] OFFICIAL LICENSE            `
      : `                    ${BRAND_NAME.toUpperCase()} — OFFICIAL LICENSE                  `,
    '====================================================================',
    ...(isTestMode
      ? [
          'Environment Notice     : [TEST MODE] Staging/Sandbox transaction — NOT valid for commercial release.',
          '--------------------------------------------------------------------',
        ]
      : []),
    `License Certificate ID : ${item.licenseCode}`,
    `Order Reference        : ${order.id}`,
    `Payment Reference      : ${order.paymentReference}`,
    `Issued Date (UTC)      : ${issuedAt}`,
    `Download Access Expiry : ${order.downloadExpiresAtIso || '7 days from issuance'}`,
    '--------------------------------------------------------------------',
    `Licensor (Producer)    : ${BRAND_NAME} (${PRODUCER_ADMIN_EMAIL})`,
    `Official Website       : ${activeSiteUrl}`,
    `Licensee (Artist)      : ${order.buyerName} (${order.buyerEmail})`,
    `Beat Title             : ${item.beatTitle}`,
    `License Tier           : ${item.licenseTier.toUpperCase()}`,
    `Granted Rights         : ${rightsMap[item.licenseTier] || rightsMap.wav}`,
    '--------------------------------------------------------------------',
    'This certificate verifies licensing clearance under the selected',
    `${BRAND_NAME} tier upon settled payment. Non-exclusive licenses prohibit`,
    'YouTube/audio Content ID claims. Exclusive copyright ownership is',
    'transferred only under a separate written exclusive agreement.',
    '====================================================================',
  ].join('\n');
}

interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

function collectOrderAttachments(
  order: ServerOrder,
  store: StoreData,
  isTestMode = isOrderOrServerTestMode(order)
): EmailAttachment[] {
  const attachments: EmailAttachment[] = [];
  let totalAudioBytes = 0;
  const MAX_AUDIO_EMAIL_BYTES = 14 * 1024 * 1024; // Stay safely under Gmail's 25MB base64 raw limit

  for (const item of order.items) {
    // Always attach the license agreement certificate
    attachments.push({
      filename: `${BRAND_FILE_PREFIX}${isTestMode ? '_TEST_MODE' : ''}_License_${item.licenseCode}.txt`,
      contentType: 'text/plain; charset=utf-8',
      content: Buffer.from(buildLicenseText(order, item, isTestMode), 'utf-8'),
    });

    const safeBeatTitle = item.beatTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanAudioUrl = resolveItemAssetUrl(item, store).split('?')[0];

    if (cleanAudioUrl.startsWith('/api/audio/file/')) {
      const encodedName = cleanAudioUrl.replace('/api/audio/file/', '');
      const resolved = resolveUploadPath(encodedName);
      if (resolved && fs.existsSync(resolved.fullPath)) {
        const stat = fs.statSync(resolved.fullPath);
        if (totalAudioBytes + stat.size <= MAX_AUDIO_EMAIL_BYTES) {
          const ext = path.extname(resolved.safeName).toLowerCase() || '.mp3';
          const mime = getAudioMimeType(ext);
          attachments.push({
            filename: `${BRAND_FILE_PREFIX}_${safeBeatTitle}_${item.licenseTier.toUpperCase()}${ext}`,
            contentType: mime,
            content: fs.readFileSync(resolved.fullPath),
          });
          totalAudioBytes += stat.size;
        }
      }
    } else if (cleanAudioUrl.startsWith('/api/audio/synth/')) {
      const beatId = cleanAudioUrl.replace('/api/audio/synth/', '');
      const beat = store.beats.find((b) => b.id === beatId) || {
        id: beatId,
        title: item.beatTitle,
        genre: 'Afrobeats' as const,
        bpm: 110,
        musicalKey: 'F# Min',
        durationSec: 24,
        mood: 'Studio Mastered',
        coverUrl: '/src/assets/images/cover_afro_gold_1795108750721.jpg',
        audioUrl: cleanAudioUrl,
        mp3Price: item.price,
        wavPrice: item.price,
        stemsPrice: item.price,
        exclusivePrice: item.price,
        plays: 0,
        published: true,
        producerUid: 'exvis_studio_master',
        createdAtIso: order.createdAtIso,
      };
      const wavBuffer = generateBeatWav(beat);
      if (totalAudioBytes + wavBuffer.length <= MAX_AUDIO_EMAIL_BYTES) {
        attachments.push({
          filename: `${BRAND_FILE_PREFIX}_${safeBeatTitle}_${item.licenseTier.toUpperCase()}.wav`,
          contentType: 'audio/wav',
          content: wavBuffer,
        });
        totalAudioBytes += wavBuffer.length;
      }
    }
  }

  return attachments;
}

function wrapBase64(buf: Buffer): string {
  const b64 = buf.toString('base64');
  return b64.match(/.{1,76}/g)?.join('\r\n') || '';
}

function buildRawMimeMessage(params: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
}): string {
  const mixedBoundary = `exvis_mixed_${crypto.randomBytes(8).toString('hex')}`;
  const altBoundary = `exvis_alt_${crypto.randomBytes(8).toString('hex')}`;

  const lines: string[] = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(params.subject, 'utf-8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(params.text, 'utf-8')),
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(params.html, 'utf-8')),
    '',
    `--${altBoundary}--`,
  ];

  for (const att of params.attachments) {
    lines.push(
      `--${mixedBoundary}`,
      `Content-Type: ${att.contentType}; name="${att.filename}"`,
      `Content-Disposition: attachment; filename="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(att.content)
    );
  }

  lines.push(`--${mixedBoundary}--`, '');
  return lines.join('\r\n');
}

async function sendOrderDeliveryEmail(
  order: ServerOrder,
  originUrl: string,
  store: StoreData,
  gmailAccessToken?: string
): Promise<{
  status: 'sent' | 'smtp_not_configured' | 'failed';
  message: string;
  sentAtIso?: string;
  needsGmailReconnect?: boolean;
}> {
  const token = order.downloadToken || '';
  const libraryUrl = `${originUrl}/?order=${encodeURIComponent(order.id)}&token=${encodeURIComponent(token)}`;
  const itemLinesText = order.items
    .map(
      (item) =>
        `- ${item.beatTitle} (${item.licenseTier.toUpperCase()} · Code: ${item.licenseCode})\n  Download Beat: ${originUrl}/api/downloads/${order.id}/${item.id}?token=${encodeURIComponent(token)}\n  License Agreement: ${originUrl}/api/licenses/${order.id}/${item.id}?token=${encodeURIComponent(token)}`
    )
    .join('\n\n');

  const itemRowsHtml = order.items
    .map(
      (item) => `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #27272A;">
            <div style="font-size:15px;font-weight:600;color:#F5F4F0;">${item.beatTitle}</div>
            <div style="font-size:12px;color:#A1A1AA;margin-top:3px;">${item.licenseTier.toUpperCase()} License · Code: ${item.licenseCode}</div>
            <div style="margin-top:10px;">
              <a href="${originUrl}/api/downloads/${order.id}/${item.id}?token=${encodeURIComponent(token)}" style="display:inline-block;padding:8px 14px;background:#D99B38;color:#0B0B0D;text-decoration:none;font-weight:600;font-size:12px;border-radius:6px;margin-right:8px;">Download Beat Audio</a>
              <a href="${originUrl}/api/licenses/${order.id}/${item.id}?token=${encodeURIComponent(token)}" style="display:inline-block;padding:8px 14px;background:#1B1B20;color:#F5F4F0;text-decoration:none;font-weight:500;font-size:12px;border-radius:6px;border:1px solid #3F3F46;">Download License</a>
            </div>
          </td>
        </tr>`
    )
    .join('');

  const expiryText = order.downloadExpiresAtIso
    ? `Time-limited download links are valid until ${new Date(order.downloadExpiresAtIso).toUTCString()}.`
    : 'Download links are time-limited for 7 days.';

  const isTestMode = isOrderOrServerTestMode(order);
  const textBody = [
    ...(isTestMode
      ? [
          '[TEST MODE] STAGING / SANDBOX ORDER CONFIRMATION — NO REAL PAYMENT WAS CHARGED.',
          '',
        ]
      : []),
    `Thank you for purchasing from ${BRAND_NAME}, ${order.buyerName}!`,
    ``,
    `Order ID: ${order.id}`,
    `Payment Reference: ${order.paymentReference} (${order.paymentDetailMasked})`,
    `Total Paid: ${order.currency === 'GHS' ? `GHS ${order.totalAmount.toFixed(2)}` : `$${order.totalAmount.toFixed(2)}`}`,
    ``,
    `Your beat file(s) and license agreement are attached to this email and also available via the direct links below:`,
    expiryText,
    itemLinesText,
    ``,
    `Open Order in Library: ${libraryUrl}`,
    ``,
    `${BRAND_NAME} · ${originUrl} · ${PRODUCER_ADMIN_EMAIL}`,
  ].join('\n');

  const htmlBody = `
    <div style="background:#0B0B0D;color:#F5F4F0;font-family:Inter,Arial,sans-serif;padding:32px 20px;">
      <div style="max-width:580px;margin:0 auto;background:#131316;border:1px solid #27272A;border-radius:12px;padding:28px;">
        ${
          isTestMode
            ? `<div style="margin-bottom:16px;padding:10px 14px;background:#3A280A;border:1px solid #D99B38;border-radius:8px;font-size:12px;color:#FDE68A;"><strong>[TEST MODE]</strong> Staging / Paystack Sandbox receipt — no real payment was charged.</div>`
            : ''
        }
        <p style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#D99B38;font-weight:600;">${isTestMode ? '[TEST MODE] · ' : ''}${BRAND_NAME} · ${IS_STAGING ? 'STAGING' : STUDIO_DOMAIN} · Payment Confirmed</p>
        <h1 style="margin:8px 0 10px;font-size:22px;color:#F5F4F0;">${isTestMode ? '[TEST MODE] ' : ''}Your Beat &amp; License Are Ready</h1>
        <p style="margin:0 0 18px;font-size:14px;color:#A1A1AA;line-height:1.5;">
          Hi ${order.buyerName}, your payment (${order.paymentReference}) has been confirmed by ${BRAND_NAME}. Your beat audio file(s) and license certificate are attached to this email and linked below.
        </p>
        <table style="width:100%;border-collapse:collapse;">
          ${itemRowsHtml}
        </table>
        <div style="margin-top:22px;padding-top:16px;border-top:1px solid #27272A;font-size:12px;color:#A1A1AA;">
          <p style="margin:0 0 6px;">${expiryText}</p>
          <p style="margin:0 0 8px;">Order #${order.id} · Sent to ${order.buyerEmail} · ${IS_STAGING ? originUrl : STUDIO_DOMAIN}</p>
          <a href="${libraryUrl}" style="color:#D99B38;text-decoration:underline;">View Order in My Library</a>
        </div>
      </div>
    </div>
  `;

  const attachments = collectOrderAttachments(order, store, isTestMode);
  const subject = `${isTestMode ? '[TEST MODE] ' : ''}${BRAND_NAME} — Your Beat & License (Order #${order.id})`;

  // 1. Primary automated delivery: Producer's connected Gmail via Gmail API
  if (gmailAccessToken) {
    try {
      const rawMime = buildRawMimeMessage({
        from: `${BRAND_NAME} <${PRODUCER_ADMIN_EMAIL}>`,
        to: order.buyerEmail,
        subject,
        text: textBody,
        html: htmlBody,
        attachments,
      });
      const rawEncoded = Buffer.from(rawMime, 'utf-8').toString('base64url');
      const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gmailAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: rawEncoded }),
      });

      if (gmailRes.ok) {
        return {
          status: 'sent',
          message: `Beat file(s) & license agreement automatically sent via Gmail to ${order.buyerEmail}.`,
          sentAtIso: new Date().toISOString(),
        };
      }

      const errText = await gmailRes.text();
      if (gmailRes.status === 401 || gmailRes.status === 403) {
        return {
          status: 'failed',
          needsGmailReconnect: true,
          message: `Payment confirmed, but your Gmail permission expired. Reconnect Gmail in ${STUDIO_PORTAL_NAME} and click Send Beat Email.`,
        };
      }
      console.error('Gmail API send error:', gmailRes.status, errText);
      return {
        status: 'failed',
        message: `Payment confirmed, but Gmail delivery returned ${gmailRes.status}. Click Send Beat Email to retry.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gmail API error';
      console.error('Gmail API exception:', msg);
      return {
        status: 'failed',
        message: `Payment confirmed, but Gmail delivery failed (${msg}). Click Send Beat Email to retry.`,
      };
    }
  }

  // 2. Fallback: SMTP credentials configured in server environment
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const smtpHost =
    process.env.SMTP_HOST?.trim() ||
    (smtpUser && smtpUser.toLowerCase().endsWith('@gmail.com') ? 'smtp.gmail.com' : '');
  const smtpPort = Number(process.env.SMTP_PORT) || (smtpHost === 'smtp.gmail.com' ? 465 : 587);
  const smtpFrom =
    process.env.SMTP_FROM?.trim() ||
    (smtpUser ? `${BRAND_NAME} <${smtpUser}>` : `${BRAND_NAME} <${PRODUCER_ADMIN_EMAIL}>`);

  if (!smtpHost || !smtpUser || !smtpPass) {
    return {
      status: 'smtp_not_configured',
      message: `Payment confirmed & buyer downloads unlocked for ${order.buyerEmail}. Connect Gmail in ${STUDIO_PORTAL_NAME} or set SMTP env vars for automatic email delivery.`,
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: smtpFrom,
      to: order.buyerEmail,
      subject,
      text: textBody,
      html: htmlBody,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });

    return {
      status: 'sent',
      message: `Beat file(s) & license agreement automatically sent to ${order.buyerEmail}.`,
      sentAtIso: new Date().toISOString(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMTP error';
    console.error('Order email delivery error:', msg);
    return {
      status: 'failed',
      message: `Payment confirmed, but email delivery failed (${msg}). Use Send Beat Email to retry.`,
    };
  }
}

function sendRangeBuffer(req: Request, res: Response, buf: Buffer, contentType: string, downloadFilename?: string): void {
  if (downloadFilename) {
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
  } else {
    res.setHeader('Content-Disposition', 'inline');
  }
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);

  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', buf.length);
    res.status(200).send(buf);
    return;
  }

  const parts = range.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : buf.length - 1;
  if (Number.isNaN(start) || start >= buf.length || end >= buf.length || start > end) {
    res.status(416).setHeader('Content-Range', `bytes */${buf.length}`).end();
    return;
  }

  const chunk = buf.subarray(start, end + 1);
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`);
  res.setHeader('Content-Length', chunk.length);
  res.send(chunk);
}

function sendRangeFile(
  req: Request,
  res: Response,
  fullPath: string,
  contentType: string,
  downloadFilename?: string
): void {
  const stat = fs.statSync(fullPath);
  const totalSize = stat.size;
  if (downloadFilename) {
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
  } else {
    res.setHeader('Content-Disposition', 'inline');
  }
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);

  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', totalSize);
    res.status(200);
    fs.createReadStream(fullPath).pipe(res);
    return;
  }

  const parts = range.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
  if (Number.isNaN(start) || start >= totalSize || end >= totalSize || start > end) {
    res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
    return;
  }

  const chunkSize = end - start + 1;
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
  res.setHeader('Content-Length', chunkSize);
  fs.createReadStream(fullPath, { start, end }).pipe(res);
}

const AUDIO_ALLOWED_EXTS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.aif', '.aiff', '.zip', '.rar'];

function getAudioMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.wav':
      return 'audio/wav';
    case '.ogg':
      return 'audio/ogg';
    case '.m4a':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    case '.flac':
      return 'audio/flac';
    case '.aif':
    case '.aiff':
      return 'audio/aiff';
    case '.zip':
      return 'application/zip';
    case '.rar':
      return 'application/vnd.rar';
    default:
      return 'audio/mpeg';
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp3';
    const safeBase = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    cb(null, `${Date.now()}_${safeBase}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (
      AUDIO_ALLOWED_EXTS.includes(ext) ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files (.mp3, .wav, .ogg, .m4a, .aac, .flac, .aiff) or trackout archives (.zip, .rar) are supported.'));
    }
  },
});

const uploadCover = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    if (allowed.includes(ext) || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (.jpg, .png, .webp) are supported.'));
    }
  },
});

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  function getPaystackSecretKey(): string {
    const key = process.env.PAYSTACK_SECRET_KEY?.trim() || '';
    if (!key || key === 'MY_PAYSTACK_SECRET_KEY') return '';
    return key;
  }

  // Production & staging security headers, search indexing block on staging, and optional HTTPS redirect
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (IS_STAGING) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }

    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    const isHttps = req.secure || forwardedProto === 'https';
    if (IS_PRODUCTION && isHttps) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    const host = (req.get('host') || '').toLowerCase();
    const isLocalHost = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    const isHealthProbe = req.path === '/api/health' || req.path === '/healthz';
    if (IS_PRODUCTION && process.env.FORCE_HTTPS === 'true' && !isHttps && !isLocalHost && !isHealthProbe) {
      res.redirect(301, `https://${host}${req.originalUrl}`);
      return;
    }

    next();
  });

  if (IS_STAGING) {
    app.get('/robots.txt', (_req: Request, res: Response) => {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.type('text/plain').send('User-agent: *\nDisallow: /\n');
    });
  }

  // Lightweight structured API request & error logging (redacts tokens and sensitive headers)
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api')) {
      next();
      return;
    }
    const startedAt = Date.now();
    res.on('finish', () => {
      if (req.path === '/api/health' && res.statusCode < 400) {
        return;
      }
      const elapsedMs = Date.now() - startedAt;
      const logLine = `[api] ${req.method} ${req.path} -> ${res.statusCode} (${elapsedMs}ms)`;
      if (res.statusCode >= 500) {
        console.error(logLine);
      } else if (IS_PRODUCTION || res.statusCode >= 400) {
        console.log(logLine);
      }
    });
    next();
  });

  // Paystack Webhook (HMAC-SHA512 verified against raw body before express.json)
  app.post(
    '/api/paystack/webhook',
    express.raw({ type: 'application/json', limit: '2mb' }),
    async (req: Request, res: Response) => {
      const secretKey = getPaystackSecretKey();
      if (!secretKey) {
        res.status(503).json({ error: 'Paystack webhook not configured.' });
        return;
      }

      const signature = String(req.headers['x-paystack-signature'] || '').trim();
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      if (!signature || rawBody.length === 0) {
        res.status(401).json({ error: 'Missing Paystack webhook signature.' });
        return;
      }

      const expectedSig = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
      const sigBuf = Buffer.from(signature, 'utf-8');
      const expBuf = Buffer.from(expectedSig, 'utf-8');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        res.status(401).json({ error: 'Invalid Paystack webhook signature.' });
        return;
      }

      let event: {
        event?: string;
        data?: {
          reference?: string;
          amount?: number;
          currency?: string;
          channel?: string;
          authorization?: { brand?: string; last4?: string };
          metadata?: { orderId?: string };
        };
      };
      try {
        event = JSON.parse(rawBody.toString('utf-8'));
      } catch {
        res.status(400).json({ error: 'Malformed webhook payload.' });
        return;
      }

      if (event.event === 'charge.success' && event.data) {
        const ref = (event.data.reference || '').trim();
        const store = readStore();
        const idx = store.orders.findIndex(
          (o) =>
            (ref && o.paymentReference === ref) ||
            (event.data?.metadata?.orderId && o.id === event.data.metadata.orderId)
        );

        if (idx >= 0) {
          const order = store.orders[idx];
          const expectedMinorUnits = Math.round(order.totalAmount * 100);
          const paidMinorUnits = Number(event.data.amount || 0);
          const currencyMatch =
            !event.data.currency || event.data.currency.toUpperCase() === order.currency;

          if (currencyMatch && paidMinorUnits >= expectedMinorUnits - 1 && order.status !== 'completed') {
            if (!order.downloadToken) {
              order.downloadToken = crypto.randomBytes(20).toString('hex');
            }
            const channel = event.data.channel || '';
            const authInfo = event.data.authorization;
            if (channel === 'mobile_money') {
              order.paymentMethod = 'mtn_momo';
              order.paymentDetailMasked = `Paystack MoMo${authInfo?.last4 ? ` (••••${authInfo.last4})` : ''}`;
            } else if (authInfo?.last4) {
              order.paymentMethod = 'mastercard';
              order.paymentDetailMasked = `Paystack ${authInfo.brand || 'Card'} •••• ${authInfo.last4}`;
            }
            order.status = 'completed';
            order.paidAtIso = new Date().toISOString();
            order.downloadExpiresAtIso = makeDownloadExpiryIso();
            if (IS_STAGING || secretKey.startsWith('sk_test_')) {
              order.isTestMode = true;
            }
            unpublishExclusiveBeats(order, store);

            const emailResult = await sendOrderDeliveryEmail(order, getAppOrigin(req), store);
            order.emailDeliveryStatus = emailResult.status;
            order.emailDeliveryMessage =
              emailResult.status === 'sent'
                ? emailResult.message
                : `Paystack webhook confirmed payment! Downloads unlocked for ${order.buyerEmail}.`;
            if (emailResult.sentAtIso) {
              order.emailSentAtIso = emailResult.sentAtIso;
            }
            store.orders[idx] = order;
            writeStore(store);
          }
        }
      }

      res.status(200).json({ received: true });
    }
  );

  app.use(express.json({ limit: '5mb' }));

  // Runtime environment configuration script (never exposes server secrets)
  app.get('/api/runtime-config.js', (_req: Request, res: Response) => {
    const secretKey = getPaystackSecretKey();
    const paystackMode = secretKey ? (secretKey.startsWith('sk_live_') ? 'live' : 'test') : null;
    const firebaseConfigured = Boolean(
      SERVER_FIREBASE_CONFIG.apiKey && SERVER_FIREBASE_CONFIG.projectId && SERVER_FIREBASE_CONFIG.appId
    );
    const runtimePayload = {
      appEnv: APP_ENV,
      isStaging: IS_STAGING,
      paystackConnected: Boolean(secretKey),
      paystackMode,
      isTestMode: IS_STAGING || paystackMode === 'test',
      firebaseConfigured,
      firebaseConfig: firebaseConfigured ? SERVER_FIREBASE_CONFIG : null,
    };
    const safeJson = JSON.stringify(runtimePayload).replace(/</g, '\\u003c');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`window.__EXVIS_RUNTIME_CONFIG__ = ${safeJson};`);
  });

  const healthHandler = (_req: Request, res: Response) => {
    let storageWritable = false;
    let uploadsReadable = false;
    let beatCount = 0;

    try {
      fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
      storageWritable = true;
      beatCount = readStore().beats.length;
    } catch {
      storageWritable = false;
    }

    try {
      fs.accessSync(UPLOADS_DIR, fs.constants.R_OK | fs.constants.W_OK);
      uploadsReadable = true;
    } catch {
      uploadsReadable = false;
    }

    const distIndexExists = fs.existsSync(path.join(ROOT_DIR, 'dist', 'index.html'));
    const healthy = storageWritable && uploadsReadable && (!IS_PRODUCTION || distIndexExists);
    const secretKey = getPaystackSecretKey();

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      brand: BRAND_NAME,
      domain: STUDIO_DOMAIN,
      appEnv: APP_ENV,
      isStaging: IS_STAGING,
      environment: IS_PRODUCTION ? 'production' : 'development',
      uptimeSeconds: Math.round(process.uptime()),
      checks: {
        storageWritable,
        uploadsReadable,
        frontendBuilt: distIndexExists,
        persistentVolumeConfigured: PERSISTENT_STORAGE_ROOT !== ROOT_DIR || Boolean(process.env.DATA_DIR || process.env.UPLOADS_DIR),
        paystackConfigured: Boolean(secretKey),
        paystackMode: secretKey ? (secretKey.startsWith('sk_live_') ? 'live' : 'test') : 'unconfigured',
        firebaseConfigured: Boolean(FIREBASE_WEB_API_KEY && SERVER_FIREBASE_CONFIG.projectId),
        firebaseProjectId: SERVER_FIREBASE_CONFIG.projectId || null,
        smtpConfigured: Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()),
      },
      catalogCount: beatCount,
    });
  };

  app.get('/api/health', healthHandler);
  app.get('/healthz', healthHandler);

  app.get('/api/beats', async (req: Request, res: Response) => {
    const store = readStore();
    const isAdmin = req.headers.authorization ? (await verifyProducerAdmin(req)).ok : false;
    if (isAdmin) {
      res.json({ beats: store.beats });
      return;
    }
    res.json({
      beats: store.beats.filter((b) => b.published).map(sanitizeBeatForPublic),
    });
  });

  const ALLOWED_BEAT_GENRES = new Set<BeatRecord['genre']>([
    'Afrobeats',
    'Amapiano',
    'Trap',
    'Drill',
    'UK Drill',
    'Hip-Hop',
    'R&B',
    'Dancehall',
  ]);

  app.post('/api/beats', async (req: Request, res: Response) => {
    const authCheck = await verifyProducerAdmin(req);
    if (!authCheck.ok) {
      const errResp = authCheck as { ok: false; status: number; error: string };
      res.status(errResp.status).json({ error: errResp.error });
      return;
    }

    const body = req.body as Partial<BeatRecord>;
    if (!body.title || !body.genre || !body.audioUrl) {
      res.status(400).json({ error: 'Missing required beat fields.' });
      return;
    }
    const safeGenre = ALLOWED_BEAT_GENRES.has(body.genre) ? body.genre : 'Afrobeats';
    const store = readStore();
    const beat: BeatRecord = {
      id: body.id || `beat_${crypto.randomBytes(5).toString('hex')}`,
      title: String(body.title).slice(0, 100),
      genre: safeGenre,
      bpm: Number(body.bpm) || 120,
      musicalKey: String(body.musicalKey || 'C Min').slice(0, 16),
      durationSec: Number(body.durationSec) || 180,
      mood: String(body.mood || 'Studio Mastered').slice(0, 80),
      coverUrl: String(body.coverUrl || '/src/assets/images/cover_afro_gold_1795108750721.jpg'),
      audioUrl: String(body.audioUrl),
      wavUrl: body.wavUrl ? String(body.wavUrl).slice(0, 500) : undefined,
      stemsUrl: body.stemsUrl ? String(body.stemsUrl).slice(0, 500) : undefined,
      mp3Price: Number(body.mp3Price) || 29,
      wavPrice: Number(body.wavPrice) || 59,
      stemsPrice: Number(body.stemsPrice) || 149,
      exclusivePrice: Number(body.exclusivePrice) || 499,
      plays: 0,
      published: body.published ?? true,
      producerUid: String(body.producerUid || 'exvis_studio_master'),
      createdAtIso: new Date().toISOString(),
    };
    store.beats.unshift(beat);
    writeStore(store);
    res.status(201).json({ beat });
  });

  app.patch('/api/beats/:beatId', async (req: Request, res: Response) => {
    const authCheck = await verifyProducerAdmin(req);
    if (!authCheck.ok) {
      const errResp = authCheck as { ok: false; status: number; error: string };
      res.status(errResp.status).json({ error: errResp.error });
      return;
    }

    const store = readStore();
    const idx = store.beats.findIndex((b) => b.id === req.params.beatId);
    if (idx < 0) {
      res.status(404).json({ error: 'Beat not found.' });
      return;
    }
    const body = req.body as Partial<BeatRecord>;
    const current = store.beats[idx];
    if (typeof body.title === 'string' && body.title.trim().length >= 2) {
      current.title = body.title.trim().slice(0, 100);
    }
    if (body.genre && ALLOWED_BEAT_GENRES.has(body.genre)) {
      current.genre = body.genre;
    }
    if (typeof body.bpm === 'number' && Number.isFinite(body.bpm) && body.bpm >= 40 && body.bpm <= 240) {
      current.bpm = Math.round(body.bpm);
    }
    if (typeof body.musicalKey === 'string' && body.musicalKey.trim()) {
      current.musicalKey = body.musicalKey.trim().slice(0, 16);
    }
    if (typeof body.mood === 'string' && body.mood.trim().length >= 2) {
      current.mood = body.mood.trim().slice(0, 80);
    }
    if (typeof body.coverUrl === 'string' && body.coverUrl.trim()) {
      current.coverUrl = body.coverUrl.trim().slice(0, 500);
    }
    if (typeof body.audioUrl === 'string' && body.audioUrl.trim()) {
      current.audioUrl = body.audioUrl.trim().slice(0, 500);
    }
    if (typeof body.wavUrl === 'string') {
      current.wavUrl = body.wavUrl.trim() ? body.wavUrl.trim().slice(0, 500) : undefined;
    }
    if (typeof body.stemsUrl === 'string') {
      current.stemsUrl = body.stemsUrl.trim() ? body.stemsUrl.trim().slice(0, 500) : undefined;
    }
    if (typeof body.mp3Price === 'number' && body.mp3Price >= 1) {
      current.mp3Price = body.mp3Price;
    }
    if (typeof body.wavPrice === 'number' && body.wavPrice >= 1) {
      current.wavPrice = body.wavPrice;
    }
    if (typeof body.stemsPrice === 'number' && body.stemsPrice >= 1) {
      current.stemsPrice = body.stemsPrice;
    }
    if (typeof body.exclusivePrice === 'number' && body.exclusivePrice >= 1) {
      current.exclusivePrice = body.exclusivePrice;
    }
    if (typeof body.published === 'boolean') {
      current.published = body.published;
    }
    writeStore(store);
    res.json({ beat: current });
  });

  app.delete('/api/beats/:beatId', async (req: Request, res: Response) => {
    const authCheck = await verifyProducerAdmin(req);
    if (!authCheck.ok) {
      const errResp = authCheck as { ok: false; status: number; error: string };
      res.status(errResp.status).json({ error: errResp.error });
      return;
    }
    const store = readStore();
    store.beats = store.beats.filter((b) => b.id !== req.params.beatId);
    writeStore(store);
    res.json({ deleted: true });
  });

  app.delete('/api/beats', async (req: Request, res: Response) => {
    const authCheck = await verifyProducerAdmin(req);
    if (!authCheck.ok) {
      const errResp = authCheck as { ok: false; status: number; error: string };
      res.status(errResp.status).json({ error: errResp.error });
      return;
    }
    const store = readStore();
    store.beats = [];
    writeStore(store);
    res.json({ cleared: true });
  });

  // Chunked audio upload endpoints supporting fast parallel chunks up to 150 MB (Producer Admin Only)
  app.post(
    '/api/upload-audio/chunk',
    express.raw({ type: 'application/octet-stream', limit: '16mb' }),
    async (req: Request, res: Response) => {
      const authCheck = await verifyProducerAdmin(req);
      if (!authCheck.ok) {
        const errResp = authCheck as { ok: false; status: number; error: string };
        res.status(errResp.status).json({ error: errResp.error });
        return;
      }
      const uploadId = String(req.headers['x-upload-id'] || '').trim();
      const chunkIndexRaw = String(req.headers['x-chunk-index'] || '').trim();
      const chunkIndex = Number(chunkIndexRaw);
      if (!/^[a-zA-Z0-9_-]{4,64}$/.test(uploadId) || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 200) {
        res.status(400).json({ error: 'Invalid upload chunk metadata.' });
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'Empty audio chunk received.' });
        return;
      }
      const chunkPath = path.join(UPLOADS_DIR, `.chunk_${uploadId}_${String(chunkIndex).padStart(5, '0')}`);
      await fs.promises.writeFile(chunkPath, req.body);
      res.status(200).json({ ok: true, chunkIndex, bytes: req.body.length });
    }
  );

  app.post('/api/upload-audio/complete', async (req: Request, res: Response) => {
    const authCheck = await verifyProducerAdmin(req);
    if (!authCheck.ok) {
      const errResp = authCheck as { ok: false; status: number; error: string };
      res.status(errResp.status).json({ error: errResp.error });
      return;
    }
    const body = req.body as { uploadId?: string; originalName?: string; totalChunks?: number };
    const uploadId = String(body.uploadId || '').trim();
    const originalName = String(body.originalName || 'beat.wav').trim();
    const totalChunks = Number(body.totalChunks);

    if (!/^[a-zA-Z0-9_-]{4,64}$/.test(uploadId) || !Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 200) {
      res.status(400).json({ error: 'Invalid chunked upload completion request.' });
      return;
    }

    const ext = path.extname(originalName).toLowerCase() || '.mp3';
    if (!AUDIO_ALLOWED_EXTS.includes(ext)) {
      res.status(400).json({
        error: 'Only audio files (.mp3, .wav, .ogg, .m4a, .aac, .flac, .aiff) or trackout archives (.zip, .rar) are supported.',
      });
      return;
    }

    const safeBase =
      path
        .basename(originalName, ext)
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 40) || 'beat';
    const finalFilename = `${Date.now()}_${safeBase}${ext}`;
    const finalPath = path.join(UPLOADS_DIR, finalFilename);

    try {
      let totalSize = 0;
      const handle = await fs.promises.open(finalPath, 'w');
      try {
        for (let i = 0; i < totalChunks; i++) {
          const chunkPath = path.join(UPLOADS_DIR, `.chunk_${uploadId}_${String(i).padStart(5, '0')}`);
          if (!fs.existsSync(chunkPath)) {
            throw new Error(`Missing audio chunk #${i + 1}. Please retry the upload.`);
          }
          const chunkBuf = await fs.promises.readFile(chunkPath);
          totalSize += chunkBuf.length;
          if (totalSize > 150 * 1024 * 1024) {
            throw new Error('Audio file exceeds the 150 MB studio upload limit.');
          }
          await handle.write(chunkBuf);
        }
      } finally {
        await handle.close();
      }

      await Promise.all(
        Array.from({ length: totalChunks }, (_, i) => {
          const chunkPath = path.join(UPLOADS_DIR, `.chunk_${uploadId}_${String(i).padStart(5, '0')}`);
          return fs.promises.unlink(chunkPath).catch(() => undefined);
        })
      );

      res.status(201).json({
        audioUrl: `/api/audio/file/${encodeURIComponent(finalFilename)}`,
        filename: finalFilename,
        originalName,
        sizeBytes: totalSize,
      });
    } catch (err) {
      await fs.promises.unlink(finalPath).catch(() => undefined);
      await Promise.all(
        Array.from({ length: totalChunks }, (_, i) => {
          const chunkPath = path.join(UPLOADS_DIR, `.chunk_${uploadId}_${String(i).padStart(5, '0')}`);
          return fs.promises.unlink(chunkPath).catch(() => undefined);
        })
      );
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to assemble uploaded audio file.',
      });
    }
  });

  app.post('/api/upload-audio', async (req: Request, res: Response) => {
    const authCheck = await verifyProducerAdmin(req);
    if (!authCheck.ok) {
      const errResp = authCheck as { ok: false; status: number; error: string };
      res.status(errResp.status).json({ error: errResp.error });
      return;
    }
    upload.single('audio')(req, res, (err: unknown) => {
      if (err) {
        const isMulterLimit = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
        res.status(isMulterLimit ? 413 : 400).json({
          error: isMulterLimit
            ? 'Audio file is too large (max 150 MB).'
            : err instanceof Error
              ? err.message
              : 'Audio upload failed.',
        });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No audio file uploaded.' });
        return;
      }
      res.status(201).json({
        audioUrl: `/api/audio/file/${encodeURIComponent(req.file.filename)}`,
        filename: req.file.filename,
        originalName: req.file.originalname,
        sizeBytes: req.file.size,
      });
    });
  });

  app.post('/api/upload-cover', async (req: Request, res: Response) => {
    const authCheck = await verifyProducerAdmin(req);
    if (!authCheck.ok) {
      const errResp = authCheck as { ok: false; status: number; error: string };
      res.status(errResp.status).json({ error: errResp.error });
      return;
    }
    uploadCover.single('cover')(req, res, (err: unknown) => {
      if (err) {
        const isMulterLimit = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
        res.status(isMulterLimit ? 413 : 400).json({
          error: isMulterLimit
            ? 'Cover image is too large (max 15 MB).'
            : err instanceof Error
              ? err.message
              : 'Cover image upload failed.',
        });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No cover image uploaded.' });
        return;
      }
      res.status(201).json({
        coverUrl: `/api/covers/${encodeURIComponent(req.file.filename)}`,
        filename: req.file.filename,
      });
    });
  });

  app.get('/api/covers/:filename', (req: Request, res: Response) => {
    const resolved = resolveUploadPath(req.params.filename);
    if (!resolved || !fs.existsSync(resolved.fullPath)) {
      res.status(404).json({ error: 'Cover image not found.' });
      return;
    }
    res.sendFile(resolved.fullPath);
  });

  app.get('/api/audio/synth/:beatId', (req: Request, res: Response) => {
    const beatId = req.params.beatId;
    const store = readStore();
    const beat = store.beats.find((b) => b.id === beatId) || {
      id: beatId,
      title: 'Studio Preview',
      genre: 'Afrobeats' as const,
      bpm: 110,
      musicalKey: 'F# Min',
      durationSec: 24,
      mood: 'Studio Mastered',
      coverUrl: '/src/assets/images/cover_afro_gold_1795108750721.jpg',
      audioUrl: `/api/audio/synth/${beatId}`,
      mp3Price: 29,
      wavPrice: 59,
      stemsPrice: 149,
      exclusivePrice: 499,
      plays: 0,
      published: true,
      producerUid: 'exvis_studio_master',
      createdAtIso: new Date().toISOString(),
    };
    const wavBuffer = generateBeatWav(beat);
    // Preview-only streaming endpoint; master downloads require verified payment at /api/downloads/:orderId/:itemId
    sendRangeBuffer(req, res, wavBuffer, 'audio/wav');
  });

  app.get('/api/audio/file/:filename', async (req: Request, res: Response) => {
    const resolved = resolveUploadPath(req.params.filename);
    if (!resolved || !fs.existsSync(resolved.fullPath)) {
      res.status(404).json({ error: 'Audio file not found.' });
      return;
    }
    const ext = path.extname(resolved.safeName).toLowerCase();
    const store = readStore();
    const encodedTarget = `/api/audio/file/${encodeURIComponent(resolved.safeName)}`;
    const rawTarget = `/api/audio/file/${resolved.safeName}`;
    const matchesTarget = (url?: string) => url === encodedTarget || url === rawTarget;

    const usedAsPublicPreview = store.beats.some(
      (b) => b.published && matchesTarget(b.audioUrl)
    );
    const usedAsPaidOrHiddenAsset =
      ext === '.zip' ||
      ext === '.rar' ||
      store.beats.some(
        (b) =>
          matchesTarget(b.wavUrl) ||
          matchesTarget(b.stemsUrl) ||
          (!b.published && matchesTarget(b.audioUrl))
      );

    if (usedAsPaidOrHiddenAsset && !usedAsPublicPreview) {
      const adminCheck = await verifyProducerAdmin(req);
      if (!adminCheck.ok) {
        res.status(403).json({
          error: 'Paid master WAV & Trackout stems require purchase or producer authorization.',
        });
        return;
      }
    }

    const mime = getAudioMimeType(ext);
    sendRangeFile(req, res, resolved.fullPath, mime);
  });

  // Protected master audio download endpoint — strictly requires completed payment + valid unexpired download token
  app.get('/api/downloads/:orderId/:itemId', (req: Request, res: Response) => {
    const store = readStore();
    const order = store.orders.find((o) => o.id === req.params.orderId);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    if (order.status !== 'completed') {
      res.status(403).json({ error: 'Payment must be completed before downloading this beat.' });
      return;
    }
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!order.downloadToken || token !== order.downloadToken) {
      res.status(403).json({ error: 'Invalid or missing download authorization token.' });
      return;
    }
    if (isDownloadExpired(order)) {
      res.status(410).json({
        error: 'This time-limited download link has expired. Open My Library and click Resend Beat Email for a fresh 7-day link.',
      });
      return;
    }
    const item = order.items.find((i) => i.id === req.params.itemId);
    if (!item) {
      res.status(404).json({ error: 'Purchased item not found in order.' });
      return;
    }

    const safeBeatTitle = item.beatTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanAudioUrl = resolveItemAssetUrl(item, store).split('?')[0];

    if (cleanAudioUrl.startsWith('/api/audio/file/')) {
      const encodedName = cleanAudioUrl.replace('/api/audio/file/', '');
      const resolved = resolveUploadPath(encodedName);
      if (!resolved || !fs.existsSync(resolved.fullPath)) {
        res.status(404).json({ error: 'Audio master file not found on server.' });
        return;
      }
      const ext = path.extname(resolved.safeName).toLowerCase() || '.mp3';
      const mime = getAudioMimeType(ext);
      sendRangeFile(
        req,
        res,
        resolved.fullPath,
        mime,
        `${BRAND_FILE_PREFIX}_${safeBeatTitle}_${item.licenseTier.toUpperCase()}${ext}`
      );
      return;
    }

    if (cleanAudioUrl.startsWith('/api/audio/synth/')) {
      const beatId = cleanAudioUrl.replace('/api/audio/synth/', '');
      const beat = store.beats.find((b) => b.id === beatId) || {
        id: beatId,
        title: item.beatTitle,
        genre: 'Afrobeats' as const,
        bpm: 110,
        musicalKey: 'F# Min',
        durationSec: 24,
        mood: 'Studio Mastered',
        coverUrl: '/src/assets/images/cover_afro_gold_1795108750721.jpg',
        audioUrl: cleanAudioUrl,
        mp3Price: item.price,
        wavPrice: item.price,
        stemsPrice: item.price,
        exclusivePrice: item.price,
        plays: 0,
        published: true,
        producerUid: 'exvis_studio_master',
        createdAtIso: order.createdAtIso,
      };
      const wavBuffer = generateBeatWav(beat);
      sendRangeBuffer(
        req,
        res,
        wavBuffer,
        'audio/wav',
        `${BRAND_FILE_PREFIX}_${safeBeatTitle}_${item.licenseTier.toUpperCase()}.wav`
      );
      return;
    }

    res.status(400).json({ error: 'Unsupported audio asset source.' });
  });

  // Public safe settlement instructions so buyers see producer MoMo/Card destinations
  app.get('/api/payout-info', (_req: Request, res: Response) => {
    const store = readStore();
    const accounts = store.payoutConfigs.map((c) => ({
      methodType: c.methodType,
      accountHolderName: c.accountHolderName,
      institutionOrNetwork: c.institutionOrNetwork,
      maskedIdentifier: c.maskedIdentifier,
      currency: c.currency,
      country: c.country,
    }));
    res.json({ accounts });
  });

  // Public Paystack link status (never exposes API keys)
  app.get('/api/paystack/status', (_req: Request, res: Response) => {
    const secretKey = getPaystackSecretKey();
    const mode = secretKey ? (secretKey.startsWith('sk_live_') ? 'live' : 'test') : null;
    res.json({
      connected: Boolean(secretKey),
      mode,
      hasSubaccount: Boolean(process.env.PAYSTACK_SUBACCOUNT_CODE?.trim()),
      appEnv: APP_ENV,
      isStaging: IS_STAGING,
      isTestMode: IS_STAGING || mode === 'test',
      firebaseConfigured: Boolean(FIREBASE_WEB_API_KEY && SERVER_FIREBASE_CONFIG.projectId),
      firebaseProjectId: SERVER_FIREBASE_CONFIG.projectId || null,
    });
  });

  // Producer Admin Only: Fetch live Paystack account balance, transaction totals & recent settlements
  app.get('/api/paystack/account', async (req: Request, res: Response) => {
    const authCheck = await verifyProducerAdmin(req);
    if (!authCheck.ok) {
      const errResp = authCheck as { ok: false; status: number; error: string };
      res.status(errResp.status).json({ error: errResp.error });
      return;
    }

    const secretKey = getPaystackSecretKey();
    if (!secretKey) {
      res.json({
        connected: false,
        mode: null,
        appEnv: APP_ENV,
        isStaging: IS_STAGING,
        isTestMode: IS_STAGING,
        firebaseConfigured: Boolean(FIREBASE_WEB_API_KEY && SERVER_FIREBASE_CONFIG.projectId),
        firebaseProjectId: SERVER_FIREBASE_CONFIG.projectId || null,
      });
      return;
    }

    const mode = secretKey.startsWith('sk_live_') ? 'live' : 'test';
    const headers = { Authorization: `Bearer ${secretKey}` };

    try {
      const [balRes, totalsRes, settlementsRes] = await Promise.all([
        fetch('https://api.paystack.co/balance', { headers }),
        fetch('https://api.paystack.co/transaction/totals', { headers }),
        fetch('https://api.paystack.co/settlement?perPage=5', { headers }),
      ]);

      const balJson = (await balRes.json()) as {
        status?: boolean;
        message?: string;
        data?: Array<{ currency: string; balance: number }>;
      };
      const totalsJson = (await totalsRes.json()) as {
        status?: boolean;
        data?: {
          total_transactions?: number;
          total_volume?: number;
          total_volume_by_currency?: Array<{ currency: string; amount: number }>;
        };
      };
      const settlementsJson = (await settlementsRes.json()) as {
        status?: boolean;
        data?: Array<{
          id: number;
          settlement_date?: string;
          total_amount?: number;
          currency?: string;
          status?: string;
        }>;
      };

      if (!balRes.ok && balRes.status === 401) {
        res.status(400).json({
          connected: false,
          mode,
          appEnv: APP_ENV,
          isStaging: IS_STAGING,
          isTestMode: IS_STAGING || mode === 'test',
          firebaseConfigured: Boolean(FIREBASE_WEB_API_KEY && SERVER_FIREBASE_CONFIG.projectId),
          firebaseProjectId: SERVER_FIREBASE_CONFIG.projectId || null,
          error: balJson.message || 'Paystack rejected the configured PAYSTACK_SECRET_KEY.',
        });
        return;
      }

      res.json({
        connected: true,
        mode,
        appEnv: APP_ENV,
        isStaging: IS_STAGING,
        isTestMode: IS_STAGING || mode === 'test',
        firebaseConfigured: Boolean(FIREBASE_WEB_API_KEY && SERVER_FIREBASE_CONFIG.projectId),
        firebaseProjectId: SERVER_FIREBASE_CONFIG.projectId || null,
        hasSubaccount: Boolean(process.env.PAYSTACK_SUBACCOUNT_CODE?.trim()),
        balances: Array.isArray(balJson.data)
          ? balJson.data.map((b) => ({ currency: b.currency, balance: b.balance / 100 }))
          : [],
        totals: {
          totalTransactions: totalsJson.data?.total_transactions || 0,
          volumesByCurrency: Array.isArray(totalsJson.data?.total_volume_by_currency)
            ? totalsJson.data!.total_volume_by_currency!.map((v) => ({
                currency: v.currency,
                amount: v.amount / 100,
              }))
            : [],
        },
        settlements: Array.isArray(settlementsJson.data)
          ? settlementsJson.data.map((s) => ({
              id: s.id,
              date: s.settlement_date || '',
              amount: (s.total_amount || 0) / 100,
              currency: s.currency || 'GHS',
              status: s.status || 'processed',
            }))
          : [],
      });
    } catch (err) {
      res.status(502).json({
        connected: true,
        mode,
        error: err instanceof Error ? err.message : 'Unable to reach Paystack API.',
      });
    }
  });

  // Initialize a real Paystack transaction and return access_code for Inline V2 Checkout
  app.post('/api/paystack/initialize', async (req: Request, res: Response) => {
    const secretKey = getPaystackSecretKey();
    if (!secretKey) {
      res.status(503).json({
        error:
          'Paystack is not linked yet. Add your PAYSTACK_SECRET_KEY in AI Studio Secrets to enable Paystack checkout.',
      });
      return;
    }

    const body = req.body as {
      buyerUid?: string;
      buyerName?: string;
      buyerEmail?: string;
      paymentMethod?: 'mastercard' | 'mtn_momo';
      currency?: 'USD' | 'GHS';
      items?: Array<{
        beatId: string;
        beatTitle: string;
        licenseTier: 'mp3' | 'wav' | 'stems' | 'exclusive';
        price: number;
        audioUrl: string;
        wavUrl?: string;
        stemsUrl?: string;
      }>;
    };

    const buyerName = body.buyerName?.trim() || '';
    const buyerEmail = body.buyerEmail?.trim() || '';
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!buyerName || !emailPattern.test(buyerEmail)) {
      res.status(400).json({ error: 'Please provide your name and a valid email address.' });
      return;
    }
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      res.status(400).json({ error: 'Your bag is empty.' });
      return;
    }

    const paymentMethod: 'mastercard' | 'mtn_momo' =
      body.paymentMethod === 'mastercard' ? 'mastercard' : 'mtn_momo';
    const requestedCurrency: 'USD' | 'GHS' =
      body.currency === 'GHS' || paymentMethod === 'mtn_momo' ? 'GHS' : 'USD';

    const store = readStore();
    const orderId = `EXV-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const authoritative = resolveAuthoritativeOrderItems(body.items, store, orderId);
    if (!authoritative.ok) {
      res.status(400).json({ error: authoritative.error });
      return;
    }
    const { items: orderItems, usdTotal } = authoritative;
    const reference = `PSK-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const originUrl = getAppOrigin(req);
    const subaccountCode = process.env.PAYSTACK_SUBACCOUNT_CODE?.trim();

    const initCall = async (chargeCurrency: 'USD' | 'GHS') => {
      const chargeAmount =
        chargeCurrency === 'GHS' ? Math.round(usdTotal * USD_TO_GHS * 100) / 100 : usdTotal;
      const minorUnits = Math.round(chargeAmount * 100);
      const payload: Record<string, unknown> = {
        email: buyerEmail,
        amount: minorUnits,
        currency: chargeCurrency,
        reference,
        callback_url: `${originUrl}/?paystack_ref=${encodeURIComponent(reference)}`,
        channels:
          paymentMethod === 'mtn_momo'
            ? ['mobile_money', 'card']
            : ['card', 'mobile_money', 'bank'],
        metadata: {
          orderId,
          buyerName,
          buyerUid: body.buyerUid || 'guest',
          itemsSummary: orderItems.map((i) => `${i.beatTitle} (${i.licenseTier})`).join(', '),
        },
      };
      if (subaccountCode) {
        payload.subaccount = subaccountCode;
      }

      const resp = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const json = (await resp.json()) as {
        status?: boolean;
        message?: string;
        data?: { authorization_url: string; access_code: string; reference: string };
      };
      return { resp, json, chargeCurrency, chargeAmount };
    };

    try {
      let attempt = await initCall(requestedCurrency);
      if (
        (!attempt.resp.ok || !attempt.json.status) &&
        requestedCurrency === 'USD' &&
        /currency/i.test(attempt.json.message || '')
      ) {
        // Fallback to GHS if merchant Paystack account only has GHS currency active
        attempt = await initCall('GHS');
      }

      if (!attempt.resp.ok || !attempt.json.status || !attempt.json.data) {
        res.status(400).json({
          error: attempt.json.message || 'Paystack could not initialize this transaction.',
        });
        return;
      }

      const order: ServerOrder = {
        id: orderId,
        buyerUid: body.buyerUid || 'guest',
        buyerName: buyerName.slice(0, 100),
        buyerEmail: buyerEmail.slice(0, 150),
        paymentMethod,
        paymentDetailMasked:
          paymentMethod === 'mtn_momo'
            ? 'Paystack · Mobile Money'
            : 'Paystack · Card',
        paymentReference: attempt.json.data.reference,
        totalAmount: attempt.chargeAmount,
        currency: attempt.chargeCurrency,
        usdEquivalent: usdTotal,
        status: 'pending',
        downloadToken: crypto.randomBytes(20).toString('hex'),
        isTestMode: IS_STAGING || secretKey.startsWith('sk_test_'),
        emailDeliveryStatus: 'pending',
        emailDeliveryMessage: 'Awaiting Paystack checkout completion.',
        items: orderItems,
        createdAtIso: new Date().toISOString(),
      };

      store.orders.unshift(order);
      writeStore(store);

      res.status(200).json({
        accessCode: attempt.json.data.access_code,
        authorizationUrl: attempt.json.data.authorization_url,
        reference: attempt.json.data.reference,
        orderId,
        currency: attempt.chargeCurrency,
        amount: attempt.chargeAmount,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to reach Paystack servers.',
      });
    }
  });

  // Verify Paystack transaction server-side and immediately unlock beat download & email delivery
  app.post('/api/paystack/verify', async (req: Request, res: Response) => {
    const secretKey = getPaystackSecretKey();
    if (!secretKey) {
      res.status(503).json({ error: 'Paystack is not configured on the server.' });
      return;
    }

    const reference = ((req.body as { reference?: string })?.reference || '').trim();
    if (!reference || !/^[a-zA-Z0-9_.\-]+$/.test(reference)) {
      res.status(400).json({ error: 'Valid Paystack payment reference is required.' });
      return;
    }

    try {
      const verifyRes = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
          headers: { Authorization: `Bearer ${secretKey}` },
        }
      );
      const verifyJson = (await verifyRes.json()) as {
        status?: boolean;
        message?: string;
        data?: {
          status?: string;
          reference?: string;
          amount?: number;
          currency?: string;
          channel?: string;
          authorization?: {
            brand?: string;
            last4?: string;
            bank?: string;
            mobile_money_number?: string;
          };
          metadata?: { orderId?: string };
        };
      };

      if (!verifyRes.ok || !verifyJson.status || !verifyJson.data) {
        res.status(400).json({ error: verifyJson.message || 'Could not verify Paystack payment.' });
        return;
      }

      if (verifyJson.data.status !== 'success') {
        res.status(402).json({
          verified: false,
          error: `Paystack payment status is "${verifyJson.data.status}". Please complete payment to unlock your beat.`,
        });
        return;
      }

      const store = readStore();
      const idx = store.orders.findIndex(
        (o) =>
          o.paymentReference === reference ||
          (verifyJson.data?.metadata?.orderId && o.id === verifyJson.data.metadata.orderId)
      );

      if (idx < 0) {
        res.status(404).json({ error: 'Matching beat order was not found for this Paystack reference.' });
        return;
      }

      const order = store.orders[idx];
      const expectedMinorUnits = Math.round(order.totalAmount * 100);
      const paidMinorUnits = Number(verifyJson.data.amount || 0);
      const paidCurrency = (verifyJson.data.currency || '').toUpperCase();

      if (paidCurrency !== order.currency || paidMinorUnits < expectedMinorUnits - 1) {
        res.status(402).json({
          verified: false,
          error: `Verified Paystack amount/currency mismatch (${paidCurrency} ${(paidMinorUnits / 100).toFixed(2)} vs expected ${order.currency} ${order.totalAmount.toFixed(2)}).`,
        });
        return;
      }

      if (!order.downloadToken) {
        order.downloadToken = crypto.randomBytes(20).toString('hex');
      }

      const authInfo = verifyJson.data.authorization;
      const channel = verifyJson.data.channel || '';
      if (channel === 'mobile_money') {
        order.paymentMethod = 'mtn_momo';
        order.paymentDetailMasked = `Paystack MoMo${authInfo?.last4 ? ` (••••${authInfo.last4})` : ''}`;
      } else if (authInfo?.last4) {
        order.paymentMethod = 'mastercard';
        order.paymentDetailMasked = `Paystack ${authInfo.brand || 'Card'} •••• ${authInfo.last4}`;
      } else {
        order.paymentDetailMasked = `Paystack (${channel || 'Verified'})`;
      }

      if (order.status !== 'completed') {
        order.status = 'completed';
        order.paidAtIso = new Date().toISOString();
        order.downloadExpiresAtIso = makeDownloadExpiryIso();
        if (IS_STAGING || secretKey.startsWith('sk_test_')) {
          order.isTestMode = true;
        }
        unpublishExclusiveBeats(order, store);

        const emailResult = await sendOrderDeliveryEmail(order, getAppOrigin(req), store);
        order.emailDeliveryStatus = emailResult.status;
        order.emailDeliveryMessage =
          emailResult.status === 'sent'
            ? emailResult.message
            : `Paystack payment verified! Your beat audio & license certificate are unlocked below for ${order.buyerEmail}.`;
        if (emailResult.sentAtIso) {
          order.emailSentAtIso = emailResult.sentAtIso;
        }

        store.orders[idx] = order;
        writeStore(store);
      }

      res.json({ verified: true, order: sanitizeOrderForClient(order, true) });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to verify Paystack transaction.',
      });
    }
  });

  // Legacy simulated checkout is disabled in production or whenever Paystack is configured
  app.post('/api/checkout', async (req: Request, res: Response) => {
    if (process.env.NODE_ENV === 'production' || Boolean(getPaystackSecretKey())) {
      res.status(403).json({
        error:
          'Direct unverified checkout is disabled. Please complete payment through verified Paystack checkout or await producer confirmation.',
      });
      return;
    }

    const body = req.body as {
      buyerUid?: string;
      buyerName?: string;
      buyerEmail?: string;
      paymentMethod?: 'mastercard' | 'mtn_momo';
      currency?: 'USD' | 'GHS';
      cardLast4?: string;
      momoPhone?: string;
      paymentAuthCode?: string;
      items?: Array<{
        beatId: string;
        beatTitle: string;
        licenseTier: 'mp3' | 'wav' | 'stems' | 'exclusive';
        price: number;
        audioUrl: string;
        wavUrl?: string;
        stemsUrl?: string;
      }>;
    };

    const buyerName = body.buyerName?.trim() || '';
    const buyerEmail = body.buyerEmail?.trim() || '';
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!buyerName || !emailPattern.test(buyerEmail)) {
      res.status(400).json({ error: 'Please provide your name and a valid email address to receive your beat.' });
      return;
    }
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      res.status(400).json({ error: 'Your bag is empty.' });
      return;
    }
    if (body.paymentMethod !== 'mastercard' && body.paymentMethod !== 'mtn_momo') {
      res.status(400).json({ error: 'Select Mastercard or MTN Mobile Money.' });
      return;
    }

    const store = readStore();
    const orderId = `EXV-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const authoritative = resolveAuthoritativeOrderItems(body.items, store, orderId);
    if (!authoritative.ok) {
      res.status(400).json({ error: authoritative.error });
      return;
    }
    const { items: orderItems, usdTotal } = authoritative;

    const currency: 'USD' | 'GHS' = body.currency === 'GHS' ? 'GHS' : 'USD';
    const totalAmount = currency === 'GHS' ? Math.round(usdTotal * USD_TO_GHS * 100) / 100 : usdTotal;

    const baseRef =
      body.paymentMethod === 'mtn_momo'
        ? `MOMO-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
        : `MC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const buyerTxCode = body.paymentAuthCode?.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20).toUpperCase();
    const paymentReference = buyerTxCode ? `${baseRef} (${buyerTxCode})` : baseRef;

    const paymentDetailMasked =
      body.paymentMethod === 'mtn_momo'
        ? `MTN MoMo (${String(body.momoPhone || '024XXXXXXX').slice(-10)})`
        : `Mastercard •••• ${String(body.cardLast4 || '4242').slice(-4)}`;

    const nowIso = new Date().toISOString();
    const order: ServerOrder = {
      id: orderId,
      buyerUid: body.buyerUid || 'guest',
      buyerName: buyerName.slice(0, 100),
      buyerEmail: buyerEmail.slice(0, 150),
      paymentMethod: body.paymentMethod,
      paymentDetailMasked,
      paymentReference,
      totalAmount,
      currency,
      usdEquivalent: usdTotal,
      status: 'completed',
      paidAtIso: nowIso,
      downloadToken: crypto.randomBytes(20).toString('hex'),
      downloadExpiresAtIso: makeDownloadExpiryIso(),
      isTestMode: isOrderOrServerTestMode(),
      emailDeliveryStatus: 'pending',
      items: orderItems,
      createdAtIso: nowIso,
    };

    unpublishExclusiveBeats(order, store);

    const gmailAccessTokenHeader = req.headers['x-gmail-access-token'];
    const gmailAccessToken =
      typeof gmailAccessTokenHeader === 'string' && gmailAccessTokenHeader.trim()
        ? gmailAccessTokenHeader.trim()
        : undefined;

    const emailResult = await sendOrderDeliveryEmail(order, getAppOrigin(req), store, gmailAccessToken);
    order.emailDeliveryStatus = emailResult.status;
    order.emailDeliveryMessage =
      emailResult.status === 'sent'
        ? emailResult.message
        : `Payment successful! Your beat audio & license certificate are unlocked below for ${buyerEmail}.`;
    if (emailResult.sentAtIso) {
      order.emailSentAtIso = emailResult.sentAtIso;
    }

    store.orders.unshift(order);
    writeStore(store);
    res.status(201).json({ order: sanitizeOrderForClient(order, true) });
  });

  // Step 1 of Purchase: Buyer submits email + payment details (pending Producer confirmation before email & download)
  app.post('/api/checkout/initiate', (req: Request, res: Response) => {
    const body = req.body as {
      buyerUid?: string;
      buyerName?: string;
      buyerEmail?: string;
      paymentMethod?: 'mastercard' | 'mtn_momo';
      currency?: 'USD' | 'GHS';
      cardLast4?: string;
      momoPhone?: string;
      paymentAuthCode?: string;
      items?: Array<{
        beatId: string;
        beatTitle: string;
        licenseTier: 'mp3' | 'wav' | 'stems' | 'exclusive';
        price: number;
        audioUrl: string;
        wavUrl?: string;
        stemsUrl?: string;
      }>;
    };

    const buyerName = body.buyerName?.trim() || '';
    const buyerEmail = body.buyerEmail?.trim() || '';
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!buyerName || !emailPattern.test(buyerEmail)) {
      res.status(400).json({ error: 'Please provide your name and a valid email address to receive your beat.' });
      return;
    }
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      res.status(400).json({ error: 'Your bag is empty.' });
      return;
    }
    if (body.paymentMethod !== 'mastercard' && body.paymentMethod !== 'mtn_momo') {
      res.status(400).json({ error: 'Select Mastercard or MTN Mobile Money.' });
      return;
    }

    const store = readStore();
    const orderId = `EXV-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const authoritative = resolveAuthoritativeOrderItems(body.items, store, orderId);
    if (!authoritative.ok) {
      res.status(400).json({ error: authoritative.error });
      return;
    }
    const { items: orderItems, usdTotal } = authoritative;

    const currency: 'USD' | 'GHS' = body.currency === 'GHS' ? 'GHS' : 'USD';
    const totalAmount = currency === 'GHS' ? Math.round(usdTotal * USD_TO_GHS * 100) / 100 : usdTotal;

    const baseRef =
      body.paymentMethod === 'mtn_momo'
        ? `MOMO-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
        : `MC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const buyerTxCode = body.paymentAuthCode?.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20).toUpperCase();
    const paymentReference = buyerTxCode ? `${baseRef} (${buyerTxCode})` : baseRef;

    const paymentDetailMasked =
      body.paymentMethod === 'mtn_momo'
        ? `MTN MoMo (${String(body.momoPhone || '024XXXXXXX').slice(-10)})`
        : `Mastercard •••• ${String(body.cardLast4 || '4242').slice(-4)}`;

    const order: ServerOrder = {
      id: orderId,
      buyerUid: body.buyerUid || 'guest',
      buyerName: buyerName.slice(0, 100),
      buyerEmail: buyerEmail.slice(0, 150),
      paymentMethod: body.paymentMethod,
      paymentDetailMasked,
      paymentReference,
      totalAmount,
      currency,
      usdEquivalent: usdTotal,
      status: 'pending',
      downloadToken: crypto.randomBytes(20).toString('hex'),
      isTestMode: isOrderOrServerTestMode(),
      emailDeliveryStatus: 'awaiting_payment_confirmation',
      emailDeliveryMessage: `Payment submitted. Waiting for ${BRAND_NAME} to confirm payment before sending the beat to ${buyerEmail}.`,
      items: orderItems,
      createdAtIso: new Date().toISOString(),
    };

    store.orders.unshift(order);
    writeStore(store);
    res.status(201).json({ order: sanitizeOrderForClient(order, false) });
  });

  // Step 2 of Purchase (Producer Admin Only): Confirm payment received, unlock download token, and email beat to buyerEmail
  async function handleConfirmOrderPayment(req: Request, res: Response, orderIdParam?: string) {
    const authCheck = await verifyProducerAdmin(req);
    if (!authCheck.ok) {
      const errResp = authCheck as { ok: false; status: number; error: string };
      res.status(errResp.status).json({ error: errResp.error });
      return;
    }

    const body = (req.body || {}) as {
      orderId?: string;
      paymentAuthCode?: string;
      orderSnapshot?: Partial<ServerOrder>;
    };
    const targetOrderId = (orderIdParam || body.orderId || '').trim();
    if (!targetOrderId) {
      res.status(400).json({ error: 'Order ID is required to confirm payment.' });
      return;
    }

    const store = readStore();
    let idx = store.orders.findIndex((o) => o.id === targetOrderId);

    // If order originated solely from Firestore, hydrate it using admin-supplied snapshot
    if (idx < 0 && body.orderSnapshot && body.orderSnapshot.buyerEmail) {
      const snap = body.orderSnapshot;
      const hydrated: ServerOrder = {
        id: targetOrderId,
        buyerUid: String(snap.buyerUid || 'guest'),
        buyerName: String(snap.buyerName || 'Client'),
        buyerEmail: String(snap.buyerEmail),
        paymentMethod: snap.paymentMethod === 'mastercard' ? 'mastercard' : 'mtn_momo',
        paymentDetailMasked: String(snap.paymentDetailMasked || 'Verified Payment'),
        paymentReference: String(snap.paymentReference || targetOrderId),
        totalAmount: Number(snap.totalAmount || 0),
        currency: snap.currency === 'GHS' ? 'GHS' : 'USD',
        usdEquivalent: Number(snap.usdEquivalent || snap.totalAmount || 0),
        status: 'pending',
        downloadToken: crypto.randomBytes(20).toString('hex'),
        emailDeliveryStatus: 'awaiting_payment_confirmation',
        items: Array.isArray(snap.items) ? (snap.items as ServerOrderItem[]) : [],
        createdAtIso: String(snap.createdAtIso || new Date().toISOString()),
      };
      store.orders.unshift(hydrated);
      idx = 0;
    }

    if (idx < 0) {
      res.status(404).json({ error: 'Pending order not found.' });
      return;
    }

    const order = store.orders[idx];
    if (!order.downloadToken) {
      order.downloadToken = crypto.randomBytes(20).toString('hex');
    }

    let needsGmailReconnect = false;
    const gmailAccessTokenHeader = req.headers['x-gmail-access-token'];
    const gmailAccessToken =
      typeof gmailAccessTokenHeader === 'string' && gmailAccessTokenHeader.trim()
        ? gmailAccessTokenHeader.trim()
        : undefined;

    if (order.status !== 'completed') {
      order.status = 'completed';
      order.paidAtIso = new Date().toISOString();
      order.downloadExpiresAtIso = makeDownloadExpiryIso();
      order.confirmedBy = authCheck.email;
      if (body.paymentAuthCode?.trim()) {
        order.paymentReference = `${order.paymentReference} · ${body.paymentAuthCode.trim().slice(0, 16).toUpperCase()}`;
      }
      unpublishExclusiveBeats(order, store);

      const originUrl = getAppOrigin(req);
      const emailResult = await sendOrderDeliveryEmail(order, originUrl, store, gmailAccessToken);
      order.emailDeliveryStatus = emailResult.status;
      order.emailDeliveryMessage = emailResult.message;
      needsGmailReconnect = Boolean(emailResult.needsGmailReconnect);
      if (emailResult.sentAtIso) {
        order.emailSentAtIso = emailResult.sentAtIso;
      }

      store.orders[idx] = order;
      writeStore(store);
    }

    res.status(200).json({
      order: sanitizeOrderForClient(order, true),
      needsGmailReconnect,
    });
  }

  app.post('/api/checkout/confirm', (req: Request, res: Response) => {
    void handleConfirmOrderPayment(req, res);
  });

  app.post('/api/orders/:orderId/confirm-payment', (req: Request, res: Response) => {
    void handleConfirmOrderPayment(req, res, req.params.orderId);
  });

  // Producer Admin Only: Decline/remove an unpaid pending order without sending any beat
  app.post('/api/orders/:orderId/reject', async (req: Request, res: Response) => {
    const authCheck = await verifyProducerAdmin(req);
    if (!authCheck.ok) {
      const errResp = authCheck as { ok: false; status: number; error: string };
      res.status(errResp.status).json({ error: errResp.error });
      return;
    }
    const store = readStore();
    const target = store.orders.find((o) => o.id === req.params.orderId);
    if (!target) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    if (target.status === 'completed') {
      res.status(400).json({ error: 'Completed orders cannot be rejected.' });
      return;
    }
    store.orders = store.orders.filter((o) => o.id !== req.params.orderId);
    writeStore(store);
    res.json({ rejected: true, orderId: req.params.orderId });
  });

  // Resend beat download & license email for a completed order (never allows unauthenticated email overwrite)
  app.post('/api/orders/:orderId/resend-email', async (req: Request, res: Response) => {
    const store = readStore();
    const idx = store.orders.findIndex((o) => o.id === req.params.orderId);
    if (idx < 0) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    const order = store.orders[idx];
    if (order.status !== 'completed') {
      res.status(403).json({ error: 'Payment confirmation is required before sending the beat via email.' });
      return;
    }

    const adminCheck = req.headers.authorization ? await verifyProducerAdmin(req) : { ok: false as const };
    const requestedEmail = (req.body as { email?: string })?.email?.trim();
    if (adminCheck.ok && requestedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail)) {
      order.buyerEmail = requestedEmail.slice(0, 150);
    }

    if (!order.downloadToken) {
      order.downloadToken = crypto.randomBytes(20).toString('hex');
    }
    order.downloadExpiresAtIso = makeDownloadExpiryIso();

    const gmailAccessTokenHeader = req.headers['x-gmail-access-token'];
    const gmailAccessToken =
      adminCheck.ok && typeof gmailAccessTokenHeader === 'string' && gmailAccessTokenHeader.trim()
        ? gmailAccessTokenHeader.trim()
        : undefined;

    const emailResult = await sendOrderDeliveryEmail(order, getAppOrigin(req), store, gmailAccessToken);
    order.emailDeliveryStatus = emailResult.status;
    order.emailDeliveryMessage = emailResult.message;
    if (emailResult.sentAtIso) {
      order.emailSentAtIso = emailResult.sentAtIso;
    }
    store.orders[idx] = order;
    writeStore(store);

    res.json({
      order: sanitizeOrderForClient(order, adminCheck.ok),
      emailDeliveryStatus: order.emailDeliveryStatus,
      message: order.emailDeliveryMessage,
      needsGmailReconnect: Boolean(emailResult.needsGmailReconnect),
    });
  });

  app.get('/api/orders', async (req: Request, res: Response) => {
    const store = readStore();
    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
    const orderId = typeof req.query.orderId === 'string' ? req.query.orderId.trim() : '';
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';

    const userCheck = req.headers.authorization ? await verifyFirebaseUser(req) : null;
    const isAdmin =
      Boolean(userCheck?.ok) &&
      userCheck!.ok &&
      userCheck!.email.toLowerCase() === PRODUCER_ADMIN_EMAIL &&
      userCheck!.emailVerified;

    if (isAdmin) {
      let filtered = store.orders;
      if (orderId) filtered = filtered.filter((o) => o.id === orderId);
      if (email) filtered = filtered.filter((o) => o.buyerEmail.toLowerCase() === email);
      res.json({ orders: filtered.map((o) => sanitizeOrderForClient(o, true)) });
      return;
    }

    if (!orderId && !email && !(userCheck && userCheck.ok)) {
      res.status(401).json({ error: 'Producer sign-in or order email/ID lookup required.' });
      return;
    }

    let filtered = store.orders;
    if (orderId) {
      filtered = filtered.filter((o) => o.id === orderId);
    } else if (email) {
      filtered = filtered.filter((o) => o.buyerEmail.toLowerCase() === email);
    } else if (userCheck && userCheck.ok) {
      filtered = filtered.filter(
        (o) =>
          o.buyerUid === userCheck.uid ||
          o.buyerEmail.toLowerCase() === userCheck.email.toLowerCase()
      );
    }

    const orders = filtered.map((o) => {
      const signedInOwner =
        Boolean(userCheck?.ok) &&
        userCheck!.ok &&
        userCheck!.emailVerified &&
        (o.buyerUid === userCheck!.uid ||
          o.buyerEmail.toLowerCase() === userCheck!.email.toLowerCase());
      const validLinkToken = Boolean(token && o.downloadToken && token === o.downloadToken);
      return sanitizeOrderForClient(o, signedInOwner || validLinkToken);
    });

    res.json({ orders });
  });

  app.get('/api/licenses/:orderId/:itemId', (req: Request, res: Response) => {
    const store = readStore();
    const order = store.orders.find((o) => o.id === req.params.orderId);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    if (order.status !== 'completed') {
      res.status(403).json({ error: 'Payment must be completed before downloading the license agreement.' });
      return;
    }
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!order.downloadToken || token !== order.downloadToken) {
      res.status(403).json({ error: 'Invalid or missing license download token.' });
      return;
    }
    if (isDownloadExpired(order)) {
      res.status(410).json({
        error: 'This time-limited license download link has expired. Open My Library and click Resend Beat Email for a fresh 7-day link.',
      });
      return;
    }

    const item = order.items.find((i) => i.id === req.params.itemId);
    if (!item) {
      res.status(404).json({ error: 'License item not found.' });
      return;
    }

    const isTestMode = isOrderOrServerTestMode(order);
    const certificate = buildLicenseText(order, item, isTestMode);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${BRAND_FILE_PREFIX}${isTestMode ? '_TEST_MODE' : ''}_License_${item.licenseCode}.txt"`
    );
    res.send(certificate);
  });

  app.get('/api/payouts', async (req: Request, res: Response) => {
    const authCheck = await verifyProducerAdmin(req);
    if (!authCheck.ok) {
      const errResp = authCheck as { ok: false; status: number; error: string };
      res.status(errResp.status).json({ error: errResp.error });
      return;
    }
    const store = readStore();
    res.json({
      payoutConfigs: store.payoutConfigs,
      payoutRequests: store.payoutRequests,
    });
  });

  app.post('/api/payouts/config', async (req: Request, res: Response) => {
    const authCheck = await verifyProducerAdmin(req);
    if (!authCheck.ok) {
      const errResp = authCheck as { ok: false; status: number; error: string };
      res.status(errResp.status).json({ error: errResp.error });
      return;
    }
    const body = req.body as Partial<ServerPayoutConfig>;
    if (!body.methodType || !body.accountHolderName || !body.maskedIdentifier) {
      res.status(400).json({ error: 'Missing required payout account fields.' });
      return;
    }
    const store = readStore();
    const id = body.id || body.methodType;
    const config: ServerPayoutConfig = {
      id,
      methodType: body.methodType,
      accountLabel: String(body.accountLabel || (body.methodType === 'mtn_momo' ? 'MTN Mobile Money' : 'Bank MasterCard')),
      accountHolderName: String(body.accountHolderName).slice(0, 100),
      institutionOrNetwork: String(body.institutionOrNetwork || (body.methodType === 'mtn_momo' ? 'MTN MoMo' : 'Mastercard Bank')).slice(0, 80),
      maskedIdentifier: String(body.maskedIdentifier).slice(0, 64),
      currency: body.currency === 'GHS' ? 'GHS' : 'USD',
      country: String(body.country || 'Ghana').slice(0, 60),
      isDefault: Boolean(body.isDefault),
      updatedAtIso: new Date().toISOString(),
    };
    const existingIdx = store.payoutConfigs.findIndex((c) => c.id === id);
    if (existingIdx >= 0) {
      store.payoutConfigs[existingIdx] = config;
    } else {
      store.payoutConfigs.push(config);
    }
    writeStore(store);
    res.status(200).json({ config });
  });

  app.post('/api/payouts/withdraw', async (req: Request, res: Response) => {
    const authCheck = await verifyProducerAdmin(req);
    if (!authCheck.ok) {
      const errResp = authCheck as { ok: false; status: number; error: string };
      res.status(errResp.status).json({ error: errResp.error });
      return;
    }
    const body = req.body as {
      methodType?: 'bank_mastercard' | 'mtn_momo';
      destinationSummary?: string;
      amountUsd?: number;
      currency?: 'USD' | 'GHS';
    };
    if (!body.methodType || !body.destinationSummary || !body.amountUsd || Number(body.amountUsd) <= 0) {
      res.status(400).json({ error: 'Valid payout destination and positive amount required.' });
      return;
    }
    const store = readStore();
    const payout: ServerPayoutRequest = {
      id: `PAY-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      methodType: body.methodType,
      destinationSummary: body.destinationSummary.slice(0, 120),
      amountUsd: Number(body.amountUsd),
      currency: body.currency === 'GHS' ? 'GHS' : 'USD',
      referenceCode: `EXV-STL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      status: 'settled',
      createdAtIso: new Date().toISOString(),
    };
    store.payoutRequests.unshift(payout);
    writeStore(store);
    res.status(201).json({ payout });
  });

  // Return JSON 404 for unknown /api routes rather than falling through to SPA HTML
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // JSON error handler for /api/* routes so clients never get opaque HTML parse errors
  app.use('/api', (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Server error while processing request.';
    console.error(`[api:error] ${req.method} ${req.path}:`, message);
    res.status(500).json({ error: message });
  });

  // Vite dev middleware or production static serving
  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(ROOT_DIR, 'dist');
    app.use(
      express.static(distPath, {
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `${BRAND_NAME} server listening on http://0.0.0.0:${PORT} (appEnv=${APP_ENV}, nodeEnv=${IS_PRODUCTION ? 'production' : 'development'}, firebaseProject=${SERVER_FIREBASE_CONFIG.projectId || 'unconfigured'}, data=${DATA_DIR}, uploads=${UPLOADS_DIR})`
    );
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`[server] Received ${signal}, closing HTTP server cleanly...`);
    server.close(() => {
      console.log('[server] Closed gracefully.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled promise rejection:', reason instanceof Error ? reason.message : reason);
});

process.on('uncaughtException', (err) => {
  console.error('[process] Uncaught exception:', err.message);
  process.exit(1);
});

startServer().catch((err) => {
  console.error(`Failed to start ${BRAND_NAME} server:`, err);
  process.exit(1);
});
