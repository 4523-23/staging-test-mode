import React from 'react';
import { Pause, Play, Volume2, VolumeX, ShoppingBag, X } from 'lucide-react';
import { Beat, CurrencyCode } from '../types';
import { formatDuration, formatMoney } from '../utils/format';

interface AudioPlayerBarProps {
  beat: Beat | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  muted: boolean;
  currency: CurrencyCode;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onToggleMute: () => void;
  onOpenLicense: (beat: Beat) => void;
  onClose: () => void;
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  beat,
  isPlaying,
  currentTime,
  duration,
  muted,
  currency,
  onTogglePlay,
  onSeek,
  onToggleMute,
  onOpenLicense,
  onClose,
}) => {
  if (!beat) return null;

  const totalDur = duration || beat.durationSec || 24;
  const progressPct = totalDur > 0 ? Math.min(100, (currentTime / totalDur) * 100) : 0;

  // Deterministic waveform profile per beat
  const waveformBars = Array.from({ length: 44 }, (_, idx) => {
    const seed = beat.id.charCodeAt(idx % beat.id.length) + idx * 17 + (beat.bpm || 110);
    const wave = Math.abs(Math.sin(seed * 0.37) * 0.55 + Math.cos(idx * 0.65) * 0.35);
    return Math.round(25 + Math.min(1, wave) * 75);
  });

  return (
    <div
      role="region"
      aria-label="Audio Audition Player"
      className="fixed bottom-0 inset-x-0 z-40 border-t border-white/10 bg-[#131316]/95 backdrop-blur-md"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2.5 sm:gap-4 overflow-hidden">
        {/* Track Info */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 max-w-[128px] sm:max-w-none sm:w-60 shrink">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-md overflow-hidden bg-[#1B1B20] shrink-0 border border-white/10">
            <img
              src={beat.coverUrl}
              alt={beat.title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-semibold text-[#F5F4F0] truncate">{beat.title}</p>
            <p className="text-[11px] sm:text-xs text-[#9C9A94] truncate font-mono-tabular">
              {beat.bpm} BPM · {beat.musicalKey}
            </p>
          </div>
        </div>

        {/* Transport & Waveform Scrub */}
        <div className="flex-1 min-w-0 flex items-center gap-2 sm:gap-3 max-w-xl">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause beat' : 'Play beat'}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#D99B38] text-[#0B0B0D] flex items-center justify-center hover:bg-[#E5A946] transition-colors shrink-0 cursor-pointer"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 ml-0.5" />}
          </button>

          <span className="hidden sm:inline text-xs text-[#9C9A94] font-mono-tabular w-10 text-right shrink-0">
            {formatDuration(currentTime)}
          </span>

          <div
            role="slider"
            tabIndex={0}
            aria-label="Seek audio position"
            aria-valuemin={0}
            aria-valuemax={Math.round(totalDur)}
            aria-valuenow={Math.round(currentTime)}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
              onSeek(ratio * totalDur);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') onSeek(Math.min(totalDur, currentTime + 5));
              if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 5));
            }}
            className="relative flex-1 min-w-[52px] h-9 flex items-center gap-[2px] cursor-pointer select-none overflow-hidden"
          >
            {waveformBars.map((heightPct, idx) => {
              const barPct = ((idx + 0.5) / waveformBars.length) * 100;
              const filled = barPct <= progressPct;
              const animatedBoost = isPlaying && filled ? ((idx % 3) - 1) * 4 : 0;
              const clampedHeight = Math.max(20, Math.min(100, heightPct + animatedBoost));
              return (
                <span
                  key={idx}
                  className={`flex-1 min-w-[1px] rounded-full transition-all duration-150 ${
                    filled ? 'bg-[#D99B38]' : 'bg-white/20 hover:bg-white/35'
                  } ${idx % 2 === 1 ? 'hidden sm:block' : ''}`}
                  style={{ height: `${clampedHeight}%` }}
                />
              );
            })}
          </div>

          <span className="hidden sm:inline text-xs text-[#9C9A94] font-mono-tabular w-10 shrink-0">
            {formatDuration(totalDur)}
          </span>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="hidden md:flex w-9 h-9 items-center justify-center rounded-lg text-[#9C9A94] hover:text-[#F5F4F0] hover:bg-white/5 transition-colors cursor-pointer"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => onOpenLicense(beat)}
            className="px-2.5 sm:px-3.5 py-2 rounded-lg bg-[#1B1B20] hover:bg-[#24242B] border border-white/10 text-xs font-medium text-[#F5F4F0] flex items-center gap-1.5 sm:gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ShoppingBag className="w-3.5 h-3.5 text-[#D99B38]" />
            <span className="font-mono-tabular">{formatMoney(beat.mp3Price, currency)}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close player"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9C9A94] hover:text-[#F5F4F0] hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
