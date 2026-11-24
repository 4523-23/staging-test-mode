import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Pause, Play, Search, ShoppingBag, SlidersHorizontal } from 'lucide-react';
import {
  Beat,
  BeatGenre,
  CartItem,
  CurrencyCode,
  LICENSE_META,
  LicenseTier,
  OrderRecord,
} from './types';
import {
  auth,
  db,
  handleFirestoreError,
  initialRuntimeConfig,
  isFirebaseConfigured,
  isProducerAdminEmail,
  isStagingEnv,
  OperationType,
  signInWithGoogle,
  signOutAccount,
} from './lib/firebase';
import { fetchPaystackStatus, persistCompletedOrderToFirestore, verifyPaystackReference } from './lib/paystack';
import { formatDuration, formatMoney } from './utils/format';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { BeatLicenseModal } from './components/BeatLicenseModal';
import { BagDrawer } from './components/BagDrawer';
import { MyLibraryView } from './components/MyLibraryView';
import { PaymentPortalView } from './components/PaymentPortalView';
import { ProducerStudioView } from './components/ProducerStudioView';
import { BRAND_CONFIG } from './config/brand';

type AppView = 'storefront' | 'checkout' | 'library' | 'studio';

type SortMode = 'newest' | 'popular' | 'price_asc' | 'price_desc' | 'bpm_asc';

const GENRES: Array<'All' | BeatGenre> = [
  'All',
  'Afrobeats',
  'UK Drill',
  'Trap',
  'Hip-Hop',
  'Amapiano',
  'Drill',
  'R&B',
  'Dancehall',
];

