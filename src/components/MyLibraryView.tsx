import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Clock, Download, FileText, Lock, Mail, RefreshCw, Search } from 'lucide-react';
import { OrderItemRecord, OrderRecord } from '../types';
import { db, handleFirestoreError, isFirebaseConfigured, OperationType, signInWithGoogle } from '../lib/firebase';
import { BRAND_CONFIG } from '../config/brand';

interface MyLibraryViewProps {
  user: User | null;
  recentOrders: OrderRecord[];
  onOrderUpdated: (order: OrderRecord) => void;
  onBackToCatalog: () => void;
}

export const MyLibraryView: React.FC<MyLibraryViewProps> = ({
  user,
  recentOrders,
  onOrderUpdated,
  onBackToCatalog,
}) => {
  const [lookupEmail, setLookupEmail] = useState(user?.email || '');
  const [orders, setOrders] = useState<OrderRecord[]>(recentOrders);
  const [loading, setLoading] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [statusByOrder, setStatusByOrder] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    const loadAccountOrders = async () => {
      setLoading(true);
      try {
        const idToken = user ? await user.getIdToken().catch(() => '') : '';
        const serverOrdersPromise = user?.email
          ? fetch(`/api/orders?email=${encodeURIComponent(user.email)}`, {
              headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
            })
              .then((r) => r.json() as Promise<{ orders?: OrderRecord[] }>)
              .then((d) => d.orders || [])
              .catch(() => [] as OrderRecord[])
          : Promise.resolve([] as OrderRecord[]);

        let fsLoaded: OrderRecord[] = [];
        if (isFirebaseConfigured && db && user && user.emailVerified) {
          try {
            const q = query(collection(db, 'orders'), where('buyerUid', '==', user.uid));
            const snap = await getDocs(q);
            for (const orderDoc of snap.docs) {
              const data = orderDoc.data();
              const itemsSnap = await getDocs(collection(db, 'orders', orderDoc.id, 'items'));
              const items: OrderItemRecord[] = itemsSnap.docs.map((d) => {
                const idata = d.data();
                return {
                  id: d.id,
                  beatId: String(idata.beatId),
                  beatTitle: String(idata.beatTitle),
                  licenseTier: idata.licenseTier,
                  price: Number(idata.price),
                  licenseCode: String(idata.licenseCode),
                  audioUrl: String(idata.audioUrl),
                };
              });
              fsLoaded.push({
                id: orderDoc.id,
                buyerUid: String(data.buyerUid),
                buyerName: String(data.buyerName),
                buyerEmail: String(data.buyerEmail),
                paymentMethod: data.paymentMethod,
                paymentReference: String(data.paymentReference),
                totalAmount: Number(data.totalAmount),
                currency: data.currency,
                status: data.status,
                itemsPreview: String(data.itemsPreview || ''),
                items,
                createdAtIso: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
              });
            }
          } catch (err) {
            handleFirestoreError(err, OperationType.LIST, 'orders');
          }
        }

        const serverLoaded = await serverOrdersPromise;

        const mergedMap = new Map<string, OrderRecord>();
        for (const o of [...fsLoaded, ...serverLoaded, ...recentOrders]) {
          const prev = mergedMap.get(o.id);
          if (!prev) {
            mergedMap.set(o.id, o);
          } else {
            mergedMap.set(o.id, {
              ...prev,
              ...o,
              status: o.status === 'completed' || prev.status === 'completed' ? 'completed' : 'pending',
              downloadToken: o.downloadToken || prev.downloadToken,
              emailDeliveryStatus: o.emailDeliveryStatus || prev.emailDeliveryStatus,
              emailDeliveryMessage: o.emailDeliveryMessage || prev.emailDeliveryMessage,
            });
          }
        }

        if (active) {
          setOrders(Array.from(mergedMap.values()));
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadAccountOrders();
    return () => {
      active = false;
    };
  }, [user, recentOrders]);

  const handleLookupByEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupEmail.trim()) return;
    setLoading(true);
    try {
      const idToken = user ? await user.getIdToken().catch(() => '') : '';
      const res = await fetch(`/api/orders?email=${encodeURIComponent(lookupEmail.trim())}`, {
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
      });
      const data = (await res.json()) as { orders?: OrderRecord[] };
      if (data.orders) {
        const mergedMap = new Map<string, OrderRecord>();
        for (const o of [...orders, ...data.orders]) {
          const prev = mergedMap.get(o.id);
          mergedMap.set(o.id, prev ? { ...prev, ...o, downloadToken: o.downloadToken || prev.downloadToken } : o);
        }
        setOrders(Array.from(mergedMap.values()));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshOrderStatus = async (order: OrderRecord) => {
    setBusyOrderId(order.id);
    try {
      const idToken = user ? await user.getIdToken().catch(() => '') : '';
      const url = order.downloadToken
        ? `/api/orders?orderId=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.downloadToken)}`
        : `/api/orders?orderId=${encodeURIComponent(order.id)}`;
      const res = await fetch(url, {
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
      });
      const data = (await res.json()) as { orders?: OrderRecord[] };
      const latest = data.orders?.[0];
      if (!latest) {
        setStatusByOrder((prev) => ({
          ...prev,
          [order.id]: 'Order was declined or is no longer active.',
        }));
        return;
      }
      const mergedOrder = { ...latest, downloadToken: latest.downloadToken || order.downloadToken };
      setOrders((prev) => prev.map((o) => (o.id === mergedOrder.id ? mergedOrder : o)));
      onOrderUpdated(mergedOrder);
      setStatusByOrder((prev) => ({
        ...prev,
        [order.id]:
          mergedOrder.status === 'completed'
            ? mergedOrder.emailDeliveryMessage || `Payment confirmed and beat sent to ${mergedOrder.buyerEmail}.`
            : `Still awaiting payment confirmation from ${BRAND_CONFIG.brandName}.`,
      }));
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleResendEmail = async (order: OrderRecord) => {
    setBusyOrderId(order.id);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(order.id)}/resend-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: order.buyerEmail }),
      });
      const data = (await res.json()) as { order?: OrderRecord; message?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to resend email.');
      }
      if (data.order) {
        setOrders((prev) => prev.map((o) => (o.id === data.order!.id ? data.order! : o)));
        onOrderUpdated(data.order);
      }
      setStatusByOrder((prev) => ({
        ...prev,
        [order.id]: data.message || `Email resent to ${order.buyerEmail}.`,
      }));
    } catch (err) {
      setStatusByOrder((prev) => ({
        ...prev,
        [order.id]: err instanceof Error ? err.message : 'Unable to resend email.',
      }));
    } finally {
      setBusyOrderId(null);
    }
  };

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <p className="text-xs text-[#9C9A94] mb-1">Client Downloads &amp; Agreements</p>
          <h1 className="text-3xl font-semibold text-[#F5F4F0] tracking-tight">
            My Licensed Beats
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!user && (
            <button
              type="button"
              onClick={() => signInWithGoogle()}
              className="px-4 py-2 rounded-lg bg-[#1B1B20] border border-white/15 text-xs font-medium text-[#F5F4F0] hover:border-[#D99B38] transition-colors cursor-pointer"
            >
              Sign In to Sync Account
            </button>
          )}
          <button
            type="button"
            onClick={onBackToCatalog}
            className="px-4 py-2 rounded-lg bg-[#D99B38] text-[#0B0B0D] text-xs font-semibold hover:bg-[#E5A946] transition-colors cursor-pointer"
          >
            Browse Beats
          </button>
        </div>
      </div>

      {/* Email Receipt Lookup */}
      <form onSubmit={handleLookupByEmail} className="flex flex-col sm:flex-row gap-3 max-w-xl">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#9C9A94] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="email"
            value={lookupEmail}
            onChange={(e) => setLookupEmail(e.target.value)}
            placeholder="Lookup order by your checkout email..."
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[#131316] border border-white/10 text-sm text-[#F5F4F0] focus:outline-none focus:border-[#D99B38]"
          />
        </div>
        <button
          type="submit"
          className="px-5 py-2.5 rounded-lg bg-[#1B1B20] border border-white/15 text-sm font-medium text-[#F5F4F0] hover:border-white/30 transition-colors cursor-pointer whitespace-nowrap"
        >
          Find Orders
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-[#9C9A94]">Loading licensed tracks...</p>
      ) : orders.length === 0 ? (
        <div className="border border-white/10 bg-[#131316] rounded-xl p-10 text-center space-y-3">
          <p className="text-base font-medium text-[#F5F4F0]">No purchased beats found yet</p>
          <p className="text-sm text-[#9C9A94] max-w-md mx-auto">
            Pay with Bank MasterCard or MTN Mobile Money right on the website to unlock instant beat downloads and your license agreement.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const isPaidAndUnlocked = order.status === 'completed' && Boolean(order.downloadToken);
            const isBusy = busyOrderId === order.id;
            const statusMessage = statusByOrder[order.id] || order.emailDeliveryMessage;

            return (
              <div
                key={order.id}
                className="border border-white/10 bg-[#131316] rounded-xl p-6 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[#F5F4F0] font-mono-tabular">
                        Order #{order.id}
                      </p>
                      {order.isTestMode && (
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                          TEST MODE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#9C9A94]">
                      {order.buyerName} · {order.buyerEmail} · {order.paymentReference}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-[#D99B38] font-mono-tabular">
                      {order.currency === 'GHS' ? `₵${order.totalAmount.toFixed(2)}` : `$${order.totalAmount.toFixed(2)}`}
                    </p>
                    <p className="text-xs text-[#9C9A94]">
                      {order.paymentMethod === 'mtn_momo' ? 'MTN Mobile Money' : 'Bank MasterCard'} ·{' '}
                      {order.status === 'completed' ? 'Paid & Unlocked' : 'Payment Processing'}
                    </p>
                  </div>
                </div>

                {order.status !== 'completed' ? (
                  <div className="p-4 rounded-lg bg-[#0B0B0D] border border-[#D99B38]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-2.5">
                      <Clock className="w-4 h-4 text-[#D99B38] shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-[#F5F4F0]">
                          Awaiting Producer Payment Confirmation
                        </p>
                        <p className="text-xs text-[#9C9A94] mt-0.5">
                          {statusMessage ||
                            `${BRAND_CONFIG.brandName} is verifying your payment before sending the beat to ${order.buyerEmail}.`}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRefreshOrderStatus(order)}
                      disabled={isBusy}
                      className="px-4 py-2 rounded-lg bg-[#1B1B20] border border-white/15 hover:border-[#D99B38] disabled:opacity-60 text-[#F5F4F0] text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 text-[#D99B38] ${isBusy ? 'animate-spin' : ''}`} />
                      <span>{isBusy ? 'Checking...' : 'Check Status'}</span>
                    </button>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-lg bg-[#0B0B0D] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-2">
                      <Mail className="w-4 h-4 text-[#D99B38] shrink-0 mt-0.5" />
                      <p className="text-xs text-[#D4D2CC] leading-relaxed">
                        {statusMessage ||
                          `Beat delivery links & license certificate issued to ${order.buyerEmail}.`}
                        {order.downloadExpiresAtIso && (
                          <span className="block text-[11px] text-[#9C9A94] mt-0.5">
                            Time-limited download link valid until{' '}
                            {new Date(order.downloadExpiresAtIso).toLocaleDateString()}. Click Resend Beat Email anytime to issue a fresh link.
                          </span>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleResendEmail(order)}
                      disabled={isBusy}
                      className="px-3 py-1.5 rounded-lg bg-[#1B1B20] border border-white/10 hover:border-[#D99B38] text-xs font-medium text-[#F5F4F0] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                    >
                      <RefreshCw className={`w-3 h-3 text-[#D99B38] ${isBusy ? 'animate-spin' : ''}`} />
                      <span>{isBusy ? 'Sending...' : 'Resend Beat Email'}</span>
                    </button>
                  </div>
                )}

                <div className="divide-y divide-white/10">
                  {order.items.map((item) => (
                    <div
                      key={item.id}
                      className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-[#F5F4F0]">{item.beatTitle}</p>
                        <p className="text-xs text-[#9C9A94] font-mono-tabular">
                          {item.licenseTier.toUpperCase()} License · Code {item.licenseCode}
                        </p>
                      </div>

                      {isPaidAndUnlocked ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={`/api/downloads/${order.id}/${item.id}?token=${encodeURIComponent(
                              order.downloadToken!
                            )}`}
                            className="px-3.5 py-2 rounded-lg bg-[#D99B38] hover:bg-[#E5A946] text-[#0B0B0D] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download Audio</span>
                          </a>
                          <a
                            href={`/api/licenses/${order.id}/${item.id}?token=${encodeURIComponent(
                              order.downloadToken!
                            )}`}
                            className="px-3.5 py-2 rounded-lg bg-[#1B1B20] border border-white/10 hover:border-white/25 text-[#F5F4F0] text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                          >
                            <FileText className="w-3.5 h-3.5 text-[#D99B38]" />
                            <span>License Agreement</span>
                          </a>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-[#9C9A94]">
                          <Lock className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {order.status === 'completed'
                              ? 'Sign in or click Resend Beat Email to open your protected download link'
                              : 'Complete payment to unlock download'}
                          </span>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
