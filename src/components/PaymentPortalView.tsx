import React, { useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  Mail,
  Music,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react';
import {
  Beat,
  CartItem,
  CurrencyCode,
  LICENSE_META,
  LicenseTier,
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

interface PaymentPortalViewProps {
  user: User | null;
  items: CartItem[];
  beats: Beat[];
  currency: CurrencyCode;
  onChangeCurrency: (currency: CurrencyCode) => void;
  onAddToBag: (beat: Beat, licenseTier: LicenseTier, priceUsd: number) => void;
  onRemoveItem: (index: number) => void;
  onClearBag: () => void;
  onOrderCompleted: (order: OrderRecord) => void;
  onBackToCatalog: () => void;
  onGoToLibrary: () => void;
}

export const PaymentPortalView: React.FC<PaymentPortalViewProps> = ({
  user,
  items,
  beats,
  currency,
  onChangeCurrency,
  onAddToBag,
  onRemoveItem,
  onClearBag,
  onOrderCompleted,
  onBackToCatalog,
  onGoToLibrary,
}) => {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mtn_momo');
  const [buyerName, setBuyerName] = useState(user?.displayName || '');
  const [buyerEmail, setBuyerEmail] = useState(user?.email || '');
  const [momoPhone, setMomoPhone] = useState('');
  const [cardHolder, setCardHolder] = useState(user?.displayName || '');
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
  const autoDownloadedRef = useRef<string | null>(null);

  useEffect(() => {
    fetch('/api/payout-info')
      .then((r) => r.json() as Promise<{ accounts?: PublicPayoutInfo[] }>)
      .then((d) => {
        if (d.accounts) setPayoutAccounts(d.accounts);
      })
      .catch(() => undefined);
    void fetchPaystackStatus().then(setPaystackStatus);
  }, []);

  const subtotalUsd = items.reduce((sum, item) => sum + item.priceUsd, 0);
  const effectiveName = buyerName || user?.displayName || '';
  const effectiveEmail = buyerEmail || user?.email || '';
  const effectiveCardHolder = cardHolder || effectiveName;
  const ghsTotal = (subtotalUsd * USD_TO_GHS_RATE).toFixed(2);

  const momoDestination = payoutAccounts.find((a) => a.methodType === 'mtn_momo');
  const cardDestination = payoutAccounts.find((a) => a.methodType === 'bank_mastercard');
  const publishedBeats = beats.filter((b) => b.published);

  const handlePayNow = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (items.length === 0) {
      setErrorMsg('Select at least one beat above before completing payment.');
      return;
    }

    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(effectiveEmail.trim());
    if (!effectiveName.trim() || !emailValid) {
      setErrorMsg('Enter your full name and a valid email address for delivery.');
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
          throw new Error(payload.error || 'Payment could not be completed.');
        }

        paidOrder = payload.order;

        // Save completed order to Firestore if signed in with verified email
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

      if (
        autoDownloadedRef.current !== paidOrder.id &&
        paidOrder.items.length === 1 &&
        paidOrder.downloadToken
      ) {
        autoDownloadedRef.current = paidOrder.id;
        const firstItem = paidOrder.items[0];
        const link = document.createElement('a');
        link.href = `/api/downloads/${paidOrder.id}/${firstItem.id}?token=${encodeURIComponent(
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
      setResendFeedback(data.message || `Beat sent to ${completedOrder.buyerEmail}.`);
    } catch (err) {
      setResendFeedback(err instanceof Error ? err.message : 'Failed to send email.');
    } finally {
      setResendingEmail(false);
    }
  };

  if (completedOrder) {
    return (
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-6">
        <div className="rounded-xl bg-[#0B0B0D]/85 backdrop-blur-md border border-[#D99B38]/40 p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#D99B38]/15 border border-[#D99B38]/40 flex items-center justify-center text-[#D99B38] shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-semibold text-[#F5F4F0]">
                  Payment Complete — Beat Unlocked
                </h1>
                <p className="text-xs text-[#9C9A94] font-mono-tabular mt-1">
                  Order #{completedOrder.id} · Ref: {completedOrder.paymentReference} · {completedOrder.paymentDetailMasked}
                </p>
              </div>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-xs text-[#9C9A94]">Amount Paid</p>
              <p className="text-lg font-semibold text-[#D99B38] font-mono-tabular">
                {completedOrder.currency === 'GHS'
                  ? `₵${completedOrder.totalAmount.toFixed(2)} GHS`
                  : `$${completedOrder.totalAmount.toFixed(2)} USD`}
              </p>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-[#131316] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Mail className="w-4 h-4 text-[#D99B38] shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-[#F5F4F0]">
                  {completedOrder.emailDeliveryStatus === 'sent'
                    ? `Beat & License Sent to ${completedOrder.buyerEmail}`
                    : `Delivery Email: ${completedOrder.buyerEmail}`}
                </p>
                <p className="text-xs text-[#9C9A94] mt-0.5">
                  {resendFeedback || completedOrder.emailDeliveryMessage}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleResendEmail}
              disabled={resendingEmail}
              className="px-3.5 py-2 rounded-lg bg-[#1B1B20] border border-white/10 hover:border-[#D99B38] text-xs font-medium text-[#F5F4F0] inline-flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#D99B38] ${resendingEmail ? 'animate-spin' : ''}`} />
              <span>{resendingEmail ? 'Sending...' : 'Email Beat Receipt'}</span>
            </button>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium text-[#9C9A94]">Your Unlocked Downloads &amp; License Certificates</p>
            {completedOrder.items.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-lg bg-[#131316] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div>
                  <p className="text-base font-semibold text-[#F5F4F0]">{item.beatTitle}</p>
                  <p className="text-xs text-[#9C9A94] font-mono-tabular">
                    {item.licenseTier.toUpperCase()} License · Code: {item.licenseCode}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <a
                    href={`/api/downloads/${completedOrder.id}/${item.id}?token=${encodeURIComponent(
                      completedOrder.downloadToken || ''
                    )}`}
                    className="px-4 py-2.5 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Beat Audio</span>
                  </a>
                  <a
                    href={`/api/licenses/${completedOrder.id}/${item.id}?token=${encodeURIComponent(
                      completedOrder.downloadToken || ''
                    )}`}
                    className="px-4 py-2.5 rounded-lg bg-[#1B1B20] hover:bg-[#25252C] border border-white/10 text-[#F5F4F0] text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#D99B38]" />
                    <span>License Agreement (.txt)</span>
                  </a>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-white/10">
            <button
              type="button"
              onClick={onBackToCatalog}
              className="px-4 py-2.5 rounded-lg bg-[#1B1B20] border border-white/10 hover:border-white/25 text-xs font-medium text-[#F5F4F0] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Beat Catalog</span>
            </button>
            <button
              type="button"
              onClick={onGoToLibrary}
              className="px-4 py-2.5 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] text-xs font-semibold cursor-pointer"
            >
              View in My Library
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <button
            type="button"
            onClick={onBackToCatalog}
            className="text-xs text-[#9C9A94] hover:text-[#F5F4F0] inline-flex items-center gap-1.5 mb-2 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Beat Catalog</span>
          </button>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#F5F4F0] tracking-tight">
            Website Payment &amp; Checkout
          </h1>
          <p className="text-sm text-[#9C9A94] mt-1">
            Pay directly on {BRAND_CONFIG.brandName} with MTN Mobile Money or Bank MasterCard for immediate beat download &amp; license delivery.
          </p>
        </div>

        <div className="flex items-center p-1 rounded-lg bg-[#131316] border border-white/10 self-start sm:self-auto">
          {(['USD', 'GHS'] as CurrencyCode[]).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => onChangeCurrency(code)}
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: On-Website Payment Terminal */}
        <form
          onSubmit={handlePayNow}
          className="lg:col-span-7 rounded-xl bg-[#0B0B0D]/80 backdrop-blur-md border border-white/15 p-6 sm:p-8 space-y-6"
        >
          {/* Step 1: Buyer Email & Details */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[#F5F4F0]">1. Buyer &amp; Delivery Email</h2>
              <span className="text-xs text-[#D99B38]">Instant unlock</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[#D4D2CC] mb-1.5">Full Name / Artist Name</label>
                <input
                  type="text"
                  required
                  value={effectiveName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="e.g. Kwame Mensah"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#131316] border border-white/15 text-sm text-[#F5F4F0] focus:outline-none focus:border-[#D99B38]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#D4D2CC] mb-1.5">Email Address (Receipt &amp; Beat Files)</label>
                <input
                  type="email"
                  required
                  value={effectiveEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                  placeholder="artist@example.com"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#131316] border border-white/15 text-sm text-[#F5F4F0] focus:outline-none focus:border-[#D99B38]"
                />
              </div>
            </div>
          </div>

          {/* Step 2: Payment Method & Card/MoMo Input */}
          <div className="space-y-4 pt-4 border-t border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[#F5F4F0]">2. Complete Payment on Website</h2>
              {paystackStatus.connected && (
                <span
                  className={`text-xs font-medium ${
                    paystackStatus.mode === 'test' || paystackStatus.isStaging || isStagingEnv
                      ? 'text-amber-300'
                      : 'text-emerald-400'
                  }`}
                >
                  {paystackStatus.mode === 'test' || paystackStatus.isStaging || isStagingEnv
                    ? 'Secured by Paystack (TEST MODE — Sandbox)'
                    : 'Secured by Paystack (Live)'}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPaymentMethod('mtn_momo')}
                className={`p-4 rounded-lg border text-left transition-colors cursor-pointer ${
                  paymentMethod === 'mtn_momo'
                    ? 'bg-[#1B1B20] border-[#D99B38]'
                    : 'bg-[#131316] border-white/10 hover:border-white/25'
                }`}
              >
                <Smartphone className="w-5 h-5 text-[#D99B38] mb-2" />
                <p className="text-sm font-semibold text-[#F5F4F0]">MTN Mobile Money</p>
                <p className="text-xs text-[#9C9A94] mt-0.5">Pay directly with MoMo (₵{ghsTotal} GHS)</p>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('mastercard')}
                className={`p-4 rounded-lg border text-left transition-colors cursor-pointer ${
                  paymentMethod === 'mastercard'
                    ? 'bg-[#1B1B20] border-[#D99B38]'
                    : 'bg-[#131316] border-white/10 hover:border-white/25'
                }`}
              >
                <CreditCard className="w-5 h-5 text-[#D99B38] mb-2" />
                <p className="text-sm font-semibold text-[#F5F4F0]">Bank MasterCard / Card</p>
                <p className="text-xs text-[#9C9A94] mt-0.5">Pay with Debit or Credit Card (${subtotalUsd.toFixed(2)} USD)</p>
              </button>
            </div>

            {paystackStatus.connected ? (
              <div
                className={`p-4 rounded-lg bg-[#131316] border space-y-2 text-xs ${
                  paystackStatus.mode === 'test' || paystackStatus.isStaging || isStagingEnv
                    ? 'border-amber-400/50'
                    : 'border-[#D99B38]/30'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[#D99B38] font-semibold">
                    {paystackStatus.mode === 'test' || paystackStatus.isStaging || isStagingEnv
                      ? 'Paystack Test Mode Checkout (Staging Sandbox)'
                      : 'Paystack Checkout Linked (MTN MoMo & MasterCard/Visa)'}
                  </p>
                  {(paystackStatus.mode === 'test' || paystackStatus.isStaging || isStagingEnv) && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                      TEST MODE
                    </span>
                  )}
                </div>
                <p className="text-[#D4D2CC] leading-relaxed">
                  {paystackStatus.mode === 'test' || paystackStatus.isStaging || isStagingEnv
                    ? 'No real money will be charged. Use Paystack test card or test Mobile Money credentials to test order verification, license generation, and downloads safely.'
                    : `Click the Pay button below to open ${BRAND_CONFIG.brandName}'s official Paystack payment prompt right on this page. Once your payment succeeds, your beat audio and license unlock automatically.`}
                </p>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-[#131316] border border-amber-500/30 space-y-1.5 text-xs">
                <p className="text-amber-300 font-semibold">Paystack Gateway Not Configured</p>
                <p className="text-[#9C9A94] leading-relaxed">
                  {BRAND_CONFIG.brandName} requires a configured <code className="text-[#D99B38]">PAYSTACK_SECRET_KEY</code> to process real MTN Mobile Money and Visa/MasterCard payments without simulation.
                </p>
              </div>
            )}
          </div>

          {errorMsg && (
            <p role="alert" className="text-xs text-red-400 bg-red-950/40 border border-red-500/30 rounded-lg px-3.5 py-2.5">
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || items.length === 0}
            className="w-full py-3.5 px-6 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] disabled:opacity-50 text-[#0B0B0D] font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>
              {submitting
                ? paystackStatus.connected
                  ? 'Opening Paystack Checkout...'
                  : 'Processing Payment...'
                : items.length === 0
                  ? 'Add a Beat to Pay'
                  : paystackStatus.connected
                    ? `${
                        paystackStatus.mode === 'test' || paystackStatus.isStaging || isStagingEnv
                          ? 'Pay in Test Mode · '
                          : 'Pay '
                      }${paymentMethod === 'mtn_momo' ? `₵${ghsTotal} GHS` : formatMoney(subtotalUsd, currency)} with Paystack`
                    : paymentMethod === 'mtn_momo'
                      ? `Pay ₵${ghsTotal} GHS via MTN Mobile Money`
                      : `Pay ${formatMoney(subtotalUsd, currency)} via MasterCard`}
            </span>
          </button>
        </form>

        {/* Right: Order Bag Summary & Quick Beat Picker */}
        <aside className="lg:col-span-5 space-y-5">
          <div className="rounded-xl bg-[#0B0B0D]/80 backdrop-blur-md border border-white/15 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="text-base font-semibold text-[#F5F4F0]">
                Order Summary ({items.length})
              </h2>
              <span className="text-xs text-[#9C9A94] font-mono-tabular">
                Instant Digital Delivery
              </span>
            </div>

            {items.length === 0 ? (
              <div className="py-4 space-y-4">
                <p className="text-xs text-[#9C9A94] leading-relaxed">
                  No beats in your checkout bag yet. Pick an instrumental below or browse the full catalog to pay now.
                </p>

                {publishedBeats.length > 0 ? (
                  <div className="space-y-2.5">
                    {publishedBeats.slice(0, 3).map((beat) => (
                      <div
                        key={beat.id}
                        className="p-3 rounded-lg bg-[#131316] border border-white/10 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={beat.coverUrl}
                            alt={beat.title}
                            referrerPolicy="no-referrer"
                            className="w-11 h-11 rounded object-cover bg-[#1B1B20] shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#F5F4F0] truncate">{beat.title}</p>
                            <p className="text-[11px] text-[#9C9A94] font-mono-tabular">
                              WAV Lease · {formatMoney(beat.wavPrice, currency)}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onAddToBag(beat, 'wav', beat.wavPrice)}
                          className="px-3 py-1.5 rounded-md bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] text-xs font-semibold shrink-0 cursor-pointer"
                        >
                          Select
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={onBackToCatalog}
                    className="w-full py-2.5 rounded-lg bg-[#1B1B20] border border-white/10 text-xs font-medium text-[#F5F4F0] hover:border-[#D99B38] inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Music className="w-4 h-4 text-[#D99B38]" />
                    <span>Browse Beat Catalog</span>
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="divide-y divide-white/10">
                  {items.map((item, idx) => (
                    <div key={`${item.beat.id}_${item.licenseTier}_${idx}`} className="py-3.5 flex items-center gap-3">
                      <img
                        src={item.beat.coverUrl}
                        alt={item.beat.title}
                        referrerPolicy="no-referrer"
                        className="w-12 h-12 rounded-md object-cover bg-[#1B1B20] shrink-0 border border-white/10"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[#F5F4F0] truncate">{item.beat.title}</p>
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
                          className="text-[11px] text-[#9C9A94] hover:text-red-400 inline-flex items-center gap-1 mt-0.5 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-white/10 space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#9C9A94]">Total Due</span>
                    <span className="text-lg font-semibold text-[#F5F4F0] font-mono-tabular">
                      {formatMoney(subtotalUsd, currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[#9C9A94] font-mono-tabular">
                    <span>GHS MoMo Equivalent</span>
                    <span>₵{ghsTotal} GHS</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
};