export default function App() {
  const [view, setView] = useState<AppView>('storefront');
  const [user, setUser] = useState<User | null>(null);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [loadingBeats, setLoadingBeats] = useState(true);

  const [selectedGenre, setSelectedGenre] = useState<'All' | BeatGenre>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortMode>('newest');
  const [currency, setCurrency] = useState<CurrencyCode>('USD');

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeBeat, setActiveBeat] = useState<Beat | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);

  // Cart & Modals
  const [bagItems, setBagItems] = useState<CartItem[]>([]);
  const [bagOpen, setBagOpen] = useState(false);
  const [modalBeat, setModalBeat] = useState<Beat | null>(null);
  const [recentOrders, setRecentOrders] = useState<OrderRecord[]>([]);
  const [toastMsg, setToastMsg] = useState('');
  const [testModeNotice, setTestModeNotice] = useState<{ isStaging: boolean; isTestMode: boolean; paystackMode: 'live' | 'test' | null }>({
    isStaging: isStagingEnv,
    isTestMode: Boolean(initialRuntimeConfig.isTestMode || isStagingEnv || initialRuntimeConfig.paystackMode === 'test'),
    paystackMode: initialRuntimeConfig.paystackMode ?? null,
  });

  useEffect(() => {
    document.title = testModeNotice.isTestMode
      ? `[TEST MODE] ${BRAND_CONFIG.pageTitle}`
      : BRAND_CONFIG.pageTitle;
  }, [testModeNotice.isTestMode]);

  useEffect(() => {
    void fetchPaystackStatus().then((status) => {
      setTestModeNotice({
        isStaging: Boolean(status.isStaging || isStagingEnv),
        isTestMode: Boolean(status.isTestMode || status.isStaging || isStagingEnv || status.mode === 'test'),
        paystackMode: status.mode,
      });
    });
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) return;
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
    });
    return () => unsub();
  }, []);

  // Support opening a purchased order directly from a delivery email link (?order=EXV-...&token=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order')?.trim();
    if (!orderId) return;
    const token = params.get('token')?.trim() || '';
    setView('library');
    const url = token
      ? `/api/orders?orderId=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`
      : `/api/orders?orderId=${encodeURIComponent(orderId)}`;
    fetch(url)
      .then((r) => r.json() as Promise<{ orders?: OrderRecord[] }>)
      .then((data) => {
        if (data.orders && data.orders.length > 0) {
          setRecentOrders((prev) => {
            const map = new Map<string, OrderRecord>();
            for (const o of [...data.orders!, ...prev]) {
              map.set(o.id, o);
            }
            return Array.from(map.values());
          });
        }
      })
      .catch(() => undefined);
  }, []);

  const upsertRecentOrder = useCallback((order: OrderRecord) => {
    setRecentOrders((prev) => [order, ...prev.filter((o) => o.id !== order.id)]);
  }, []);

  // Verify Paystack callback redirect (?paystack_ref=... or ?reference=...) automatically
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paystackRef = (params.get('paystack_ref') || params.get('reference') || '').trim();
    if (!paystackRef) return;

    const currentUser = auth?.currentUser || null;
    verifyPaystackReference(paystackRef)
      .then(async (order) => {
        await persistCompletedOrderToFirestore(currentUser, order);
        upsertRecentOrder(order);
        setBagItems([]);
        setView('library');
        setToastMsg(`Paystack payment verified for Order #${order.id}. Downloads unlocked!`);
        setTimeout(() => setToastMsg(''), 4500);
        window.history.replaceState({}, '', window.location.pathname);
      })
      .catch((err) => {
        setToastMsg(err instanceof Error ? err.message : 'Unable to verify Paystack transaction.');
        setTimeout(() => setToastMsg(''), 4500);
      });
  }, [upsertRecentOrder]);

  const fetchCatalog = useCallback(async () => {
    setLoadingBeats(true);
    try {
      const currentUser = auth?.currentUser || null;
      const isAdmin = isProducerAdminEmail(currentUser?.email, currentUser?.emailVerified);
      const idToken = isAdmin && currentUser ? await currentUser.getIdToken().catch(() => '') : '';

      const serverPromise = fetch('/api/beats', {
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
      })
        .then((r) => r.json() as Promise<{ beats?: Beat[] }>)
        .catch(() => ({ beats: [] }));

      const fsPromise =
        isFirebaseConfigured && db
          ? getDocs(
              isAdmin
                ? collection(db, 'beats')
                : query(collection(db, 'beats'), where('published', '==', true))
            ).catch((err) => {
              if (err instanceof Error && !err.message.includes('Missing or insufficient permissions')) {
                handleFirestoreError(err, OperationType.LIST, 'beats');
              }
              return null;
            })
          : Promise.resolve(null);

      const [serverData, fsSnap] = await Promise.all([serverPromise, fsPromise]);

      const merged = new Map<string, Beat>();
      for (const sb of serverData.beats || []) {
        merged.set(sb.id, sb);
      }
      if (fsSnap) {
        for (const d of fsSnap.docs) {
          const data = d.data();
          const serverBeat = merged.get(d.id);
          merged.set(d.id, {
            id: d.id,
            title: String(data.title),
            genre: data.genre as BeatGenre,
            bpm: Number(data.bpm),
            musicalKey: String(data.musicalKey),
            durationSec: Number(data.durationSec),
            mood: String(data.mood),
            coverUrl: String(data.coverUrl),
            audioUrl: String(data.audioUrl),
            wavUrl: serverBeat?.wavUrl,
            stemsUrl: serverBeat?.stemsUrl,
            hasWavMaster: serverBeat?.hasWavMaster,
            hasTrackoutStems: serverBeat?.hasTrackoutStems,
            mp3Price: Number(data.mp3Price),
            wavPrice: Number(data.wavPrice),
            stemsPrice: Number(data.stemsPrice),
            exclusivePrice: Number(data.exclusivePrice),
            plays: Number(data.plays || serverBeat?.plays || 0),
            published: Boolean(data.published),
            producerUid: String(data.producerUid),
            createdAtIso: serverBeat?.createdAtIso,
          });
        }
      }

      setBeats(Array.from(merged.values()));
    } finally {
      setLoadingBeats(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog, user]);

  // Audio Playback Sync
  const handleTogglePlayBeat = useCallback(
    (beat: Beat) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (activeBeat?.id === beat.id) {
        if (isPlaying) {
          audio.pause();
          setIsPlaying(false);
        } else {
          audio.play().catch(() => undefined);
          setIsPlaying(true);
        }
        return;
      }

      setActiveBeat(beat);
      setCurrentTime(0);
      setDuration(beat.durationSec || 24);
      audio.src = beat.audioUrl;
      audio.load();
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    },
    [activeBeat, isPlaying]
  );

  const handleSeek = (time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleToggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !muted;
    setMuted(!muted);
  };

  const handleAddToBag = (beat: Beat, licenseTier: LicenseTier, priceUsd: number) => {
    setBagItems((prev) => {
      const filtered = prev.filter((i) => i.beat.id !== beat.id);
      return [...filtered, { beat, licenseTier, priceUsd }];
    });
    setToastMsg(`${beat.title} (${LICENSE_META[licenseTier].name}) added to bag`);
    setTimeout(() => setToastMsg(''), 3200);
  };

  const visibleBeats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = beats.filter((beat) => {
      if (!beat.published) return false;
      if (selectedGenre !== 'All' && beat.genre !== selectedGenre) return false;
      if (!q) return true;
      return (
        beat.title.toLowerCase().includes(q) ||
        beat.genre.toLowerCase().includes(q) ||
        beat.musicalKey.toLowerCase().includes(q) ||
        beat.mood.toLowerCase().includes(q) ||
        String(beat.bpm).includes(q)
      );
    });
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'popular':
          return (b.plays || 0) - (a.plays || 0);
        case 'price_asc':
          return a.mp3Price - b.mp3Price;
        case 'price_desc':
          return b.mp3Price - a.mp3Price;
        case 'bpm_asc':
          return a.bpm - b.bpm;
        case 'newest':
        default:
          return (b.createdAtIso || b.id).localeCompare(a.createdAtIso || a.id);
      }
    });
  }, [beats, selectedGenre, searchQuery, sortBy]);

  const featuredBeat = visibleBeats[0] || beats[0] || null;

  return (
    <div className="relative min-h-screen overflow-x-hidden text-[#F5F4F0] flex flex-col">
      {/* Full-Site Main Studio Background */}
      <div aria-hidden="true" className="fixed inset-0 z-0 pointer-events-none">
        <img
          src={BRAND_CONFIG.heroImageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0B0B0D]/55 via-[#0B0B0D]/50 to-[#0B0B0D]/75" />
      </div>

      {/* Hidden native audio element */}
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Top Bar Contract: Strict 1-row, 3-zone */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B0B0D]/80 backdrop-blur-md">
        {(testModeNotice.isTestMode || testModeNotice.isStaging) && (
          <div className="bg-amber-500/15 border-b border-amber-400/30 px-4 py-1.5 text-center text-[11px] font-medium text-amber-200 tracking-wide">
            <span className="font-bold uppercase tracking-wider text-amber-300 mr-1.5">[TEST MODE]</span>
            <span>
              {testModeNotice.isStaging ? 'Staging Sandbox Environment' : 'Paystack Test Mode Active'}
              {testModeNotice.paystackMode === 'test' ? ' · Test Keys Active (No real money charged)' : ''}
            </span>
          </div>
        )}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Single-line Brand Logo & Wordmark */}
          <button
            type="button"
            onClick={() => setView('storefront')}
            className="inline-flex items-center gap-3 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <img
              src={BRAND_CONFIG.logoUrl}
              alt={`${BRAND_CONFIG.brandName} logo`}
              referrerPolicy="no-referrer"
              className="h-9 w-16 rounded-md object-cover border border-white/15 shrink-0"
            />
            <span className="font-display text-lg font-bold tracking-tight text-[#F5F4F0] whitespace-nowrap">
              {BRAND_CONFIG.brandName}
            </span>
          </button>

          {/* Zone 2: 4-5 Concise Single-Line Nav Links */}
          <nav aria-label="Primary Navigation" className="hidden md:flex items-center gap-6 text-sm text-[#9C9A94]">
            <button
              type="button"
              onClick={() => {
                setView('storefront');
                setTimeout(() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' }), 40);
              }}
              className={`hover:text-[#F5F4F0] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                view === 'storefront' ? 'text-[#F5F4F0] font-medium' : ''
              }`}
            >
              Catalog
            </button>
            <button
              type="button"
              onClick={() => {
                setView('storefront');
                setTimeout(() => document.getElementById('licenses')?.scrollIntoView({ behavior: 'smooth' }), 40);
              }}
              className="hover:text-[#F5F4F0] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Licenses
            </button>
            <button
              type="button"
              onClick={() => setView('checkout')}
              className={`hover:text-[#F5F4F0] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                view === 'checkout' ? 'text-[#D99B38] font-medium' : ''
              }`}
            >
              Payment
            </button>
            <button
              type="button"
              onClick={() => setView('library')}
              className={`hover:text-[#F5F4F0] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                view === 'library' ? 'text-[#F5F4F0] font-medium' : ''
              }`}
            >
              My Library
            </button>
            <button
              type="button"
              onClick={() => setView('studio')}
              className={`hover:text-[#F5F4F0] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                view === 'studio' ? 'text-[#D99B38] font-medium' : ''
              }`}
            >
              Producer Studio
            </button>
            {user ? (
              <button
                type="button"
                onClick={() => signOutAccount()}
                className="hover:text-[#F5F4F0] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign Out
              </button>
            ) : (
              <button
                type="button"
                onClick={() => signInWithGoogle()}
                className="hover:text-[#F5F4F0] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign In
              </button>
            )}
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setBagOpen(true)}
              className="px-4 py-2 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span className="font-mono-tabular">Bag ({bagItems.length})</span>
            </button>
          </div>
        </div>

        {/* Mobile Quick Nav Row */}
        <div className="md:hidden flex items-center gap-5 px-4 pb-2.5 overflow-x-auto text-xs text-[#9C9A94] border-t border-white/5 pt-2">
          <button type="button" onClick={() => setView('storefront')} className="whitespace-nowrap shrink-0 text-[#F5F4F0]">
            Catalog
          </button>
          <button type="button" onClick={() => setView('checkout')} className="whitespace-nowrap shrink-0 text-[#D99B38]">
            Payment
          </button>
          <button type="button" onClick={() => setView('library')} className="whitespace-nowrap shrink-0">
            My Library
          </button>
          <button type="button" onClick={() => setView('studio')} className="whitespace-nowrap shrink-0">
            Producer Studio
          </button>
          <button
            type="button"
            onClick={() => (user ? signOutAccount() : signInWithGoogle())}
            className="whitespace-nowrap shrink-0"
          >
            {user ? 'Sign Out' : 'Sign In'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className={`relative z-10 flex-1 ${activeBeat ? 'pb-20' : ''}`}>
        {view === 'storefront' && (
          <>
            {/* 1. Storefront Hero Split */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-14 lg:pt-14 lg:pb-20">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
                {/* Left Column */}
                <div className="lg:col-span-5 flex flex-col justify-between p-6 sm:p-8 rounded-xl bg-[#0B0B0D]/70 backdrop-blur-md border border-white/10 space-y-6">
                  <div className="space-y-4">
                    <p className="text-xs text-[#D99B38] font-medium tracking-wide">
                      {BRAND_CONFIG.heroEyebrow}
                    </p>
                    <h1
                      className="font-display font-bold tracking-tight text-[#F5F4F0] leading-[1.06]"
                      style={{ fontSize: 'clamp(2.25rem, 4vw, 3.6rem)', textWrap: 'balance' }}
                    >
                      {BRAND_CONFIG.heroHeadline}
                    </h1>
                    <p className="text-base text-[#9C9A94] leading-relaxed max-w-md">
                      {BRAND_CONFIG.heroDescription}
                    </p>
                  </div>

                  <div className="space-y-5">
                    <div className="flex flex-wrap items-center gap-4">
                      <a
                        href="#catalog"
                        className="px-6 py-3 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
                      >
                        Browse Catalog
                      </a>
                      <a
                        href="#licenses"
                        className="px-5 py-3 rounded-lg bg-[#131316] border border-white/15 hover:border-white/30 text-[#F5F4F0] text-sm font-medium transition-colors whitespace-nowrap shrink-0"
                      >
                        Compare Licenses
                      </a>
                    </div>

                    <p className="text-xs text-[#9C9A94] font-mono-tabular pt-2 border-t border-white/10">
                      Mastercard &amp; MTN Mobile Money · Pay Directly on Website · Instant Download &amp; Email
                    </p>
                  </div>
                </div>

                {/* Right Column: 16:9 Studio Hero Showcase */}
                <div className="lg:col-span-7">
                  <div className="relative rounded-xl overflow-hidden bg-[#0B0B0D]/50 border border-white/15 aspect-[16/10] lg:aspect-auto lg:h-full min-h-[280px]">
                    <img
                      src={BRAND_CONFIG.heroImageUrl}
                      alt={`${BRAND_CONFIG.brandName} studio console`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent flex items-end p-5 sm:p-6">
                      {featuredBeat && (
                        <div className="w-full flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-xs text-[#D99B38] font-medium">Featured Instrumental</p>
                            <p className="text-base sm:text-lg font-semibold text-[#F5F4F0] truncate">
                              {featuredBeat.title}
                            </p>
                            <p className="text-xs text-[#D4D2CC] font-mono-tabular">
                              {featuredBeat.genre} · {featuredBeat.bpm} BPM · {featuredBeat.musicalKey}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleTogglePlayBeat(featuredBeat)}
                            className="px-4 py-2.5 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {activeBeat?.id === featuredBeat.id && isPlaying ? (
                              <>
                                <Pause className="w-3.5 h-3.5" />
                                <span>Pause</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" />
                                <span>Play Beat</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* 2. Featured Collection / Beat Catalog */}
            <section id="catalog" className="max-w-7xl mx-auto px-4 sm:px-6 py-12 border-t border-white/10 space-y-8">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl sm:text-3xl font-semibold text-[#F5F4F0] tracking-tight">
                    Beat Catalog
                  </h2>
                  <p className="text-sm text-[#9C9A94] mt-1">
                    Click play to audition full studio previews, or select a beat to choose your license tier.
                  </p>
                </div>

                {/* Search, Sort & Currency Toolbar */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 sm:w-56">
                    <Search className="w-4 h-4 text-[#9C9A94] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search title, BPM, key..."
                      className="w-full pl-9 pr-3.5 py-2 rounded-lg bg-[#131316] border border-white/10 text-sm text-[#F5F4F0] focus:outline-none focus:border-[#D99B38]"
                    />
                  </div>

                  <select
                    aria-label="Sort beats"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortMode)}
                    className="px-3 py-2 rounded-lg bg-[#131316] border border-white/10 text-xs font-medium text-[#F5F4F0] focus:outline-none focus:border-[#D99B38] cursor-pointer"
                  >
                    <option value="newest">Sort: Newest</option>
                    <option value="popular">Sort: Most Popular</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                    <option value="bpm_asc">Tempo: Low to High BPM</option>
                  </select>

                  {/* Currency Segmented Toggle */}
                  <div className="flex items-center p-1 rounded-lg bg-[#131316] border border-white/10">
                    {(['USD', 'GHS'] as CurrencyCode[]).map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setCurrency(code)}
                        className={`px-3 py-1.5 rounded-md text-xs font-mono-tabular font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          currency === code
                            ? 'bg-[#D99B38] text-[#0B0B0D]'
                            : 'text-[#9C9A94] hover:text-[#F5F4F0]'
                        }`}
                      >
                        {code === 'USD' ? 'USD $' : 'GHS ₵'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Genre Filter Bar */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <SlidersHorizontal className="w-4 h-4 text-[#9C9A94] shrink-0 mr-1" />
                {GENRES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setSelectedGenre(g)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedGenre === g
                        ? 'bg-[#F5F4F0] text-[#0B0B0D]'
                        : 'bg-[#131316] border border-white/10 text-[#9C9A94] hover:text-[#F5F4F0]'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>

              {/* 3-Column Uniform Beat Grid */}
              {loadingBeats ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="rounded-xl bg-[#131316] border border-white/10 p-4 space-y-4">
                      <div className="aspect-square rounded-lg bg-[#1B1B20]" />
                      <div className="h-4 w-2/3 bg-[#1B1B20] rounded" />
                      <div className="h-3 w-1/2 bg-[#1B1B20] rounded" />
                    </div>
                  ))}
                </div>
              ) : visibleBeats.length === 0 ? (
                <div className="border border-white/15 bg-[#0B0B0D]/75 backdrop-blur-md rounded-xl p-12 text-center space-y-4">
                  <p className="text-base font-medium text-[#F5F4F0]">
                    {beats.length === 0
                      ? 'Your beat catalog is currently empty'
                      : 'No beats match your current filter'}
                  </p>
                  <p className="text-sm text-[#9C9A94] max-w-md mx-auto">
                    {beats.length === 0
                      ? 'Upload your own MP3 or WAV instrumentals in Producer Studio to publish them live for clients.'
                      : 'Try clearing your search or switching back to All genres.'}
                  </p>
                  {beats.length === 0 && (
                    <button
                      type="button"
                      onClick={() => setView('studio')}
                      className="px-5 py-2.5 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Open Producer Studio
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {visibleBeats.map((beat) => {
                    const playingThis = activeBeat?.id === beat.id && isPlaying;
                    return (
                      <article
                        key={beat.id}
                        className="group rounded-xl bg-[#131316] border border-white/10 overflow-hidden transition-transform duration-200 hover:-translate-y-0.5 flex flex-col"
                      >
                        {/* Square Cover Image + Audition Trigger */}
                        <div className="relative aspect-square bg-[#1B1B20] overflow-hidden">
                          <img
                            src={beat.coverUrl}
                            alt={`${beat.title} cover art`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end justify-between p-4">
                            <button
                              type="button"
                              onClick={() => handleTogglePlayBeat(beat)}
                              aria-label={playingThis ? `Pause ${beat.title}` : `Play ${beat.title}`}
                              className="w-11 h-11 rounded-full bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] flex items-center justify-center shadow-lg transition-transform hover:scale-105 cursor-pointer"
                            >
                              {playingThis ? (
                                <Pause className="w-4 h-4" />
                              ) : (
                                <Play className="w-4 h-4 ml-0.5" />
                              )}
                            </button>

                            <span className="text-xs font-mono-tabular text-[#F5F4F0]/90 bg-black/50 backdrop-blur-sm px-2.5 py-1 rounded-md">
                              {formatDuration(beat.durationSec)}
                            </span>
                          </div>
                        </div>

                        {/* Unboxed Metadata & Title */}
                        <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                          <div className="space-y-1.5">
                            <p className="text-xs text-[#9C9A94] font-mono-tabular">
                              {beat.genre} · {beat.bpm} BPM · {beat.musicalKey}
                            </p>
                            <h3 className="text-base font-semibold text-[#F5F4F0] truncate">
                              {beat.title}
                            </h3>
                            <p className="text-xs text-[#9C9A94] truncate">{beat.mood}</p>
                          </div>

                          <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] text-[#9C9A94]">From</p>
                              <p className="text-base font-semibold text-[#F5F4F0] font-mono-tabular">
                                {formatMoney(beat.mp3Price, currency)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setModalBeat(beat)}
                              className="px-4 py-2 rounded-lg bg-[#1B1B20] hover:bg-[#D99B38] hover:text-[#0B0B0D] border border-white/10 text-xs font-semibold text-[#F5F4F0] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Select License
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 3. Licensing Tiers Section */}
            <section id="licenses" className="max-w-7xl mx-auto px-4 sm:px-6 py-14 border-t border-white/10 space-y-8">
              <div className="max-w-2xl">
                <h2 className="font-display text-2xl sm:text-3xl font-semibold text-[#F5F4F0] tracking-tight">
                  Transparent Beat Licensing
                </h2>
                <p className="text-sm text-[#9C9A94] mt-2 leading-relaxed">
                  Every order includes immediate untagged audio downloads and a signed {BRAND_CONFIG.brandName} commercial license agreement.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {(['mp3', 'wav', 'stems', 'exclusive'] as LicenseTier[]).map((tier) => {
                  const meta = LICENSE_META[tier];
                  const samplePrice =
                    tier === 'mp3' ? 29 : tier === 'wav' ? 59 : tier === 'stems' ? 149 : 499;
                  return (
                    <div
                      key={tier}
                      className="rounded-xl bg-[#0B0B0D]/75 backdrop-blur-md border border-white/15 p-6 flex flex-col justify-between gap-5"
                    >
                      <div className="space-y-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="text-base font-semibold text-[#F5F4F0]">{meta.name}</h3>
                          <span className="text-sm font-semibold text-[#D99B38] font-mono-tabular">
                            from {formatMoney(samplePrice, currency)}
                          </span>
                        </div>
                        <p className="text-xs text-[#9C9A94] leading-relaxed">{meta.summary}</p>
                      </div>

                      <div className="pt-4 border-t border-white/10 space-y-2 text-xs text-[#D4D2CC]">
                        <p>{meta.format}</p>
                        <p className="text-[#9C9A94]">{meta.streams}</p>
                        <p className="text-[#9C9A94]">{meta.videos}</p>
                        <p className="text-[#9C9A94]">{meta.distribution}</p>
                        <p className="text-[#D99B38]/90">{meta.contentId}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {view === 'checkout' && (
          <PaymentPortalView
            user={user}
            items={bagItems}
            beats={beats}
            currency={currency}
            onChangeCurrency={setCurrency}
            onAddToBag={handleAddToBag}
            onRemoveItem={(idx) => setBagItems((prev) => prev.filter((_, i) => i !== idx))}
            onClearBag={() => setBagItems([])}
            onOrderCompleted={upsertRecentOrder}
            onBackToCatalog={() => setView('storefront')}
            onGoToLibrary={() => setView('library')}
          />
        )}

        {view === 'library' && (
          <MyLibraryView
            user={user}
            recentOrders={recentOrders}
            onOrderUpdated={upsertRecentOrder}
            onBackToCatalog={() => setView('storefront')}
          />
        )}

        {view === 'studio' && (
          <ProducerStudioView
            user={user}
            beats={beats}
            currency={currency}
            onBeatsUpdated={fetchCatalog}
          />
        )}
      </main>

      {/* Quiet Studio Footer */}
      <footer className={`relative z-10 border-t border-white/10 bg-[#0B0B0D]/75 backdrop-blur-md ${activeBeat ? 'pb-20' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[#9C9A94]">
          <div className="flex items-center gap-3">
            <img
              src={BRAND_CONFIG.logoUrl}
              alt={BRAND_CONFIG.brandName}
              referrerPolicy="no-referrer"
              className="h-6 w-11 rounded object-cover border border-white/15 shrink-0"
            />
            <span>© {new Date().getFullYear()} {BRAND_CONFIG.brandName} · {BRAND_CONFIG.domain} · {BRAND_CONFIG.footerSummary}</span>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <span>Payments &amp; Payouts: Bank MasterCard · MTN Mobile Money</span>
            <a href={`mailto:${BRAND_CONFIG.producerEmail}`} className="hover:text-[#F5F4F0] transition-colors">
              {BRAND_CONFIG.producerEmail}
            </a>
          </div>
        </div>
      </footer>

      {/* Toast Feedback */}
      {toastMsg && (
        <div
          role="status"
          className="fixed top-20 right-6 z-40 px-4 py-3 rounded-lg bg-[#1B1B20] border border-[#D99B38]/50 text-xs font-medium text-[#F5F4F0] shadow-xl"
        >
          {toastMsg}
        </div>
      )}

      {/* Persistent Bottom Audio Audition Player */}
      <AudioPlayerBar
        beat={activeBeat}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        muted={muted}
        currency={currency}
        onTogglePlay={() => activeBeat && handleTogglePlayBeat(activeBeat)}
        onSeek={handleSeek}
        onToggleMute={handleToggleMute}
        onOpenLicense={(beat) => setModalBeat(beat)}
        onClose={() => {
          audioRef.current?.pause();
          setIsPlaying(false);
          setActiveBeat(null);
        }}
      />

      {/* Beat License Selection Modal */}
      <BeatLicenseModal
        beat={modalBeat}
        currency={currency}
        isPlayingThisBeat={Boolean(modalBeat && activeBeat?.id === modalBeat.id && isPlaying)}
        onTogglePlay={handleTogglePlayBeat}
        onAddToBag={handleAddToBag}
        onBuyNow={(beat, tier, priceUsd) => {
          handleAddToBag(beat, tier, priceUsd);
          setView('checkout');
        }}
        onClose={() => setModalBeat(null)}
      />

      {/* Shopping Bag & Checkout Drawer */}
      <BagDrawer
        open={bagOpen}
        items={bagItems}
        currency={currency}
        user={user}
        onRemoveItem={(idx) => setBagItems((prev) => prev.filter((_, i) => i !== idx))}
        onClearBag={() => setBagItems([])}
        onOrderCompleted={upsertRecentOrder}
        onOpenPaymentPage={() => setView('checkout')}
        onClose={() => setBagOpen(false)}
      />
    </div>
  );
}
