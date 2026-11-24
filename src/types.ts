import { BRAND_CONFIG } from './config/brand';

export type BeatGenre =
  | 'Afrobeats'
  | 'Amapiano'
  | 'Trap'
  | 'Drill'
  | 'UK Drill'
  | 'Hip-Hop'
  | 'R&B'
  | 'Dancehall';
export type LicenseTier = 'mp3' | 'wav' | 'stems' | 'exclusive';
export type PaymentMethod = 'mastercard' | 'mtn_momo';
export type CurrencyCode = 'USD' | 'GHS';

export interface Beat {
  id: string;
  title: string;
  genre: BeatGenre;
  bpm: number;
  musicalKey: string;
  durationSec: number;
  mood: string;
  coverUrl: string;
  audioUrl: string;
  wavUrl?: string;
  stemsUrl?: string;
  hasWavMaster?: boolean;
  hasTrackoutStems?: boolean;
  mp3Price: number;
  wavPrice: number;
  stemsPrice: number;
  exclusivePrice: number;
  plays: number;
  published: boolean;
  producerUid: string;
  createdAtIso?: string;
}

export interface CartItem {
  beat: Beat;
  licenseTier: LicenseTier;
  priceUsd: number;
}

export interface OrderItemRecord {
  id: string;
  beatId: string;
  beatTitle: string;
  licenseTier: LicenseTier;
  price: number;
  licenseCode: string;
  audioUrl: string;
  wavUrl?: string;
  stemsUrl?: string;
}

export interface OrderRecord {
  id: string;
  buyerUid: string;
  buyerName: string;
  buyerEmail: string;
  paymentMethod: PaymentMethod;
  paymentDetailMasked?: string;
  paymentReference: string;
  totalAmount: number;
  currency: CurrencyCode;
  usdEquivalent?: number;
  status: 'pending' | 'completed';
  downloadToken?: string;
  downloadExpiresAtIso?: string;
  emailDeliveryStatus?: 'pending' | 'awaiting_payment_confirmation' | 'sent' | 'smtp_not_configured' | 'failed';
  emailDeliveryMessage?: string;
  emailSentAtIso?: string;
  paidAtIso?: string;
  confirmedBy?: string;
  isTestMode?: boolean;
  itemsPreview?: string;
  items: OrderItemRecord[];
  createdAtIso: string;
}

export interface PayoutConfig {
  id: string;
  methodType: 'bank_mastercard' | 'mtn_momo';
  accountLabel: string;
  accountHolderName: string;
  institutionOrNetwork: string;
  maskedIdentifier: string;
  currency: CurrencyCode;
  country: string;
  isDefault: boolean;
  ownerUid?: string;
  updatedAtIso?: string;
}

export interface PayoutRequest {
  id: string;
  methodType: 'bank_mastercard' | 'mtn_momo';
  destinationSummary: string;
  amountUsd: number;
  currency: CurrencyCode;
  referenceCode: string;
  status: 'processing' | 'settled';
  createdAtIso: string;
}

export const USD_TO_GHS_RATE = 15.8;

export const LICENSE_META: Record<
  LicenseTier,
  {
    name: string;
    format: string;
    streams: string;
    videos: string;
    distribution: string;
    contentId: string;
    summary: string;
  }
> = {
  mp3: {
    name: 'MP3 License',
    format: '320kbps MP3 (Untagged)',
    streams: 'Up to 50,000 commercial streams',
    videos: `1 Music Video · Credit: "${BRAND_CONFIG.licenseCreditText}"`,
    distribution: 'Up to 2,500 copies',
    contentId: 'No Content ID registration permitted',
    summary: 'Non-exclusive commercial lease for independent singles and streaming releases. Producer credit required.',
  },
  wav: {
    name: 'WAV License',
    format: '24-Bit Studio WAV + MP3',
    streams: 'Up to 250,000 commercial streams',
    videos: `Unlimited Music Videos · Credit: "${BRAND_CONFIG.licenseCreditText}"`,
    distribution: 'Up to 10,000 copies · Commercial Radio',
    contentId: 'No Content ID registration permitted',
    summary: 'Uncompressed 24-bit WAV studio master for commercial DSP releases, radio play, and live performances.',
  },
  stems: {
    name: 'Trackout License',
    format: 'Tracked-Out Stems + WAV + MP3',
    streams: 'Unlimited commercial streams',
    videos: `Unlimited Music Videos · Credit: "${BRAND_CONFIG.licenseCreditText}"`,
    distribution: 'Unlimited commercial copies',
    contentId: 'No Content ID registration permitted',
    summary: 'Full multi-track stem separation for mixing engineers and major commercial releases.',
  },
  exclusive: {
    name: 'Exclusive License',
    format: 'Full Master + Trackout Stems + WAV',
    streams: 'Unlimited global rights',
    videos: 'Unlimited global sync & broadcast',
    distribution: 'Beat removed from storefront catalog',
    contentId: 'Full copyright transfer via separate written agreement',
    summary: 'Exclusive commercial rights with immediate catalog delisting; full copyright transfer executed under separate written agreement.',
  },
};

export const STUDIO_COVERS = [
  { label: 'Street Hustler', url: '/assets/aistudio/Street_Hustler_Beat_Cover_642ae609.jpg' },
  { label: 'Soul', url: '/assets/aistudio/Soul_Cover_Art_3cadd955.jpg' },
  { label: 'Soul Ties', url: '/assets/aistudio/Soul_Ties_Cover_Art_ecf92c22.jpg' },
  { label: 'My Love', url: '/assets/aistudio/My_Love_Cover_Art_6b2458b9.jpg' },
  { label: 'Exvis Beatz Logo', url: '/assets/aistudio/Exvix_Beatz_3c921262.jpg' },
  { label: 'Obsidian Gold', url: '/src/assets/images/cover_afro_gold_1795108750721.jpg' },
  { label: 'Nocturnal Monolith', url: '/src/assets/images/cover_nocturnal_trap_1795108750854.jpg' },
  { label: 'Bronze Vinyl', url: '/src/assets/images/cover_amapiano_groove_1795108750273.jpg' },
  { label: 'Velvet Ribbon Mic', url: '/src/assets/images/cover_velvet_rnb_1795108750679.jpg' },
  { label: 'Titanium Turntable', url: '/src/assets/images/cover_titanium_turntable_1795108750950.jpg' },
  { label: 'Amber Prism', url: '/src/assets/images/cover_prism_drill_1795108750988.jpg' },
];
