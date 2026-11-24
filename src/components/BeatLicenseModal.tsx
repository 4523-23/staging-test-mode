import React, { useState } from 'react';
import { Check, CreditCard, Pause, Play, ShoppingBag, X } from 'lucide-react';
import { Beat, CurrencyCode, LICENSE_META, LicenseTier } from '../types';
import { formatDuration, formatMoney } from '../utils/format';

interface BeatLicenseModalProps {
  beat: Beat | null;
  currency: CurrencyCode;
  isPlayingThisBeat: boolean;
  onTogglePlay: (beat: Beat) => void;
  onAddToBag: (beat: Beat, tier: LicenseTier, priceUsd: number) => void;
  onBuyNow: (beat: Beat, tier: LicenseTier, priceUsd: number) => void;
  onClose: () => void;
}

export const BeatLicenseModal: React.FC<BeatLicenseModalProps> = ({
  beat,
  currency,
  isPlayingThisBeat,
  onTogglePlay,
  onAddToBag,
  onBuyNow,
  onClose,
}) => {
  const [selectedTier, setSelectedTier] = useState<LicenseTier>('wav');

  if (!beat) return null;

  const prices: Record<LicenseTier, number> = {
    mp3: beat.mp3Price,
    wav: beat.wavPrice,
    stems: beat.stemsPrice,
    exclusive: beat.exclusivePrice,
  };

  const tiers: LicenseTier[] = ['mp3', 'wav', 'stems', 'exclusive'];
  const activeMeta = LICENSE_META[selectedTier];
  const activePriceUsd = prices[selectedTier];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="beat-modal-title"
        className="w-full max-w-3xl bg-[#131316] border border-white/10 rounded-xl overflow-hidden shadow-2xl my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="min-w-0">
            <p className="text-xs text-[#9C9A94] font-mono-tabular">
              {beat.genre} · {beat.bpm} BPM · {beat.musicalKey} · {formatDuration(beat.durationSec)}
            </p>
            <h2 id="beat-modal-title" className="text-xl font-semibold text-[#F5F4F0] truncate">
              {beat.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close license modal"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#9C9A94] hover:text-[#F5F4F0] hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contiguous Purchase Module */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 p-6">
          {/* Left: Cover & Audition */}
          <div className="md:col-span-5 flex flex-col gap-4">
            <div className="relative aspect-square rounded-lg overflow-hidden bg-[#1B1B20] border border-white/10">
              <img
                src={beat.coverUrl}
                alt={beat.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent flex items-end p-4">
                <button
                  type="button"
                  onClick={() => onTogglePlay(beat)}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] font-medium text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  {isPlayingThisBeat ? (
                    <>
                      <Pause className="w-4 h-4" />
                      <span>Pause Preview</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      <span>Audition Instrumental</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="text-xs text-[#9C9A94] space-y-1.5 border-t border-white/10 pt-3">
              <p className="text-[#F5F4F0] font-medium">Mood &amp; Sonic Profile</p>
              <p>{beat.mood}</p>
              <p className="pt-1">
                Instant digital delivery and license download right after paying on the website with Mastercard or MTN Mobile Money.
              </p>
            </div>
          </div>

          {/* Right: License Selector & Buy CTA */}
          <div className="md:col-span-7 flex flex-col justify-between gap-5">
            <div className="space-y-3">
              <p className="text-sm font-medium text-[#F5F4F0]">Select License Tier</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {tiers.map((tier) => {
                  const meta = LICENSE_META[tier];
                  const active = selectedTier === tier;
                  return (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setSelectedTier(tier)}
                      className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#1B1B20] border-[#D99B38]'
                          : 'bg-[#0B0B0D]/60 border-white/10 hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-semibold text-[#F5F4F0] whitespace-nowrap">
                          {meta.name}
                        </span>
                        <span className="text-sm font-semibold text-[#D99B38] font-mono-tabular whitespace-nowrap">
                          {formatMoney(prices[tier], currency)}
                        </span>
                      </div>
                      <p className="text-xs text-[#9C9A94] truncate">{meta.format}</p>
                    </button>
                  );
                })}
              </div>

              {/* Rights Breakdown */}
              <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                <p className="text-xs font-medium text-[#F5F4F0]">
                  {activeMeta.name} — Included Rights
                </p>
                <p className="text-xs text-[#9C9A94]">{activeMeta.summary}</p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs text-[#D4D2CC]">
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-[#D99B38] shrink-0" />
                    <span>{activeMeta.format}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-[#D99B38] shrink-0" />
                    <span>{activeMeta.streams}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-[#D99B38] shrink-0" />
                    <span>{activeMeta.videos}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-[#D99B38] shrink-0" />
                    <span>{activeMeta.distribution}</span>
                  </li>
                  <li className="flex items-center gap-2 sm:col-span-2 text-[#9C9A94]">
                    <Check className="w-3.5 h-3.5 text-[#D99B38] shrink-0" />
                    <span>{activeMeta.contentId}</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-[#9C9A94]">License Total</p>
                <p className="text-2xl font-semibold text-[#F5F4F0] font-mono-tabular">
                  {formatMoney(activePriceUsd, currency)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    onAddToBag(beat, selectedTier, activePriceUsd);
                    onClose();
                  }}
                  className="px-4 py-3 rounded-lg bg-[#1B1B20] hover:bg-[#25252C] border border-white/15 text-[#F5F4F0] font-medium text-sm flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span>Add to Bag</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onBuyNow(beat, selectedTier, activePriceUsd);
                    onClose();
                  }}
                  className="px-5 py-3 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] font-semibold text-sm flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Buy &amp; Pay Now</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
