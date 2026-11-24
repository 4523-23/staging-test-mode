import React, { useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  ArrowUpRight,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  Beat,
  BeatGenre,
  CurrencyCode,
  OrderRecord,
  PayoutConfig,
  PayoutRequest,
  STUDIO_COVERS,
  USD_TO_GHS_RATE,
} from '../types';
import {
  activeFirebaseProjectId,
  clearGmailAccessToken,
  db,
  getGmailAccessToken,
  handleFirestoreError,
  initialRuntimeConfig,
  isFirebaseConfigured,
  isProducerAdminEmail,
  isStagingEnv,
  OperationType,
  PRODUCER_ADMIN_EMAIL,
  signInProducerWithGmail,
  subscribeGmailToken,
} from '../lib/firebase';
import { GoogleSignInButton } from './GoogleSignInButton';
import { formatMoney } from '../utils/format';
import { BRAND_CONFIG } from '../config/brand';

interface ProducerStudioViewProps {
  user: User | null;
  beats: Beat[];
  currency: CurrencyCode;
  onBeatsUpdated: () => void;
}

export const ProducerStudioView: React.FC<ProducerStudioViewProps> = ({
  user,
  beats,
  currency,
  onBeatsUpdated,
}) => {
  const isAdmin = isProducerAdminEmail(user?.email, user?.emailVerified);
  const [activeTab, setActiveTab] = useState<'overview' | 'upload' | 'payout_accounts' | 'withdrawals'>('overview');

  // Ledger state
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [payoutConfigs, setPayoutConfigs] = useState<PayoutConfig[]>([]);
  const [payoutRequests, setPayoutRequests] = useState<PayoutRequest[]>([]);
  const [statusBanner, setStatusBanner] = useState('');
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [gmailToken, setGmailToken] = useState<string | null>(() => getGmailAccessToken());
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [paystackAccount, setPaystackAccount] = useState<{
    loading: boolean;
    connected: boolean;
    mode: 'live' | 'test' | null;
    appEnv?: 'production' | 'staging';
    isStaging?: boolean;
    isTestMode?: boolean;
    firebaseConfigured?: boolean;
    firebaseProjectId?: string | null;
    hasSubaccount?: boolean;
    balances?: Array<{ currency: string; balance: number }>;
    totals?: { totalTransactions: number; volumesByCurrency: Array<{ currency: string; amount: number }> };
    settlements?: Array<{ id: number; date: string; amount: number; currency: string; status: string }>;
    error?: string;
  }>({ loading: true, connected: false, mode: null });

  const getAdminAuthHeaders = async (extra: Record<string, string> = {}): Promise<Record<string, string>> => {
    if (!user) {
      throw new Error(`Producer sign-in (${PRODUCER_ADMIN_EMAIL}) required.`);
    }
    const idToken = await user.getIdToken();
    return {
      Authorization: `Bearer ${idToken}`,
      ...extra,
    };
  };

  useEffect(() => {
    return subscribeGmailToken(setGmailToken);
  }, []);

  const handleConnectGmail = async () => {
    setConnectingGmail(true);
    setStatusBanner('');
    try {
      const token = await signInProducerWithGmail();
      if (token) {
        setStatusBanner(`Gmail connected. You can send or resend beat files & license certificates from ${BRAND_CONFIG.studioPortalName}.`);
      } else {
        setStatusBanner('Signed in, but Gmail send access was not granted. Click Connect Gmail and allow Gmail send permission.');
      }
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Unable to connect Gmail.');
    } finally {
      setConnectingGmail(false);
    }
  };

  // Upload Beat form state
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState<BeatGenre>('Afrobeats');
  const [bpm, setBpm] = useState(112);
  const [musicalKey, setMusicalKey] = useState('F# Min');
  const [mood, setMood] = useState('Warm · Bounce · Studio Mastered');
  const [coverUrl, setCoverUrl] = useState(STUDIO_COVERS[0].url);
  const [mp3Price, setMp3Price] = useState(29);
  const [wavPrice, setWavPrice] = useState(59);
  const [stemsPrice, setStemsPrice] = useState(149);
  const [exclusivePrice, setExclusivePrice] = useState(499);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [wavFile, setWavFile] = useState<File | null>(null);
  const [wavProgress, setWavProgress] = useState<number | null>(null);
  const [wavReadyUrl, setWavReadyUrl] = useState<string | null>(null);
  const [stemsFile, setStemsFile] = useState<File | null>(null);
  const [stemsProgress, setStemsProgress] = useState<number | null>(null);
  const [stemsReadyUrl, setStemsReadyUrl] = useState<string | null>(null);
  const [uploadingBeat, setUploadingBeat] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadReadyUrl, setUploadReadyUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');
  const preUploadRef = useRef<{
    fileKey: string;
    promise: Promise<{ audioUrl: string; durationSec: number }>;
  } | null>(null);

  // Edit Beat modal state
  const [editingBeat, setEditingBeat] = useState<Beat | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editGenre, setEditGenre] = useState<BeatGenre>('Afrobeats');
  const [editBpm, setEditBpm] = useState(120);
  const [editKey, setEditKey] = useState('F# Min');
  const [editMood, setEditMood] = useState('');
  const [editCoverUrl, setEditCoverUrl] = useState('');
  const [editMp3Price, setEditMp3Price] = useState(29);
  const [editWavPrice, setEditWavPrice] = useState(59);
  const [editStemsPrice, setEditStemsPrice] = useState(149);
  const [editExclusivePrice, setEditExclusivePrice] = useState(499);
  const [savingEdit, setSavingEdit] = useState(false);

  // Bank MasterCard Payout Config form
  const [mcHolder, setMcHolder] = useState('Enock Gyamfi');
  const [mcBank, setMcBank] = useState('');
  const [mcLast4, setMcLast4] = useState('');
  const [mcCountry, setMcCountry] = useState('Ghana');
  const [mcCurrency, setMcCurrency] = useState<CurrencyCode>('USD');

  // MTN Mobile Money Payout Config form
  const [momoHolder, setMomoHolder] = useState('Enock Gyamfi');
  const [momoNetwork, setMomoNetwork] = useState('MTN Mobile Money Ghana');
  const [momoPhone, setMomoPhone] = useState('');
  const [momoCountry, setMomoCountry] = useState('Ghana');
  const [momoCurrency, setMomoCurrency] = useState<CurrencyCode>('GHS');

  // Withdrawal form
  const [withdrawMethod, setWithdrawMethod] = useState<'bank_mastercard' | 'mtn_momo'>('mtn_momo');
  const [withdrawAmountUsd, setWithdrawAmountUsd] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  useEffect(() => {
    if (!isAdmin || !user) return;
    let active = true;

    const loadProducerData = async () => {
      try {
        const idToken = await user.getIdToken();
        const authHeaders = { Authorization: `Bearer ${idToken}` };
        // Load server orders & payouts (authenticated)
        const [ordersRes, payoutsRes] = await Promise.all([
          fetch('/api/orders', { headers: authHeaders }),
          fetch('/api/payouts', { headers: authHeaders }),
        ]);
        const serverOrdersJson = (await ordersRes.json()) as { orders?: OrderRecord[] };
        const serverPayoutsJson = (await payoutsRes.json()) as {
          payoutConfigs?: PayoutConfig[];
          payoutRequests?: PayoutRequest[];
        };

        // Load Firestore orders, payoutConfigs, payoutRequests
        const [fsOrdersSnap, fsConfigsSnap, fsReqsSnap] =
          isFirebaseConfigured && db
            ? await Promise.all([
                getDocs(collection(db, 'orders')).catch((err) => {
                  handleFirestoreError(err, OperationType.LIST, 'orders');
                  return null;
                }),
                getDocs(collection(db, 'payoutConfigs')).catch((err) => {
                  handleFirestoreError(err, OperationType.LIST, 'payoutConfigs');
                  return null;
                }),
                getDocs(collection(db, 'payoutRequests')).catch((err) => {
                  handleFirestoreError(err, OperationType.LIST, 'payoutRequests');
                  return null;
                }),
              ])
            : [null, null, null];

        const fsOrders: OrderRecord[] =
          fsOrdersSnap?.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              buyerUid: String(data.buyerUid),
              buyerName: String(data.buyerName),
              buyerEmail: String(data.buyerEmail),
              paymentMethod: data.paymentMethod,
              paymentReference: String(data.paymentReference),
              totalAmount: Number(data.totalAmount),
              currency: data.currency,
              usdEquivalent:
                data.currency === 'GHS'
                  ? Number(data.totalAmount) / USD_TO_GHS_RATE
                  : Number(data.totalAmount),
              status: data.status,
              itemsPreview: String(data.itemsPreview || ''),
              items: [],
              createdAtIso: data.createdAt?.toDate
                ? data.createdAt.toDate().toISOString()
                : new Date().toISOString(),
            };
          }) || [];

        const orderMap = new Map<string, OrderRecord>();
        for (const o of [...fsOrders, ...(serverOrdersJson.orders || [])]) {
          const prev = orderMap.get(o.id);
          orderMap.set(
            o.id,
            prev
              ? {
                  ...prev,
                  ...o,
                  items: o.items.length > 0 ? o.items : prev.items,
                  itemsPreview: o.itemsPreview || prev.itemsPreview,
                  status: o.status === 'completed' || prev.status === 'completed' ? 'completed' : 'pending',
                }
              : o
          );
        }

        const fsConfigs: PayoutConfig[] =
          fsConfigsSnap?.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              methodType: data.methodType,
              accountLabel: String(data.accountLabel),
              accountHolderName: String(data.accountHolderName),
              institutionOrNetwork: String(data.institutionOrNetwork),
              maskedIdentifier: String(data.maskedIdentifier),
              currency: data.currency,
              country: String(data.country),
              isDefault: Boolean(data.isDefault),
            };
          }) || [];

        const configMap = new Map<string, PayoutConfig>();
        for (const c of [...(serverPayoutsJson.payoutConfigs || []), ...fsConfigs]) {
          configMap.set(c.id, c);
        }

        const fsReqs: PayoutRequest[] =
          fsReqsSnap?.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              methodType: data.methodType,
              destinationSummary: String(data.destinationSummary),
              amountUsd: Number(data.amountUsd),
              currency: data.currency,
              referenceCode: String(data.referenceCode),
              status: data.status,
              createdAtIso: data.createdAt?.toDate
                ? data.createdAt.toDate().toISOString()
                : new Date().toISOString(),
            };
          }) || [];

        const reqMap = new Map<string, PayoutRequest>();
        for (const r of [...(serverPayoutsJson.payoutRequests || []), ...fsReqs]) {
          reqMap.set(r.id, r);
        }

        if (!active) return;

        const mergedConfigs = Array.from(configMap.values());
        setOrders(Array.from(orderMap.values()));
        setPayoutConfigs(mergedConfigs);
        setPayoutRequests(Array.from(reqMap.values()));

        const savedMc = mergedConfigs.find((c) => c.methodType === 'bank_mastercard');
        if (savedMc) {
          setMcHolder(savedMc.accountHolderName);
          setMcBank(savedMc.institutionOrNetwork);
          setMcLast4(savedMc.maskedIdentifier);
          setMcCountry(savedMc.country);
          setMcCurrency(savedMc.currency);
        }

        const savedMomo = mergedConfigs.find((c) => c.methodType === 'mtn_momo');
        if (savedMomo) {
          setMomoHolder(savedMomo.accountHolderName);
          setMomoNetwork(savedMomo.institutionOrNetwork);
          setMomoPhone(savedMomo.maskedIdentifier);
          setMomoCountry(savedMomo.country);
          setMomoCurrency(savedMomo.currency);
        }

        // Load Paystack Merchant Account status via server-side proxy
        try {
          const idToken = await user.getIdToken();
          const psRes = await fetch('/api/paystack/account', {
            headers: { Authorization: `Bearer ${idToken}` },
          });
          const psJson = (await psRes.json()) as {
            connected?: boolean;
            mode?: 'live' | 'test' | null;
            appEnv?: 'production' | 'staging';
            isStaging?: boolean;
            isTestMode?: boolean;
            firebaseConfigured?: boolean;
            firebaseProjectId?: string | null;
            hasSubaccount?: boolean;
            balances?: Array<{ currency: string; balance: number }>;
            totals?: { totalTransactions: number; volumesByCurrency: Array<{ currency: string; amount: number }> };
            settlements?: Array<{ id: number; date: string; amount: number; currency: string; status: string }>;
            error?: string;
          };
          if (active) {
            setPaystackAccount({
              loading: false,
              connected: Boolean(psJson.connected),
              mode: psJson.mode || null,
              appEnv: psJson.appEnv,
              isStaging: psJson.isStaging,
              isTestMode: psJson.isTestMode,
              firebaseConfigured: psJson.firebaseConfigured,
              firebaseProjectId: psJson.firebaseProjectId,
              hasSubaccount: psJson.hasSubaccount,
              balances: psJson.balances,
              totals: psJson.totals,
              settlements: psJson.settlements,
              error: psJson.error,
            });
          }
        } catch {
          if (active) {
            setPaystackAccount({ loading: false, connected: false, mode: null });
          }
        }
      } catch (err) {
        console.error('Failed loading producer studio:', err);
      }
    };

    loadProducerData();
    return () => {
      active = false;
    };
  }, [isAdmin, user]);

  if (!isAdmin) {
    const showStagingTestBanner = isStagingEnv || initialRuntimeConfig.isTestMode || initialRuntimeConfig.paystackMode === 'test';
    return (
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-20">
        <div className="border border-white/10 bg-[#131316] rounded-xl p-8 sm:p-10 space-y-5">
          {showStagingTestBanner && (
            <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-400/35 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong className="text-amber-300">[TEST MODE]</strong>{' '}
                {isStagingEnv ? 'Staging Studio Environment' : 'Paystack Test Mode Active'}
                {activeFirebaseProjectId ? ` · Firebase: ${activeFirebaseProjectId}` : ''}
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                SANDBOX
              </span>
            </div>
          )}
          <div className="w-11 h-11 rounded-lg bg-[#1B1B20] border border-white/10 flex items-center justify-center text-[#D99B38]">
            <Lock className="w-5 h-5" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-[#F5F4F0]">
              {BRAND_CONFIG.brandName} Producer Studio
            </h1>
            <p className="text-sm text-[#9C9A94] leading-relaxed">
              Sign in with the verified producer Google account ({PRODUCER_ADMIN_EMAIL}) to upload new beats, manage catalog pricing, configure Bank MasterCard &amp; MTN Mobile Money payouts, and withdraw earnings.
            </p>
            {!isFirebaseConfigured && (
              <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded-lg p-3 leading-relaxed">
                Staging Firebase environment variables are not configured yet. Add <code>FIREBASE_API_KEY</code>, <code>FIREBASE_AUTH_DOMAIN</code>, <code>FIREBASE_PROJECT_ID</code>, <code>FIREBASE_APP_ID</code>, and <code>FIREBASE_DATABASE_ID</code> in Render staging environment variables to enable Producer Google Sign-In on staging.
              </p>
            )}
            {user && (
              <p className="text-xs text-amber-400">
                Currently signed in as {user.email}. Switch to {PRODUCER_ADMIN_EMAIL} for Producer Admin access.
              </p>
            )}
          </div>
          <GoogleSignInButton
            label={connectingGmail ? 'Signing In...' : 'Sign In as Producer & Connect Gmail'}
            onClick={() => void handleConnectGmail()}
            disabled={connectingGmail || !isFirebaseConfigured}
          />
        </div>
      </section>
    );
  }

  const completedOrders = orders.filter((o) => o.status === 'completed');

  const grossUsd = completedOrders.reduce(
    (sum, o) =>
      sum +
      (o.usdEquivalent ??
        (o.currency === 'GHS' ? o.totalAmount / USD_TO_GHS_RATE : o.totalAmount)),
    0
  );
  const withdrawnUsd = payoutRequests.reduce((sum, p) => sum + p.amountUsd, 0);
  const availableUsd = Math.max(0, grossUsd - withdrawnUsd);
  const totalPlays = beats.reduce((sum, b) => sum + (b.plays || 0), 0);

  const handleResendOrderEmail = async (order: OrderRecord) => {
    setBusyOrderId(order.id);
    setStatusBanner('');
    try {
      const headers = await getAdminAuthHeaders({ 'Content-Type': 'application/json' });
      if (gmailToken) {
        headers['X-Gmail-Access-Token'] = gmailToken;
      }
      const res = await fetch(`/api/orders/${encodeURIComponent(order.id)}/resend-email`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: order.buyerEmail }),
      });
      const data = (await res.json()) as {
        order?: OrderRecord;
        message?: string;
        error?: string;
        needsGmailReconnect?: boolean;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to resend delivery email.');
      }
      if (data.needsGmailReconnect) {
        clearGmailAccessToken();
      }
      if (data.order) {
        setOrders((prev) => prev.map((o) => (o.id === data.order!.id ? data.order! : o)));
      }
      setStatusBanner(data.message || `Beat email resent to ${order.buyerEmail}.`);
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Failed to resend email.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const readApiJson = async <T,>(res: Response): Promise<T> => {
    const rawText = await res.text();
    if (!rawText) return {} as T;
    try {
      return JSON.parse(rawText) as T;
    } catch {
      throw new Error(
        res.ok
          ? 'Unexpected server response format.'
          : `Upload failed (${res.status} ${res.statusText || 'Server Error'}).`
      );
    }
  };

  const detectAudioDurationSec = (file: File): Promise<number> =>
    new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(file);
      const probe = new Audio();
      let settled = false;
      const finish = (secs: number) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(objectUrl);
        resolve(secs);
      };
      const timer = window.setTimeout(() => finish(180), 2500);
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        window.clearTimeout(timer);
        const raw = Number.isFinite(probe.duration) ? Math.round(probe.duration) : 180;
        finish(Math.min(1200, Math.max(10, raw || 180)));
      };
      probe.onerror = () => {
        window.clearTimeout(timer);
        finish(180);
      };
      probe.src = objectUrl;
    });

  const getFileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

  const uploadSingleRequestWithProgress = async (
    file: File,
    onProgress: (pct: number) => void
  ): Promise<string> => {
    const authHeaders = await getAdminAuthHeaders();
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('audio', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload-audio');
      xhr.setRequestHeader('Authorization', authHeaders.Authorization);
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && evt.total > 0) {
          onProgress(Math.min(99, Math.round((evt.loaded / evt.total) * 100)));
        }
      };
      xhr.onload = () => {
        try {
          const parsed = JSON.parse(xhr.responseText || '{}') as { audioUrl?: string; error?: string };
          if (xhr.status >= 200 && xhr.status < 300 && parsed.audioUrl) {
            onProgress(100);
            resolve(parsed.audioUrl);
          } else {
            reject(new Error(parsed.error || `Audio upload failed (${xhr.status}).`));
          }
        } catch {
          reject(new Error(`Audio upload failed (${xhr.status}).`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error while uploading audio file.'));
      xhr.send(formData);
    });
  };

  const uploadStudioAsset = async (
    file: File,
    onProgress: (pct: number) => void,
    isStillValid: () => boolean = () => true
  ): Promise<string> => {
    const maxBytes = 150 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error('File exceeds the 150 MB studio upload limit.');
    }

    // Files up to 12 MB upload in a single fast XHR request with real-time progress
    const singleLimit = 12 * 1024 * 1024;
    if (file.size <= singleLimit) {
      return uploadSingleRequestWithProgress(file, (pct) => {
        if (isStillValid()) onProgress(pct);
      });
    }

    // Larger WAV masters or trackout stems upload in 8 MB parallel chunks (4 concurrent workers)
    const authHeaders = await getAdminAuthHeaders();
    const chunkSize = 8 * 1024 * 1024;
    const uploadId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const totalChunks = Math.ceil(file.size / chunkSize);
    let completedChunks = 0;
    let nextIdx = 0;

    const uploadWorker = async () => {
      while (nextIdx < totalChunks) {
        if (!isStillValid()) return;
        const idx = nextIdx++;
        const start = idx * chunkSize;
        const end = Math.min(file.size, start + chunkSize);
        const slice = file.slice(start, end);
        const chunkRes = await fetch('/api/upload-audio/chunk', {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/octet-stream',
            'X-Upload-Id': uploadId,
            'X-Chunk-Index': String(idx),
          },
          body: slice,
        });
        const chunkJson = await readApiJson<{ ok?: boolean; error?: string }>(chunkRes);
        if (!chunkRes.ok || !chunkJson.ok) {
          throw new Error(chunkJson.error || `Failed uploading file part ${idx + 1} of ${totalChunks}.`);
        }
        completedChunks += 1;
        if (isStillValid()) {
          onProgress(Math.min(95, Math.round((completedChunks / totalChunks) * 90)));
        }
      }
    };

    const workers = Array.from({ length: Math.min(4, totalChunks) }, () => uploadWorker());
    await Promise.all(workers);

    if (!isStillValid()) {
      throw new Error('Superseded by newer file selection.');
    }

    const completeRes = await fetch('/api/upload-audio/complete', {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uploadId,
        originalName: file.name,
        totalChunks,
      }),
    });
    const completeJson = await readApiJson<{ audioUrl?: string; error?: string }>(completeRes);
    if (!completeRes.ok || !completeJson.audioUrl) {
      throw new Error(completeJson.error || 'Unable to finalize uploaded file.');
    }
    if (isStillValid()) onProgress(100);
    return completeJson.audioUrl;
  };

  const uploadAudioMaster = async (file: File, fileKey: string): Promise<string> => {
    const isCurrentFile = () =>
      !preUploadRef.current || preUploadRef.current.fileKey === fileKey;
    return uploadStudioAsset(
      file,
      (pct) => setUploadProgress(pct),
      isCurrentFile
    );
  };

  const startBackgroundTierUpload = async (
    file: File,
    tier: 'wav' | 'stems'
  ) => {
    setUploadError('');
    if (tier === 'wav') {
      setWavReadyUrl(null);
      setWavProgress(2);
    } else {
      setStemsReadyUrl(null);
      setStemsProgress(2);
    }
    try {
      const url = await uploadStudioAsset(file, (pct) => {
        if (tier === 'wav') setWavProgress(pct);
        else setStemsProgress(pct);
      });
      if (tier === 'wav') {
        setWavReadyUrl(url);
        setWavProgress(100);
      } else {
        setStemsReadyUrl(url);
        setStemsProgress(100);
      }
    } catch (err) {
      if (tier === 'wav') {
        setWavProgress(null);
        setWavReadyUrl(null);
      } else {
        setStemsProgress(null);
        setStemsReadyUrl(null);
      }
      setUploadError(err instanceof Error ? err.message : `Unable to upload ${tier.toUpperCase()} asset.`);
    }
  };

  const startBackgroundAudioUpload = (file: File) => {
    const fileKey = getFileKey(file);
    setUploadError('');
    setUploadReadyUrl(null);
    setUploadProgress(2);

    const promise = Promise.all([
      uploadAudioMaster(file, fileKey),
      detectAudioDurationSec(file),
    ]).then(([audioUrl, durationSec]) => {
      if (preUploadRef.current?.fileKey === fileKey) {
        setUploadReadyUrl(audioUrl);
        setUploadProgress(100);
      }
      return { audioUrl, durationSec };
    });

    preUploadRef.current = { fileKey, promise };
    promise.catch((err) => {
      if (preUploadRef.current?.fileKey === fileKey) {
        preUploadRef.current = null;
        setUploadProgress(null);
        setUploadReadyUrl(null);
        setUploadError(err instanceof Error ? err.message : 'Audio upload failed.');
      }
    });
    return promise;
  };

  const handleUploadBeat = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError('');
    setStatusBanner('');

    if (!user) {
      setUploadError('Sign in with your producer Google account before publishing.');
      return;
    }

    const cleanTitle = title.trim().slice(0, 100);
    if (cleanTitle.length < 2) {
      setUploadError('Beat title must be at least 2 characters long.');
      return;
    }

    const numericBpm = Number(bpm);
    if (!Number.isFinite(numericBpm) || numericBpm < 40 || numericBpm > 240) {
      setUploadError('Tempo (BPM) must be between 40 and 240.');
      return;
    }

    setUploadingBeat(true);

    try {
      const beatId = `beat_${Date.now()}`;
      let resolvedAudioUrl = `/api/audio/synth/${beatId}`;
      let detectedDurationSec = 180;

      if (audioFile) {
        const key = getFileKey(audioFile);
        const activePreUpload =
          preUploadRef.current && preUploadRef.current.fileKey === key
            ? preUploadRef.current.promise
            : startBackgroundAudioUpload(audioFile);
        const uploaded = await activePreUpload;
        resolvedAudioUrl = uploaded.audioUrl;
        detectedDurationSec = uploaded.durationSec;
      }

      const resolvedWavUrl =
        wavReadyUrl || (wavFile ? await uploadStudioAsset(wavFile, (pct) => setWavProgress(pct)) : undefined);
      const resolvedStemsUrl =
        stemsReadyUrl || (stemsFile ? await uploadStudioAsset(stemsFile, (pct) => setStemsProgress(pct)) : undefined);

      const rawMood = mood.trim().slice(0, 80);
      const safeMood = rawMood.length >= 2 ? rawMood : 'Studio Mastered';
      const safeKey = musicalKey.trim().slice(0, 16) || 'C Min';
      const safeMp3 = Math.min(10000, Math.max(1, Number(mp3Price) || 29));
      const safeWav = Math.min(10000, Math.max(1, Number(wavPrice) || 59));
      const safeStems = Math.min(20000, Math.max(1, Number(stemsPrice) || 149));
      const safeExclusive = Math.min(100000, Math.max(1, Number(exclusivePrice) || 499));

      const firestoreBeatPayload = {
        title: cleanTitle,
        genre,
        bpm: Math.round(numericBpm),
        musicalKey: safeKey,
        durationSec: detectedDurationSec,
        mood: safeMood,
        coverUrl: coverUrl.slice(0, 500),
        audioUrl: resolvedAudioUrl.slice(0, 500),
        mp3Price: safeMp3,
        wavPrice: safeWav,
        stemsPrice: safeStems,
        exclusivePrice: safeExclusive,
        plays: 0,
        published: true,
        producerUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const fsSyncPromise =
        isFirebaseConfigured && db
          ? setDoc(doc(db, 'beats', beatId), firestoreBeatPayload).catch((fsErr) => {
              try {
                handleFirestoreError(fsErr, OperationType.CREATE, `beats/${beatId}`);
              } catch {
                // Beat is saved on the server catalog; keep studio flow fast and resilient
              }
            })
          : Promise.resolve();

      const authHeaders = await getAdminAuthHeaders({ 'Content-Type': 'application/json' });
      const serverRes = await fetch('/api/beats', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          id: beatId,
          ...firestoreBeatPayload,
          wavUrl: resolvedWavUrl,
          stemsUrl: resolvedStemsUrl,
          createdAt: undefined,
          updatedAt: undefined,
        }),
      });
      const serverJson = await readApiJson<{ beat?: Beat; error?: string }>(serverRes);
      if (!serverRes.ok || !serverJson.beat) {
        throw new Error(serverJson.error || 'Failed saving beat to studio catalog.');
      }

      // Let quick Firestore write finish, but never stall UI beyond 1.2s
      await Promise.race([
        fsSyncPromise,
        new Promise((resolve) => window.setTimeout(resolve, 1200)),
      ]);

      preUploadRef.current = null;
      setTitle('');
      setAudioFile(null);
      setUploadProgress(null);
      setUploadReadyUrl(null);
      setWavFile(null);
      setWavProgress(null);
      setWavReadyUrl(null);
      setStemsFile(null);
      setStemsProgress(null);
      setStemsReadyUrl(null);
      setUploadError('');
      setStatusBanner(`"${cleanTitle}" is live in the ${BRAND_CONFIG.brandName} storefront.`);
      onBeatsUpdated();
      setActiveTab('overview');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to publish beat.';
      setUploadError(msg);
      setStatusBanner(msg);
    } finally {
      setUploadingBeat(false);
    }
  };

  const openEditBeatModal = (beat: Beat) => {
    setEditingBeat(beat);
    setEditTitle(beat.title);
    setEditGenre(beat.genre);
    setEditBpm(beat.bpm);
    setEditKey(beat.musicalKey);
    setEditMood(beat.mood);
    setEditCoverUrl(beat.coverUrl);
    setEditMp3Price(beat.mp3Price);
    setEditWavPrice(beat.wavPrice);
    setEditStemsPrice(beat.stemsPrice);
    setEditExclusivePrice(beat.exclusivePrice);
  };

  const handleSaveEditBeat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBeat) return;
    const cleanTitle = editTitle.trim().slice(0, 100);
    if (cleanTitle.length < 2) {
      setStatusBanner('Beat title must be at least 2 characters long.');
      return;
    }
    const numericBpm = Math.min(240, Math.max(40, Math.round(Number(editBpm) || 120)));
    const safeKey = editKey.trim().slice(0, 16) || 'C Min';
    const safeMood = editMood.trim().slice(0, 80) || 'Studio Mastered';
    const safeCover = editCoverUrl.trim().slice(0, 500) || editingBeat.coverUrl;
    const safeMp3 = Math.min(10000, Math.max(1, Number(editMp3Price) || 29));
    const safeWav = Math.min(10000, Math.max(1, Number(editWavPrice) || 59));
    const safeStems = Math.min(20000, Math.max(1, Number(editStemsPrice) || 149));
    const safeExclusive = Math.min(100000, Math.max(1, Number(editExclusivePrice) || 499));

    setSavingEdit(true);
    setStatusBanner('');
    try {
      const updateFields = {
        title: cleanTitle,
        genre: editGenre,
        bpm: numericBpm,
        musicalKey: safeKey,
        mood: safeMood,
        coverUrl: safeCover,
        mp3Price: safeMp3,
        wavPrice: safeWav,
        stemsPrice: safeStems,
        exclusivePrice: safeExclusive,
      };

      const authHeaders = await getAdminAuthHeaders({ 'Content-Type': 'application/json' });
      const patchPromise = fetch(`/api/beats/${encodeURIComponent(editingBeat.id)}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify(updateFields),
      });

      const fsUpdatePromise =
        isFirebaseConfigured && db
          ? updateDoc(doc(db, 'beats', editingBeat.id), {
              ...updateFields,
              updatedAt: serverTimestamp(),
            }).catch((err) => {
              if (err instanceof Error && err.message.includes('No document to update')) {
                return;
              }
              handleFirestoreError(err, OperationType.UPDATE, `beats/${editingBeat.id}`);
            })
          : Promise.resolve();

      const [patchRes] = await Promise.all([patchPromise, fsUpdatePromise]);
      if (!patchRes.ok && patchRes.status !== 404) {
        const errData = (await patchRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || 'Unable to save beat changes.');
      }

      setStatusBanner(`Updated "${cleanTitle}" in the ${BRAND_CONFIG.brandName} catalog.`);
      setEditingBeat(null);
      onBeatsUpdated();
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Unable to save beat edits.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleTogglePublish = async (beat: Beat) => {
    try {
      const authHeaders = await getAdminAuthHeaders({ 'Content-Type': 'application/json' });
      await Promise.all([
        isFirebaseConfigured && db
          ? updateDoc(doc(db, 'beats', beat.id), {
              published: !beat.published,
              updatedAt: serverTimestamp(),
            }).catch((err) => {
              if (err instanceof Error && err.message.includes('No document to update')) {
                return;
              }
              handleFirestoreError(err, OperationType.UPDATE, `beats/${beat.id}`);
            })
          : Promise.resolve(),
        fetch(`/api/beats/${encodeURIComponent(beat.id)}`, {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({ published: !beat.published }),
        }),
      ]);
      onBeatsUpdated();
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Unable to update beat visibility.');
    }
  };

  const handleDeleteBeat = async (beat: Beat) => {
    try {
      const authHeaders = await getAdminAuthHeaders();
      await Promise.all([
        isFirebaseConfigured && db
          ? deleteDoc(doc(db, 'beats', beat.id)).catch((err) => {
              handleFirestoreError(err, OperationType.DELETE, `beats/${beat.id}`);
            })
          : Promise.resolve(),
        fetch(`/api/beats/${encodeURIComponent(beat.id)}`, {
          method: 'DELETE',
          headers: authHeaders,
        }),
      ]);
      onBeatsUpdated();
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Unable to delete beat.');
    }
  };

  const handleClearAllBeats = async () => {
    try {
      const authHeaders = await getAdminAuthHeaders();
      const fsDeletes =
        isFirebaseConfigured && db
          ? await getDocs(collection(db, 'beats')).then((snap) =>
              snap.docs.map((d) => deleteDoc(doc(db!, 'beats', d.id)))
            )
          : [];
      await Promise.all([
        ...fsDeletes,
        fetch('/api/beats', { method: 'DELETE', headers: authHeaders }),
      ]);
      setStatusBanner('All beats have been cleared from your catalog.');
      onBeatsUpdated();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'beats');
    }
  };

  const handleSavePayoutConfig = async (
    methodType: 'bank_mastercard' | 'mtn_momo',
    e: React.FormEvent
  ) => {
    e.preventDefault();
    if (!user) return;
    setStatusBanner('');

    const isMc = methodType === 'bank_mastercard';
    const rawId = isMc ? mcLast4.trim() : momoPhone.trim();
    const maskedIdentifier = isMc
      ? rawId.includes('•')
        ? rawId
        : `•••• •••• •••• ${rawId.replace(/\D/g, '').slice(-4) || '0000'}`
      : rawId;

    const payload = {
      methodType,
      accountLabel: isMc ? 'Bank MasterCard Payout' : 'MTN Mobile Money Wallet',
      accountHolderName: (isMc ? mcHolder : momoHolder).trim(),
      institutionOrNetwork: (isMc ? mcBank : momoNetwork).trim(),
      maskedIdentifier,
      currency: isMc ? mcCurrency : momoCurrency,
      country: (isMc ? mcCountry : momoCountry).trim() || 'Ghana',
      isDefault: true,
      ownerUid: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'payoutConfigs', methodType), payload);
      } catch (fsErr) {
        handleFirestoreError(fsErr, OperationType.WRITE, `payoutConfigs/${methodType}`);
      }
    }

    const authHeaders = await getAdminAuthHeaders({ 'Content-Type': 'application/json' });
    await fetch('/api/payouts/config', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ id: methodType, ...payload, createdAt: undefined, updatedAt: undefined }),
    });

    setPayoutConfigs((prev) => {
      const next = prev.filter((p) => p.id !== methodType);
      next.push({ id: methodType, ...payload, ownerUid: user.uid });
      return next;
    });
    setStatusBanner(
      isMc
        ? 'Bank MasterCard payout account saved.'
        : 'MTN Mobile Money payout wallet saved.'
    );
  };

  const handleRequestPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const amt = Number(withdrawAmountUsd);
    if (!amt || amt <= 0) {
      setStatusBanner('Enter a valid withdrawal amount.');
      return;
    }

    const matchingConfig = payoutConfigs.find((c) => c.methodType === withdrawMethod);
    if (!matchingConfig) {
      setStatusBanner(
        `Please save your ${withdrawMethod === 'mtn_momo' ? 'MTN Mobile Money' : 'Bank MasterCard'} account details first.`
      );
      setActiveTab('payout_accounts');
      return;
    }

    setWithdrawing(true);
    setStatusBanner('');
    try {
      const authHeaders = await getAdminAuthHeaders({ 'Content-Type': 'application/json' });
      const destinationSummary = `${matchingConfig.institutionOrNetwork} (${matchingConfig.maskedIdentifier})`;
      const res = await fetch('/api/payouts/withdraw', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          methodType: withdrawMethod,
          destinationSummary,
          amountUsd: amt,
          currency: matchingConfig.currency,
        }),
      });
      const data = (await res.json()) as { payout?: PayoutRequest; error?: string };
      if (!res.ok || !data.payout) {
        throw new Error(data.error || 'Payout request failed.');
      }

      if (isFirebaseConfigured && db) {
        try {
          await setDoc(doc(db, 'payoutRequests', data.payout.id), {
            ownerUid: user.uid,
            methodType: data.payout.methodType,
            destinationSummary: data.payout.destinationSummary,
            amountUsd: data.payout.amountUsd,
            currency: data.payout.currency,
            referenceCode: data.payout.referenceCode,
            status: 'settled',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (fsErr) {
          handleFirestoreError(fsErr, OperationType.CREATE, `payoutRequests/${data.payout.id}`);
        }
      }

      setPayoutRequests((prev) => [data.payout!, ...prev]);
      setWithdrawAmountUsd('');
      setStatusBanner(`Payout ${data.payout.referenceCode} sent to ${destinationSummary}.`);
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Unable to process withdrawal.');
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      {/* Header */}
      {(isStagingEnv || paystackAccount.isStaging || paystackAccount.mode === 'test' || paystackAccount.isTestMode) && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-400/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-300">
              [TEST MODE] · {isStagingEnv || paystackAccount.isStaging ? 'Staging Environment' : 'Paystack Test Mode Active'}
            </p>
            <p className="text-xs text-amber-100/90">
              Isolated Paystack Test Mode ({paystackAccount.mode === 'test' ? 'sk_test_' : 'Sandbox'})
              {(paystackAccount.firebaseProjectId || activeFirebaseProjectId)
                ? ` · Firebase Project: ${paystackAccount.firebaseProjectId || activeFirebaseProjectId}`
                : ''}
              {' · '}Separate storage &amp; no live production charges.
            </p>
          </div>
          <span className="px-2.5 py-1 rounded bg-amber-500/20 border border-amber-400/40 text-[11px] font-bold uppercase tracking-wider text-amber-300 self-start sm:self-center shrink-0">
            TEST MODE
          </span>
        </div>
      )}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <p className="text-xs text-[#9C9A94] mb-1">
            Producer Management · {isStagingEnv || paystackAccount.isStaging ? 'STAGING' : BRAND_CONFIG.domain} · {user?.email}
          </p>
          <h1 className="text-3xl font-semibold text-[#F5F4F0] tracking-tight">
            {BRAND_CONFIG.studioPortalName}
          </h1>
        </div>

        {/* Studio Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#131316] border border-white/10 rounded-lg">
          {(
            [
              ['overview', 'Overview & Sales'],
              ['upload', 'Upload Beat'],
              ['payout_accounts', 'Payout Accounts'],
              ['withdrawals', 'Withdrawals'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === id
                  ? 'bg-[#D99B38] text-[#0B0B0D]'
                  : 'text-[#9C9A94] hover:text-[#F5F4F0]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {statusBanner && (
        <div className="p-4 rounded-lg bg-[#1B1B20] border border-[#D99B38]/40 flex items-center gap-2.5 text-sm text-[#F5F4F0]">
          <CheckCircle2 className="w-4 h-4 text-[#D99B38] shrink-0" />
          <span>{statusBanner}</span>
        </div>
      )}

      {/* TAB 1: OVERVIEW & SALES */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          {/* Gmail Auto-Delivery Connection Bar */}
          <div className="p-4 sm:px-6 rounded-xl bg-[#131316] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#1B1B20] border border-white/10 flex items-center justify-center shrink-0">
                <Mail className={`w-4 h-4 ${gmailToken ? 'text-emerald-400' : 'text-[#D99B38]'}`} />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#F5F4F0]">
                  {gmailToken
                    ? 'Gmail Email Delivery Connected'
                    : 'Connect Gmail for Email Receipts'}
                </p>
                <p className="text-xs text-[#9C9A94]">
                  {gmailToken
                    ? `Send or resend beat files & license certificates from ${user?.email}.`
                    : `Authorize ${PRODUCER_ADMIN_EMAIL} to email beat audio & licenses to buyers from your studio ledger.`}
                </p>
              </div>
            </div>
            {gmailToken ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 shrink-0">
                <CheckCircle2 className="w-4 h-4" />
                <span>Ready to Auto-Send</span>
              </span>
            ) : (
              <div className="shrink-0">
                <GoogleSignInButton
                  label={connectingGmail ? 'Connecting...' : 'Connect Gmail'}
                  onClick={() => void handleConnectGmail()}
                  disabled={connectingGmail}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl bg-[#131316] border border-white/10 space-y-1">
              <p className="text-xs text-[#9C9A94]">Available for Payout</p>
              <p className="text-2xl font-semibold text-[#D99B38] font-mono-tabular">
                {formatMoney(availableUsd, currency)}
              </p>
              <p className="text-xs text-[#9C9A94] font-mono-tabular">
                ₵{(availableUsd * USD_TO_GHS_RATE).toFixed(2)} GHS
              </p>
            </div>
            <div className="p-5 rounded-xl bg-[#131316] border border-white/10 space-y-1">
              <p className="text-xs text-[#9C9A94]">Gross Beat Sales</p>
              <p className="text-2xl font-semibold text-[#F5F4F0] font-mono-tabular">
                {formatMoney(grossUsd, currency)}
              </p>
              <p className="text-xs text-[#9C9A94] font-mono-tabular">
                {completedOrders.length} paid orders
              </p>
            </div>
            <div className="p-5 rounded-xl bg-[#131316] border border-white/10 space-y-1">
              <p className="text-xs text-[#9C9A94]">Active Catalog</p>
              <p className="text-2xl font-semibold text-[#F5F4F0] font-mono-tabular">
                {beats.filter((b) => b.published).length} / {beats.length}
              </p>
              <p className="text-xs text-[#9C9A94]">Published instrumentals</p>
            </div>
            <div className="p-5 rounded-xl bg-[#131316] border border-white/10 space-y-1">
              <p className="text-xs text-[#9C9A94]">Catalog Auditions</p>
              <p className="text-2xl font-semibold text-[#F5F4F0] font-mono-tabular">
                {totalPlays.toLocaleString()}
              </p>
              <p className="text-xs text-[#9C9A94]">Total stream previews</p>
            </div>
          </div>

          {/* Manage Beats Table */}
          <div className="border border-white/10 bg-[#131316] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[#F5F4F0]">Catalog Beats</h2>
              <div className="flex items-center gap-2">
                {beats.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllBeats}
                    className="px-3 py-1.5 rounded-lg bg-[#1B1B20] border border-white/10 hover:border-red-400/50 text-xs font-medium text-[#9C9A94] hover:text-red-300 transition-colors cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveTab('upload')}
                  className="px-3.5 py-1.5 rounded-lg bg-[#D99B38] text-[#0B0B0D] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Beat</span>
                </button>
              </div>
            </div>
            {beats.length === 0 ? (
              <p className="px-6 py-8 text-sm text-[#9C9A94]">
                No beats in your catalog yet. Click &ldquo;New Beat&rdquo; to upload and publish your own instrumentals.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/10 text-xs text-[#9C9A94]">
                    <tr>
                      <th className="py-3 px-6 font-medium">Beat</th>
                      <th className="py-3 px-4 font-medium">Genre</th>
                      <th className="py-3 px-4 font-medium">BPM / Key</th>
                      <th className="py-3 px-4 font-medium">MP3 / WAV / Excl</th>
                      <th className="py-3 px-4 font-medium">Visibility</th>
                      <th className="py-3 px-6 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {beats.map((b) => (
                      <tr key={b.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-6 font-medium text-[#F5F4F0]">
                          <div className="flex flex-col gap-1">
                            <span>{b.title}</span>
                            <span className="text-[11px] text-[#9C9A94] font-mono-tabular">
                              {[
                                'MP3',
                                b.wavUrl || b.hasWavMaster ? 'WAV' : null,
                                b.stemsUrl || b.hasTrackoutStems ? 'Stems' : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-[#9C9A94]">{b.genre}</td>
                        <td className="py-3 px-4 text-[#9C9A94] font-mono-tabular">
                          {b.bpm} · {b.musicalKey}
                        </td>
                        <td className="py-3 px-4 text-[#F5F4F0] font-mono-tabular">
                          ${b.mp3Price} / ${b.wavPrice} / ${b.exclusivePrice}
                        </td>
                        <td className="py-3 px-4 text-xs">
                          {b.published ? (
                            <span className="text-[#D99B38]">Published</span>
                          ) : (
                            <span className="text-[#9C9A94]">Hidden</span>
                          )}
                        </td>
                        <td className="py-3 px-6 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditBeatModal(b)}
                              title="Edit beat details & pricing"
                              aria-label={`Edit ${b.title}`}
                              className="p-1.5 rounded-md text-[#9C9A94] hover:text-[#D99B38] hover:bg-white/5 cursor-pointer"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTogglePublish(b)}
                              title={b.published ? 'Hide from storefront' : 'Publish to storefront'}
                              className="p-1.5 rounded-md text-[#9C9A94] hover:text-[#F5F4F0] hover:bg-white/5 cursor-pointer"
                            >
                              {b.published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteBeat(b)}
                              title="Delete beat"
                              className="p-1.5 rounded-md text-[#9C9A94] hover:text-red-400 hover:bg-white/5 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Client Orders Ledger */}
          <div className="border border-white/10 bg-[#131316] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <h2 className="text-base font-semibold text-[#F5F4F0]">Client Purchases</h2>
            </div>
            {completedOrders.length === 0 ? (
              <p className="px-6 py-8 text-sm text-[#9C9A94]">
                No client purchases yet. Website Mastercard and MTN Mobile Money sales appear here immediately.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/10 text-xs text-[#9C9A94]">
                    <tr>
                      <th className="py-3 px-6 font-medium">Order</th>
                      <th className="py-3 px-4 font-medium">Client &amp; Email</th>
                      <th className="py-3 px-4 font-medium">Payment Rail</th>
                      <th className="py-3 px-4 font-medium">Items</th>
                      <th className="py-3 px-4 font-medium">Delivery</th>
                      <th className="py-3 px-6 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {completedOrders.map((o) => (
                      <tr key={o.id}>
                        <td className="py-3 px-6 font-mono-tabular text-[#F5F4F0]">
                          <div className="inline-flex items-center gap-1.5">
                            <span>{o.id}</span>
                            {o.isTestMode && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-[10px] font-bold uppercase text-amber-300">
                                TEST
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-[#D4D2CC]">
                          {o.buyerName} · <span className="text-[#9C9A94]">{o.buyerEmail}</span>
                        </td>
                        <td className="py-3 px-4 text-[#9C9A94]">
                          {o.paymentMethod === 'mtn_momo' ? 'MTN Mobile Money' : 'Mastercard'}
                        </td>
                        <td className="py-3 px-4 text-[#9C9A94] max-w-xs truncate">
                          {o.itemsPreview || o.items.map((i) => i.beatTitle).join(', ')}
                        </td>
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => handleResendOrderEmail(o)}
                            disabled={busyOrderId === o.id}
                            className="inline-flex items-center gap-1 text-xs text-[#D99B38] hover:text-[#E5A946] cursor-pointer disabled:opacity-60"
                          >
                            {o.emailDeliveryStatus === 'sent' ? (
                              <Mail className="w-3.5 h-3.5" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5" />
                            )}
                            <span>{o.emailDeliveryStatus === 'sent' ? 'Sent · Resend' : 'Send Beat Email'}</span>
                          </button>
                        </td>
                        <td className="py-3 px-6 text-right font-mono-tabular text-[#D99B38]">
                          {o.currency === 'GHS' ? `₵${o.totalAmount.toFixed(2)}` : `$${o.totalAmount.toFixed(2)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: UPLOAD BEAT */}
      {activeTab === 'upload' && (
        <form
          onSubmit={handleUploadBeat}
          className="border border-white/10 bg-[#131316] rounded-xl p-6 sm:p-8 max-w-3xl space-y-6"
        >
          <div>
            <h2 className="text-lg font-semibold text-[#F5F4F0]">Publish New Instrumental</h2>
            <p className="text-xs text-[#9C9A94] mt-1">
              Upload your studio MP3/WAV master file and set licensing prices.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[#D4D2CC] mb-1.5">Beat Title</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Kumasi Midnight"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] focus:outline-none focus:border-[#D99B38]"
              />
            </div>

            <div>
              <label className="block text-xs text-[#D4D2CC] mb-1.5">Genre</label>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value as BeatGenre)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] focus:outline-none focus:border-[#D99B38]"
              >
                {(
                  ['Afrobeats', 'Amapiano', 'Trap', 'Drill', 'UK Drill', 'Hip-Hop', 'R&B', 'Dancehall'] as BeatGenre[]
                ).map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-[#D4D2CC] mb-1.5">Tempo (BPM)</label>
              <input
                type="number"
                min={40}
                max={240}
                value={bpm}
                onChange={(e) => setBpm(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] font-mono-tabular focus:outline-none focus:border-[#D99B38]"
              />
            </div>

            <div>
              <label className="block text-xs text-[#D4D2CC] mb-1.5">Musical Key</label>
              <input
                type="text"
                value={musicalKey}
                onChange={(e) => setMusicalKey(e.target.value)}
                placeholder="F# Min"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] focus:outline-none focus:border-[#D99B38]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-[#D4D2CC] mb-1.5">Mood / Vibe Description</label>
            <input
              type="text"
              value={mood}
              onChange={(e) => setMood(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] focus:outline-none focus:border-[#D99B38]"
            />
          </div>

          {/* Audio Upload */}
          <div>
            <label className="block text-xs text-[#D4D2CC] mb-1.5">
              Stream Preview &amp; MP3 Master File (.mp3, .wav, .m4a, .flac, .aiff)
            </label>
            <label className="flex items-center justify-between gap-4 px-4 py-4 rounded-lg bg-[#0B0B0D] border border-dashed border-white/20 hover:border-[#D99B38] cursor-pointer transition-colors">
              <div className="flex items-center gap-3">
                <Upload className="w-5 h-5 text-[#D99B38]" />
                <div>
                  <p className="text-sm text-[#F5F4F0]">
                    {audioFile ? audioFile.name : 'Choose MP3 / primary audio from your computer'}
                  </p>
                  <p className="text-xs text-[#9C9A94]">
                    {audioFile
                      ? uploadReadyUrl
                        ? `${(audioFile.size / (1024 * 1024)).toFixed(2)} MB · Uploaded & ready to publish`
                        : uploadProgress !== null
                          ? `${(audioFile.size / (1024 * 1024)).toFixed(2)} MB · Pre-uploading (${uploadProgress}%)...`
                          : `${(audioFile.size / (1024 * 1024)).toFixed(2)} MB selected`
                      : 'Max 150 MB · WAV, MP3, FLAC, AIFF, or M4A'}
                  </p>
                </div>
              </div>
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac,.aif,.aiff"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setAudioFile(file);
                  if (file) {
                    void startBackgroundAudioUpload(file);
                  } else {
                    preUploadRef.current = null;
                    setUploadProgress(null);
                    setUploadReadyUrl(null);
                    setUploadError('');
                  }
                }}
              />
            </label>
          </div>

          {/* Optional License-Tier Master Files (WAV Master + Trackout Stems ZIP) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[#D4D2CC] mb-1.5">
                24-Bit WAV Master (Optional · Delivered for WAV+ tiers)
              </label>
              <label className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-[#0B0B0D] border border-dashed border-white/15 hover:border-[#D99B38] cursor-pointer transition-colors">
                <Upload className="w-4 h-4 text-[#D99B38] shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[#F5F4F0] truncate">
                    {wavFile ? wavFile.name : 'Attach dedicated .wav master'}
                  </p>
                  <p className="text-[11px] text-[#9C9A94]">
                    {wavReadyUrl
                      ? 'WAV uploaded & linked'
                      : wavProgress !== null
                        ? `Uploading (${wavProgress}%)...`
                        : 'Defaults to primary file if omitted'}
                  </p>
                </div>
                <input
                  type="file"
                  accept=".wav,audio/wav,.aif,.aiff,.flac"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setWavFile(file);
                    if (file) {
                      void startBackgroundTierUpload(file, 'wav');
                    } else {
                      setWavProgress(null);
                      setWavReadyUrl(null);
                    }
                  }}
                />
              </label>
            </div>

            <div>
              <label className="block text-xs text-[#D4D2CC] mb-1.5">
                Trackout Stems Archive (Optional · Trackout &amp; Exclusive)
              </label>
              <label className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-[#0B0B0D] border border-dashed border-white/15 hover:border-[#D99B38] cursor-pointer transition-colors">
                <Upload className="w-4 h-4 text-[#D99B38] shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[#F5F4F0] truncate">
                    {stemsFile ? stemsFile.name : 'Attach stems (.zip / .rar / .wav)'}
                  </p>
                  <p className="text-[11px] text-[#9C9A94]">
                    {stemsReadyUrl
                      ? 'Stems archive uploaded & linked'
                      : stemsProgress !== null
                        ? `Uploading (${stemsProgress}%)...`
                        : 'Max 150 MB · Delivered for Trackout/Exclusive'}
                  </p>
                </div>
                <input
                  type="file"
                  accept=".zip,.rar,.wav,.flac,application/zip,application/x-zip-compressed"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setStemsFile(file);
                    if (file) {
                      void startBackgroundTierUpload(file, 'stems');
                    } else {
                      setStemsProgress(null);
                      setStemsReadyUrl(null);
                    }
                  }}
                />
              </label>
            </div>
          </div>

          {/* Cover Selector */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs text-[#D4D2CC]">Studio Cover Artwork</label>
              <label className="text-xs text-[#D99B38] hover:text-[#E5A946] font-medium cursor-pointer">
                + Upload Custom Cover
                <input
                  type="file"
                  accept="image/*,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploadError('');
                    const formData = new FormData();
                    formData.append('cover', file);
                    try {
                      const authHeaders = await getAdminAuthHeaders();
                      const res = await fetch('/api/upload-cover', {
                        method: 'POST',
                        headers: authHeaders,
                        body: formData,
                      });
                      const data = await readApiJson<{ coverUrl?: string; error?: string }>(res);
                      if (!res.ok || !data.coverUrl) {
                        throw new Error(data.error || 'Cover upload failed.');
                      }
                      setCoverUrl(data.coverUrl);
                      setStatusBanner(`Uploaded custom cover art "${file.name}".`);
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : 'Unable to upload cover.';
                      setUploadError(msg);
                      setStatusBanner(msg);
                    }
                  }}
                />
              </label>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
              {STUDIO_COVERS.map((c) => (
                <button
                  key={c.url}
                  type="button"
                  title={c.label}
                  onClick={() => setCoverUrl(c.url)}
                  className={`rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                    coverUrl === c.url ? 'border-[#D99B38]' : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  <img src={c.url} alt={c.label} className="aspect-square w-full object-cover" />
                </button>
              ))}
              {!STUDIO_COVERS.some((c) => c.url === coverUrl) && (
                <button
                  type="button"
                  title="Uploaded Custom Cover"
                  onClick={() => setCoverUrl(coverUrl)}
                  className="rounded-lg overflow-hidden border-2 border-[#D99B38] cursor-pointer"
                >
                  <img src={coverUrl} alt="Custom cover" className="aspect-square w-full object-cover" />
                </button>
              )}
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-[#9C9A94] mb-1">MP3 Lease ($)</label>
              <input
                type="number"
                min={1}
                value={mp3Price}
                onChange={(e) => setMp3Price(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs text-[#9C9A94] mb-1">WAV Lease ($)</label>
              <input
                type="number"
                min={1}
                value={wavPrice}
                onChange={(e) => setWavPrice(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs text-[#9C9A94] mb-1">Stems ($)</label>
              <input
                type="number"
                min={1}
                value={stemsPrice}
                onChange={(e) => setStemsPrice(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs text-[#9C9A94] mb-1">Exclusive ($)</label>
              <input
                type="number"
                min={1}
                value={exclusivePrice}
                onChange={(e) => setExclusivePrice(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] font-mono-tabular"
              />
            </div>
          </div>

          {uploadProgress !== null && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-[#D4D2CC]">
                <span>Uploading audio master...</span>
                <span className="font-mono-tabular text-[#D99B38]">{uploadProgress}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-[#D99B38] transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {uploadError && (
            <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-400/30 text-xs text-red-200">
              {uploadError}
            </div>
          )}

          <button
            type="submit"
            disabled={uploadingBeat}
            className="px-6 py-3 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] disabled:opacity-60 text-[#0B0B0D] font-semibold text-sm transition-colors cursor-pointer"
          >
            {uploadingBeat
              ? uploadProgress !== null
                ? `Uploading (${uploadProgress}%)...`
                : 'Publishing to Storefront...'
              : 'Publish Beat Live'}
          </button>
        </form>
      )}

      {/* TAB 3: PAYOUT ACCOUNTS (PAYSTACK, BANK MASTERCARD & MTN MOBILE MONEY) */}
      {activeTab === 'payout_accounts' && (
        <div className="space-y-6">
          {/* Linked Paystack Merchant Account Card */}
          <div className="border border-white/10 bg-[#131316] rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#1B1B20] border border-[#D99B38]/30 flex items-center justify-center text-[#D99B38]">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[#F5F4F0]">
                    Paystack Merchant Account
                  </h2>
                  <p className="text-xs text-[#9C9A94]">
                    Accept live MTN Mobile Money, Telecel, AT, Visa &amp; MasterCard directly into your Paystack settlements
                  </p>
                </div>
              </div>
              {paystackAccount.loading ? (
                <span className="text-xs text-[#9C9A94]">Checking Paystack link...</span>
              ) : paystackAccount.connected ? (
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                    paystackAccount.mode === 'test' ? 'text-amber-300' : 'text-emerald-400'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    Linked ({paystackAccount.mode === 'live' ? 'Live Mode' : 'TEST MODE'})
                  </span>
                </span>
              ) : (
                <span className="text-xs font-medium text-amber-300">
                  Awaiting PAYSTACK_SECRET_KEY in Secrets
                </span>
              )}
            </div>

            {paystackAccount.error && (
              <p className="text-xs text-red-400 bg-red-950/40 border border-red-500/30 rounded-lg px-3.5 py-2.5">
                {paystackAccount.error}
              </p>
            )}

            {paystackAccount.connected ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="p-3.5 rounded-lg bg-[#0B0B0D] border border-white/10 space-y-1">
                  <p className="text-[#9C9A94]">Paystack Balance</p>
                  <p className="text-base font-semibold text-[#D99B38] font-mono-tabular">
                    {paystackAccount.balances && paystackAccount.balances.length > 0
                      ? paystackAccount.balances
                          .map((b) => `${b.currency} ${b.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
                          .join(' · ')
                      : 'GHS 0.00'}
                  </p>
                </div>
                <div className="p-3.5 rounded-lg bg-[#0B0B0D] border border-white/10 space-y-1">
                  <p className="text-[#9C9A94]">Total Paystack Transactions</p>
                  <p className="text-base font-semibold text-[#F5F4F0] font-mono-tabular">
                    {paystackAccount.totals?.totalTransactions ?? 0} orders
                  </p>
                </div>
                <div className="p-3.5 rounded-lg bg-[#0B0B0D] border border-white/10 space-y-1">
                  <p className="text-[#9C9A94]">Settlement Channels</p>
                  <p className="text-sm font-medium text-[#F5F4F0]">
                    MTN MoMo · MasterCard / Visa
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-[#0B0B0D] border border-white/10 text-xs text-[#D4D2CC] space-y-1.5 leading-relaxed">
                <p className="font-semibold text-[#F5F4F0]">How to connect your Paystack account:</p>
                <p>
                  1. Open your Paystack Dashboard → <strong className="text-[#F5F4F0]">Settings → API Keys &amp; Webhooks</strong> and copy your <strong className="text-[#D99B38]">Secret Key</strong> (<code className="font-mono-tabular text-[#D99B38]">sk_live_...</code> or <code className="font-mono-tabular text-[#D99B38]">sk_test_...</code>).
                </p>
                <p>
                  2. Add <code className="font-mono-tabular text-[#D99B38]">PAYSTACK_SECRET_KEY</code> inside your AI Studio <strong className="text-[#F5F4F0]">Secrets</strong> settings (optionally add <code className="font-mono-tabular text-[#D99B38]">PAYSTACK_SUBACCOUNT_CODE</code> for subaccount routing), then refresh this page.
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Bank MasterCard Form */}
          <form
            onSubmit={(e) => handleSavePayoutConfig('bank_mastercard', e)}
            className="border border-white/10 bg-[#131316] rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center gap-3 border-b border-white/10 pb-4">
              <div className="w-10 h-10 rounded-lg bg-[#1B1B20] border border-white/10 flex items-center justify-center text-[#D99B38]">
                <CreditCard className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#F5F4F0]">Bank MasterCard Payout</h2>
                <p className="text-xs text-[#9C9A94]">Receive beat sales directly to your Bank MasterCard</p>
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#D4D2CC] mb-1">Cardholder Full Name</label>
              <input
                type="text"
                required
                value={mcHolder}
                onChange={(e) => setMcHolder(e.target.value)}
                placeholder="Enock Gyamfi"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0]"
              />
            </div>

            <div>
              <label className="block text-xs text-[#D4D2CC] mb-1">Issuing Bank Name</label>
              <input
                type="text"
                required
                value={mcBank}
                onChange={(e) => setMcBank(e.target.value)}
                placeholder="e.g. Ecobank / GCB / Fidelity Bank"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0]"
              />
            </div>

            <div>
              <label className="block text-xs text-[#D4D2CC] mb-1">
                MasterCard Last 4 Digits (or Card Reference)
              </label>
              <input
                type="text"
                required
                value={mcLast4}
                onChange={(e) => setMcLast4(e.target.value)}
                placeholder="e.g. 4829"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] font-mono-tabular"
              />
              <p className="text-[11px] text-[#9C9A94] mt-1">
                Stored masked for PCI security; never enter CVV.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#D4D2CC] mb-1">Country</label>
                <input
                  type="text"
                  required
                  value={mcCountry}
                  onChange={(e) => setMcCountry(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#D4D2CC] mb-1">Settlement Currency</label>
                <select
                  value={mcCurrency}
                  onChange={(e) => setMcCurrency(e.target.value as CurrencyCode)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0]"
                >
                  <option value="USD">USD ($)</option>
                  <option value="GHS">GHS (₵)</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] font-semibold text-sm transition-colors cursor-pointer"
            >
              Save Bank MasterCard
            </button>
          </form>

          {/* MTN Mobile Money Form */}
          <form
            onSubmit={(e) => handleSavePayoutConfig('mtn_momo', e)}
            className="border border-white/10 bg-[#131316] rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center gap-3 border-b border-white/10 pb-4">
              <div className="w-10 h-10 rounded-lg bg-[#1B1B20] border border-white/10 flex items-center justify-center text-[#D99B38]">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#F5F4F0]">MTN Mobile Money (MoMo)</h2>
                <p className="text-xs text-[#9C9A94]">Instant mobile wallet payouts to your MTN number</p>
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#D4D2CC] mb-1">Registered MoMo Name</label>
              <input
                type="text"
                required
                value={momoHolder}
                onChange={(e) => setMomoHolder(e.target.value)}
                placeholder="Enock Gyamfi"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0]"
              />
            </div>

            <div>
              <label className="block text-xs text-[#D4D2CC] mb-1">MTN Mobile Money Number</label>
              <input
                type="tel"
                required
                value={momoPhone}
                onChange={(e) => setMomoPhone(e.target.value)}
                placeholder="+233 24 000 0000"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] font-mono-tabular"
              />
            </div>

            <div>
              <label className="block text-xs text-[#D4D2CC] mb-1">Mobile Network</label>
              <input
                type="text"
                required
                value={momoNetwork}
                onChange={(e) => setMomoNetwork(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#D4D2CC] mb-1">Country</label>
                <input
                  type="text"
                  required
                  value={momoCountry}
                  onChange={(e) => setMomoCountry(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#D4D2CC] mb-1">Wallet Currency</label>
                <select
                  value={momoCurrency}
                  onChange={(e) => setMomoCurrency(e.target.value as CurrencyCode)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0]"
                >
                  <option value="GHS">GHS (₵)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] font-semibold text-sm transition-colors cursor-pointer"
            >
              Save MTN Mobile Money
            </button>
          </form>
          </div>
        </div>
      )}

      {/* TAB 4: WITHDRAWALS */}
      {activeTab === 'withdrawals' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleRequestPayout}
            className="lg:col-span-5 border border-white/10 bg-[#131316] rounded-xl p-6 space-y-5 h-fit"
          >
            <div>
              <p className="text-xs text-[#9C9A94]">Available Balance</p>
              <p className="text-3xl font-semibold text-[#D99B38] font-mono-tabular mt-1">
                ${availableUsd.toFixed(2)} USD
              </p>
              <p className="text-xs text-[#9C9A94] font-mono-tabular">
                ≈ ₵{(availableUsd * USD_TO_GHS_RATE).toFixed(2)} GHS
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs text-[#D4D2CC]">Payout Destination</label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setWithdrawMethod('mtn_momo')}
                  className={`p-3 rounded-lg border text-left cursor-pointer ${
                    withdrawMethod === 'mtn_momo'
                      ? 'bg-[#1B1B20] border-[#D99B38]'
                      : 'bg-[#0B0B0D] border-white/10'
                  }`}
                >
                  <Smartphone className="w-4 h-4 text-[#D99B38] mb-1" />
                  <p className="text-xs font-semibold text-[#F5F4F0]">MTN Mobile Money</p>
                </button>
                <button
                  type="button"
                  onClick={() => setWithdrawMethod('bank_mastercard')}
                  className={`p-3 rounded-lg border text-left cursor-pointer ${
                    withdrawMethod === 'bank_mastercard'
                      ? 'bg-[#1B1B20] border-[#D99B38]'
                      : 'bg-[#0B0B0D] border-white/10'
                  }`}
                >
                  <CreditCard className="w-4 h-4 text-[#D99B38] mb-1" />
                  <p className="text-xs font-semibold text-[#F5F4F0]">Bank MasterCard</p>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#D4D2CC] mb-1">Withdrawal Amount (USD)</label>
              <input
                type="number"
                step="0.01"
                min={1}
                required
                value={withdrawAmountUsd}
                onChange={(e) => setWithdrawAmountUsd(e.target.value)}
                placeholder="e.g. 50.00"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] font-mono-tabular"
              />
            </div>

            <button
              type="submit"
              disabled={withdrawing}
              className="w-full py-3 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] disabled:opacity-60 text-[#0B0B0D] font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span>{withdrawing ? 'Settling Payout...' : 'Send Payout Now'}</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </form>

          <div className="lg:col-span-7 border border-white/10 bg-[#131316] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <h2 className="text-base font-semibold text-[#F5F4F0]">Payout Settlement History</h2>
            </div>
            {payoutRequests.length === 0 ? (
              <p className="px-6 py-8 text-sm text-[#9C9A94]">
                No withdrawals initiated yet. Configure your Bank MasterCard and MTN Mobile Money accounts to receive payouts.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/10 text-xs text-[#9C9A94]">
                    <tr>
                      <th className="py-3 px-6 font-medium">Reference</th>
                      <th className="py-3 px-4 font-medium">Destination</th>
                      <th className="py-3 px-4 font-medium">Status</th>
                      <th className="py-3 px-6 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {payoutRequests.map((p) => (
                      <tr key={p.id}>
                        <td className="py-3 px-6 font-mono-tabular text-[#F5F4F0]">
                          {p.referenceCode}
                        </td>
                        <td className="py-3 px-4 text-[#D4D2CC]">{p.destinationSummary}</td>
                        <td className="py-3 px-4 text-[#D99B38] capitalize">{p.status}</td>
                        <td className="py-3 px-6 text-right font-mono-tabular text-[#F5F4F0]">
                          ${p.amountUsd.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Edit Beat Modal */}
      {editingBeat && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveEditBeat}
            className="w-full max-w-2xl bg-[#131316] border border-white/15 rounded-xl p-6 sm:p-7 space-y-5 my-8"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
              <div>
                <p className="text-xs text-[#D99B38] font-medium">Edit Beat Details</p>
                <h3 className="text-lg font-semibold text-[#F5F4F0]">{editingBeat.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingBeat(null)}
                aria-label="Close edit beat dialog"
                className="p-2 rounded-lg text-[#9C9A94] hover:text-[#F5F4F0] hover:bg-white/5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[#D4D2CC] mb-1.5">Beat Title</label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] focus:outline-none focus:border-[#D99B38]"
                />
              </div>

              <div>
                <label className="block text-xs text-[#D4D2CC] mb-1.5">Genre</label>
                <select
                  value={editGenre}
                  onChange={(e) => setEditGenre(e.target.value as BeatGenre)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] focus:outline-none focus:border-[#D99B38]"
                >
                  {(
                    ['Afrobeats', 'Amapiano', 'Trap', 'Drill', 'UK Drill', 'Hip-Hop', 'R&B', 'Dancehall'] as BeatGenre[]
                  ).map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-[#D4D2CC] mb-1.5">Tempo (BPM)</label>
                <input
                  type="number"
                  min={40}
                  max={240}
                  value={editBpm}
                  onChange={(e) => setEditBpm(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] font-mono-tabular focus:outline-none focus:border-[#D99B38]"
                />
              </div>

              <div>
                <label className="block text-xs text-[#D4D2CC] mb-1.5">Musical Key</label>
                <input
                  type="text"
                  value={editKey}
                  onChange={(e) => setEditKey(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] focus:outline-none focus:border-[#D99B38]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#D4D2CC] mb-1.5">Mood / Vibe Description</label>
              <input
                type="text"
                value={editMood}
                onChange={(e) => setEditMood(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] focus:outline-none focus:border-[#D99B38]"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs text-[#D4D2CC]">Cover Artwork</label>
                <label className="text-xs text-[#D99B38] hover:text-[#E5A946] font-medium cursor-pointer">
                  + Upload New Cover
                  <input
                    type="file"
                    accept="image/*,.jpg,.jpeg,.png,.webp"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const formData = new FormData();
                      formData.append('cover', file);
                      try {
                        const authHeaders = await getAdminAuthHeaders();
                        const res = await fetch('/api/upload-cover', {
                          method: 'POST',
                          headers: authHeaders,
                          body: formData,
                        });
                        const data = await readApiJson<{ coverUrl?: string; error?: string }>(res);
                        if (!res.ok || !data.coverUrl) {
                          throw new Error(data.error || 'Cover upload failed.');
                        }
                        setEditCoverUrl(data.coverUrl);
                      } catch (err) {
                        setStatusBanner(err instanceof Error ? err.message : 'Unable to upload cover.');
                      }
                    }}
                  />
                </label>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {STUDIO_COVERS.slice(0, 6).map((c) => (
                  <button
                    key={c.url}
                    type="button"
                    title={c.label}
                    onClick={() => setEditCoverUrl(c.url)}
                    className={`rounded-lg overflow-hidden border-2 cursor-pointer ${
                      editCoverUrl === c.url ? 'border-[#D99B38]' : 'border-transparent opacity-70 hover:opacity-100'
                    }`}
                  >
                    <img src={c.url} alt={c.label} className="aspect-square w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-[#9C9A94] mb-1">MP3 License ($)</label>
                <input
                  type="number"
                  min={1}
                  value={editMp3Price}
                  onChange={(e) => setEditMp3Price(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs text-[#9C9A94] mb-1">WAV License ($)</label>
                <input
                  type="number"
                  min={1}
                  value={editWavPrice}
                  onChange={(e) => setEditWavPrice(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs text-[#9C9A94] mb-1">Trackout ($)</label>
                <input
                  type="number"
                  min={1}
                  value={editStemsPrice}
                  onChange={(e) => setEditStemsPrice(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs text-[#9C9A94] mb-1">Exclusive ($)</label>
                <input
                  type="number"
                  min={1}
                  value={editExclusivePrice}
                  onChange={(e) => setEditExclusivePrice(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] font-mono-tabular"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setEditingBeat(null)}
                className="px-4 py-2 rounded-lg bg-[#1B1B20] border border-white/10 text-xs font-medium text-[#D4D2CC] hover:text-[#F5F4F0] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="px-5 py-2 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] disabled:opacity-60 text-[#0B0B0D] text-xs font-semibold cursor-pointer"
              >
                {savingEdit ? 'Saving...' : 'Save Beat Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
};
