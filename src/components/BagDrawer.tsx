import React, { useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  Mail,
  RefreshCw,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import {
  CartItem,
  CurrencyCode,
  LICENSE_META,
  OrderRecord,
  PaymentMethod,
  USD_TO_GHS_RATE,
} from '../types';
import { formatMoney } from '../utils/format';
import { db, handleFirestoreError, isFirebaseConfigured, isStagingEnv, OperationType } from '../lib/firebase';
import { fetchPaystackStatus, PaystackStatus, runPaystackCheckout } from '../lib/paystack';
import { BRAND_CONFIG } from '../config/brand';

interface PublicPayoutInfo {
  methodType: 'bank_mastercard' | 'mtn_momo';
  accountHolderName: string;
  institutionOrNetwork: string;
  maskedIdentifier: string;
  currency: CurrencyCode;
  country: string;
}

interface BagDrawerProps {
  open: boolean;
  items: CartItem[];
  currency: CurrencyCode;
  user: User | null;
  onRemoveItem: (index: number) => void;
  onClearBag: () => void;
  onOrderCompleted: (order: OrderRecord) => void;
  onOpenPaymentPage: () => void;
  onClose: () => void;
}

export const BagDrawer: React.FC<BagDrawerProps> = ({
  open,
  items,
  currency,
  user,
  onRemoveItem,
  onClearBag,
  onOrderCompleted,
  onOpenPaymentPage,
  onClose,
}) => {
  const [step, setStep] = useState<'bag' | 'checkout' | 'confirmed'>('bag');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mtn_momo');
  const [buyerName, setBuyerName] = useState(user?.displayName || '');
  const [buyerEmail, setBuyerEmail] = useState(user?.email || '');
  const [momoPhone, setMomoPhone] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [paymentAuthCode, setPaymentAuthCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendFeedback, setResendFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [completedOrder, setCompletedOrder] = useState<OrderRecord | null>(null);
  const [payoutAccounts, setPayoutAccounts] = useState<PublicPayoutInfo[]>([]);
  const [paystackStatus, setPaystackStatus] = useState<PaystackStatus>({ connected: false, mode: null });
  const autoDownloadedOrderRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch('/api/payout-info')
      .then((r) => r.json() as Promise<{ accounts?: PublicPayoutInfo[] }>)
      .then((d) => {
        if (d.accounts) setPayoutAccounts(d.accounts);
      })
      .catch(() => undefined);
    void fetchPaystackStatus().then(setPaystackStatus);
  }, [open]);

  if (!open) return null;

  const subtotalUsd = items.reduce((sum, item) => sum + item.priceUsd, 0);
  const effectiveName = buyerName || user?.displayName || '';
  const effectiveEmail = buyerEmail || user?.email || '';

  const momoDestination = payoutAccounts.find((a) => a.methodType === 'mtn_momo');
  const cardDestination = payoutAccounts.find((a) => a.methodType === 'bank_mastercard');

  const handlePayNow = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(effectiveEmail.trim());
    if (!effectiveName.trim() || !emailValid) {
      setErrorMsg('Enter your full name and a valid email address for receipt & delivery.');
      return;
    }

    if (!paystackStatus.connected) {
      setErrorMsg(
        'Online Card & MTN Mobile Money checkout requires an active Paystack gateway configuration. Please configure PAYSTACK_SECRET_KEY in server secrets.'
      );
      return;
    }

    setSubmitting(true);
    try {
      let paidOrder: OrderRecord;

      if (paystackStatus.connected) {
        paidOrder = await runPaystackCheckout({
          user,
          buyerName: effectiveName.trim(),
          buyerEmail: effectiveEmail.trim(),
          paymentMethod,
          currency,
          items,
        });
      } else {
        const response = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            buyerUid: user?.uid || 'guest',
            buyerName: effectiveName.trim(),
            buyerEmail: effectiveEmail.trim(),
            paymentMethod,
            currency,
            cardLast4: cardNumber.replace(/\D/g, '').slice(-4),
            momoPhone: momoPhone.trim(),
            paymentAuthCode: paymentAuthCode.trim(),
            items: items.map((item) => ({
              beatId: item.beat.id,
              beatTitle: item.beat.title,
              licenseTier: item.licenseTier,
              price: item.priceUsd,
              audioUrl: item.beat.audioUrl,
            })),
          }),
        });

        const payload = (await response.json()) as { order?: OrderRecord; error?: string };
        if (!response.ok || !payload.order) {
          throw new Error(payload.error || 'Could not process payment.');
        }

        paidOrder = payload.order;

        // Save completed order to Firestore if authenticated with verified email
        if (isFirebaseConfigured && db && user && user.emailVerified) {
          try {
            const batch = writeBatch(db);
            const orderRef = doc(db, 'orders', paidOrder.id);
            batch.set(orderRef, {
              buyerUid: user.uid,
              buyerName: paidOrder.buyerName,
              buyerEmail: paidOrder.buyerEmail,
              paymentMethod: paidOrder.paymentMethod,
              paymentReference: paidOrder.paymentReference,
              totalAmount: paidOrder.totalAmount,
              currency: paidOrder.currency,
              status: 'completed',
              itemCount: paidOrder.items.length,
              itemsPreview: paidOrder.items
                .map((i) => `${i.beatTitle} (${i.licenseTier.toUpperCase()})`)
                .join(', ')
                .slice(0, 480),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });

            for (const item of paidOrder.items) {
              const itemRef = doc(db, 'orders', paidOrder.id, 'items', item.id);
              batch.set(itemRef, {
                orderId: paidOrder.id,
                buyerUid: user.uid,
                beatId: item.beatId,
                beatTitle: item.beatTitle,
                licenseTier: item.licenseTier,
                price: item.price,
                licenseCode: item.licenseCode,
                audioUrl: item.audioUrl,
                createdAt: serverTimestamp(),
              });
            }

            await batch.commit();
          } catch (fsErr) {
            handleFirestoreError(fsErr, OperationType.WRITE, `orders/${paidOrder.id}`);
          }
        }
      }

      setCompletedOrder(paidOrder);
      onOrderCompleted(paidOrder);
      onClearBag();
      setPaymentAuthCode('');
      setStep('confirmed');

      if (
        autoDownloadedOrderRef.current !== paidOrder.id &&
        paidOrder.items.length === 1 &&
        paidOrder.downloadToken
      ) {
        autoDownloadedOrderRef.current = paidOrder.id;
        const item = paidOrder.items[0];
        const link = document.createElement('a');
        link.href = `/api/downloads/${paidOrder.id}/${item.id}?token=${encodeURIComponent(
          paidOrder.downloadToken
        )}`;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to process payment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendEmail = async () => {
    if (!completedOrder) return;
    setResendingEmail(true);
    setResendFeedback('');
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(completedOrder.id)}/resend-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: completedOrder.buyerEmail }),
      });
      const data = (await res.json()) as {
        order?: OrderRecord;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Could not send email.');
      }
      if (data.order) {
        setCompletedOrder(data.order);
        onOrderCompleted(data.order);
      }
      setResendFeedback(data.message || `Email dispatched to ${completedOrder.buyerEmail}.`);
    } catch (err) {
      setResendFeedback(err instanceof Error ? err.message : 'Failed to send email.');
    } finally {
      setResendingEmail(false);
    }
  };

  const resetAndClose = () => {
    setStep('bag');
    setErrorMsg('');
    setResendFeedback('');
    setCompletedOrder(null);
    setPaymentAuthCode('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end" onClick={resetAndClose}>
      <aside
        aria-label="Shopping Bag and Checkout"
        className="w-full max-w-md bg-[#131316] border-l border-white/10 h-full flex flex-col justify-between overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#F5F4F0]">
              {step === 'bag' && `Your Bag (${items.length})`}
              {step === 'checkout' && `Pay on ${BRAND_CONFIG.brandName}`}
              {step === 'confirmed' && 'Payment Complete'}
            </h2>
            <p className="text-xs text-[#9C9A94]">
              {step === 'confirmed'
                ? 'Your beat audio & license are unlocked immediately'
                : 'Instant delivery upon MTN MoMo or MasterCard payment'}
            </p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            aria-label="Close bag drawer"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#9C9A94] hover:text-[#F5F4F0] hover:bg-white/5 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {step === 'bag' && (
            <>
              {items.length === 0 ? (
                <div className="py-16 text-center space-y-3">
                  <p className="text-sm text-[#9C9A94]">Your licensing bag is empty.</p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={resetAndClose}
                      className="px-4 py-2 text-xs font-medium bg-[#1B1B20] border border-white/10 text-[#F5F4F0] rounded-lg hover:border-white/25 cursor-pointer"
                    >
                      Browse Catalog
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        resetAndClose();
                        onOpenPaymentPage();
                      }}
                      className="px-4 py-2 text-xs font-semibold bg-[#D99B38] text-[#0B0B0D] rounded-lg hover:bg-[#E5A946] cursor-pointer"
                    >
                      Go to Payment Page
                    </button>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-white/10">
                  {items.map((item, idx) => (
                    <div key={`${item.beat.id}_${item.licenseTier}_${idx}`} className="py-4 flex items-center gap-3">
                      <img
                        src={item.beat.coverUrl}
                        alt={item.beat.title}
                        referrerPolicy="no-referrer"
                        className="w-14 h-14 rounded-md object-cover bg-[#1B1B20] shrink-0 border border-white/10"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[#F5F4F0] truncate">
                          {item.beat.title}
                        </p>
                        <p className="text-xs text-[#9C9A94]">
                          {LICENSE_META[item.licenseTier].name} · {item.beat.bpm} BPM
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-[#F5F4F0] font-mono-tabular">
                          {formatMoney(item.priceUsd, currency)}
                        </p>
                        <button
                          type="button"
                          onClick={() => onRemoveItem(idx)}
                          aria-label={`Remove ${item.beat.title}`}
                          className="text-xs text-[#9C9A94] hover:text-red-400 inline-flex items-center gap-1 mt-1 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 'checkout' && (
            <form id="checkout-form" onSubmit={handlePayNow} className="space-y-5">
              <div className="space-y-3">
                <p className="text-xs font-medium text-[#9C9A94]">Buyer &amp; Delivery Email</p>
                <div>
                  <label className="block text-xs text-[#D4D2CC] mb-1">Full Name / Artist Name</label>
                  <input
                    type="text"
                    required
                    value={effectiveName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    placeholder="e.g. Kwame Mensah"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] focus:outline-none focus:border-[#D99B38]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#D4D2CC] mb-1">Email Address (Receipt &amp; Beat Files)</label>
                  <input
                    type="email"
                    required
                    value={effectiveEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    placeholder="artist@example.com"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0B0D] border border-white/15 text-sm text-[#F5F4F0] focus:outline-none focus:border-[#D99B38]"
                  />
                </div>
              </div>

              {/* Payment Method Selector */}
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-[#9C9A94]">Payment Method</p>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('mtn_momo')}
                    className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                      paymentMethod === 'mtn_momo'
                        ? 'bg-[#1B1B20] border-[#D99B38]'
                        : 'bg-[#0B0B0D] border-white/10 hover:border-white/25'
                    }`}
                  >
                    <Smartphone className="w-4 h-4 text-[#D99B38] mb-1.5" />
                    <p className="text-xs font-semibold text-[#F5F4F0]">MTN Mobile Money</p>
                    <p className="text-[11px] text-[#9C9A94]">MoMo Pay</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('mastercard')}
                    className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                      paymentMethod === 'mastercard'
                        ? 'bg-[#1B1B20] border-[#D99B38]'
                        : 'bg-[#0B0B0D] border-white/10 hover:border-white/25'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-[#D99B38] mb-1.5" />
                    <p className="text-xs font-semibold text-[#F5F4F0]">Bank MasterCard</p>
                    <p className="text-[11px] text-[#9C9A94]">Debit / Credit Card</p>
                  </button>
                </div>
              </div>

              {paystackStatus.connected ? (
                <div
                  className={`p-3.5 rounded-lg bg-[#0B0B0D] border space-y-1.5 text-xs ${
                    paystackStatus.mode === 'test' || paystackStatus.isStaging || isStagingEnv
                      ? 'border-amber-400/50'
                      : 'border-[#D99B38]/30'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[#D99B38] font-semibold">
                      Paystack Connected ({paystackStatus.mode === 'live' ? 'Live' : 'Test Mode'})
                    </p>
                    {(paystackStatus.mode === 'test' || paystackStatus.isStaging || isStagingEnv) && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                        TEST MODE
                      </span>
                    )}
                  </div>
                  <p className="text-[#9C9A94] leading-relaxed">
                    {paystackStatus.mode === 'test' || paystackStatus.isStaging || isStagingEnv
                      ? 'Staging / Paystack Test Mode is active. No real money will be charged — use Paystack test card or test Mobile Money.'
                      : `Click Pay with Paystack below to complete your ${paymentMethod === 'mtn_momo' ? 'MTN Mobile Money' : 'MasterCard'} payment securely and unlock instant downloads.`}
                  </p>
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-[#0B0B0D] border border-amber-500/30 space-y-1.5 text-xs">
                  <p className="text-amber-300 font-semibold">Paystack Gateway Setup Required</p>
                  <p className="text-[#9C9A94] leading-relaxed">
                    {BRAND_CONFIG.brandName} does not simulate unverified card or MTN MoMo charges. Connect <code className="text-[#D99B38]">PAYSTACK_SECRET_KEY</code> to accept live or test-mode payments securely.
                  </p>
                </div>
              )}

              {errorMsg && (
                <p role="alert" className="text-xs text-red-400 bg-red-950/40 border border-red-500/30 rounded-lg px-3 py-2">
                  {errorMsg}
                </p>
              )}
            </form>
          )}

          {step === 'confirmed' && completedOrder && (
            <div className="space-y-5">
              <div className="p-4 rounded-lg bg-[#1B1B20] border border-white/10 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[#D99B38]">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="text-sm font-semibold">
                      Order #{completedOrder.id} Paid &amp; Unlocked
                    </span>
                  </div>
                  {(completedOrder.isTestMode || paystackStatus.mode === 'test' || isStagingEnv) && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                      TEST MODE
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#9C9A94] font-mono-tabular">
                  Ref: {completedOrder.paymentReference} · {completedOrder.paymentDetailMasked}
                </p>
              </div>

              <div className="p-4 rounded-lg bg-[#0B0B0D] border border-white/10 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[#F5F4F0]">
                    <Mail className="w-4 h-4 text-[#D99B38]" />
                    <span className="text-xs font-semibold">
                      {completedOrder.emailDeliveryStatus === 'sent'
                        ? `Beat Sent to ${completedOrder.buyerEmail}`
                        : `Email Receipt (${completedOrder.buyerEmail})`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleResendEmail}
                    disabled={resendingEmail}
                    className="text-[11px] text-[#D99B38] hover:text-[#E5A946] font-medium inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3 h-3 ${resendingEmail ? 'animate-spin' : ''}`} />
                    <span>{resendingEmail ? 'Sending...' : 'Email Beat'}</span>
                  </button>
                </div>
                <p className="text-xs text-[#9C9A94] leading-relaxed">
                  {resendFeedback || completedOrder.emailDeliveryMessage}
                </p>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium text-[#9C9A94]">Unlocked Master Downloads</p>
                {completedOrder.items.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 rounded-lg bg-[#0B0B0D] border border-white/10 space-y-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-[#F5F4F0]">{item.beatTitle}</p>
                      <p className="text-xs text-[#9C9A94] font-mono-tabular">
                        {item.licenseTier.toUpperCase()} · Code: {item.licenseCode}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`/api/downloads/${completedOrder.id}/${item.id}?token=${encodeURIComponent(
                          completedOrder.downloadToken || ''
                        )}`}
                        className="flex-1 min-w-[140px] py-2 px-3 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Audio</span>
                      </a>
                      <a
                        href={`/api/licenses/${completedOrder.id}/${item.id}?token=${encodeURIComponent(
                          completedOrder.downloadToken || ''
                        )}`}
                        className="flex-1 min-w-[140px] py-2 px-3 rounded-lg bg-[#1B1B20] hover:bg-[#25252C] border border-white/10 text-[#F5F4F0] text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5 text-[#D99B38]" />
                        <span>License (.txt)</span>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-[#0B0B0D]/80 space-y-3">
          {(step === 'bag' || step === 'checkout') && items.length > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#9C9A94]">Subtotal</span>
              <div className="text-right">
                <span className="font-semibold text-[#F5F4F0] font-mono-tabular">
                  {formatMoney(subtotalUsd, currency)}
                </span>
                <span className="block text-[11px] text-[#9C9A94] font-mono-tabular">
                  {currency === 'USD'
                    ? `≈ ₵${(subtotalUsd * USD_TO_GHS_RATE).toFixed(2)} GHS`
                    : `≈ $${subtotalUsd.toFixed(2)} USD`}
                </span>
              </div>
            </div>
          )}

          {step === 'bag' && items.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setStep('checkout')}
                className="w-full py-3 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] font-semibold text-sm transition-colors cursor-pointer"
              >
                Pay Here Now
              </button>
              <button
                type="button"
                onClick={() => {
                  resetAndClose();
                  onOpenPaymentPage();
                }}
                className="w-full py-2.5 rounded-lg bg-[#1B1B20] border border-white/10 hover:border-[#D99B38] text-[#F5F4F0] text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Open Full Website Payment Page</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#D99B38]" />
              </button>
            </div>
          )}

          {step === 'checkout' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep('bag')}
                className="px-4 py-3 rounded-lg bg-[#1B1B20] border border-white/10 text-xs font-medium text-[#F5F4F0] hover:border-white/25 cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                form="checkout-form"
                disabled={submitting}
                className="flex-1 py-3 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] disabled:opacity-60 text-[#0B0B0D] font-semibold text-sm transition-colors cursor-pointer"
              >
                {submitting
                  ? paystackStatus.connected
                    ? 'Opening Paystack...'
                    : 'Processing Payment...'
                  : paystackStatus.connected
                    ? paystackStatus.mode === 'test' || paystackStatus.isStaging || isStagingEnv
                      ? `Pay in Test Mode (${formatMoney(subtotalUsd, currency)})`
                      : `Pay with Paystack (${formatMoney(subtotalUsd, currency)})`
                    : `Pay Now (${formatMoney(subtotalUsd, currency)})`}
              </button>
            </div>
          )}

          {step === 'confirmed' && (
            <button
              type="button"
              onClick={resetAndClose}
              className="w-full py-3 rounded-lg bg-[#1B1B20] border border-white/10 hover:border-white/25 text-[#F5F4F0] font-medium text-sm transition-colors cursor-pointer"
            >
              Done
            </button>
          )}
        </div>
      </aside>
    </div>
  );
};
