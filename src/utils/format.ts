import { CurrencyCode, USD_TO_GHS_RATE } from '../types';

export function formatMoney(amountUsd: number, currency: CurrencyCode): string {
  if (currency === 'GHS') {
    const ghs = amountUsd * USD_TO_GHS_RATE;
    return `₵${ghs.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `$${amountUsd.toLocaleString('en-US', {
    minimumFractionDigits: amountUsd % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
