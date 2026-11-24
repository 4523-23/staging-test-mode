import { User } from 'firebase/auth';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { CartItem, CurrencyCode, OrderRecord, PaymentMethod } from '../types';
import { db, handleFirestoreError, isFirebaseConfigured, OperationType } from './firebase';

export interface PaystackStatus {
  connected: boolean;
  mode: 'live' | 'test' | null;
  hasSubaccount?: boolean;
  appEnv?: 'production' | 'staging';
  isStaging?: boolean;
  isTestMode?: boolean;
  firebaseConfigured?: boolean;
  firebaseProjectId?: string | null;
}

interface PaystackPopupInstance {
  checkout: (options: {
    accessCode: string;
    onSuccess?: (transaction: { reference: string; trans?: string; status?: string }) => void;
    onCancel?: () => void;
    onError?: (err: { message?: string }) => void;
  }) => void;
}

declare global {
  interface Window {
    PaystackPop?: new () => PaystackPopupInstance;
  }
}

export async function fetchPaystackStatus(): Promise<PaystackStatus> {
  try {
    const res = await fetch('/api/paystack/status');
    if (!res.ok) return { connected: false, mode: null };
    return (await res.json()) as PaystackStatus;
  } catch {
    return { connected: false, mode: null };
  }
}

export async function persistCompletedOrderToFirestore(user: User | null, order: OrderRecord): Promise<void> {
  if (!isFirebaseConfigured || !db || !user || !user.emailVerified) return;
  try {
    const batch = writeBatch(db);
    const orderRef = doc(db, 'orders', order.id);
    batch.set(orderRef, {
      buyerUid: user.uid,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      paymentMethod: order.paymentMethod,
      paymentReference: order.paymentReference,
      totalAmount: order.totalAmount,
      currency: order.currency,
      status: 'completed',
      itemCount: order.items.length,
      itemsPreview: order.items
        .map((i) => `${i.beatTitle} (${i.licenseTier.toUpperCase()})`)
        .join(', ')
        .slice(0, 480),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const item of order.items) {
      const itemRef = doc(db, 'orders', order.id, 'items', item.id);
      batch.set(itemRef, {
        orderId: order.id,
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
    handleFirestoreError(fsErr, OperationType.WRITE, `orders/${order.id}`);
  }
}

export async function verifyPaystackReference(reference: string): Promise<OrderRecord> {
  const res = await fetch('/api/paystack/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference }),
  });
  const data = (await res.json()) as { verified?: boolean; order?: OrderRecord; error?: string };
  if (!res.ok || !data.verified || !data.order) {
    throw new Error(data.error || 'Could not verify Paystack payment.');
  }
  return data.order;
}

export async function runPaystackCheckout(params: {
  user: User | null;
  buyerName: string;
  buyerEmail: string;
  paymentMethod: PaymentMethod;
  currency: CurrencyCode;
  items: CartItem[];
}): Promise<OrderRecord> {
  const initRes = await fetch('/api/paystack/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      buyerUid: params.user?.uid || 'guest',
      buyerName: params.buyerName.trim(),
      buyerEmail: params.buyerEmail.trim(),
      paymentMethod: params.paymentMethod,
      currency: params.currency,
      items: params.items.map((item) => ({
        beatId: item.beat.id,
        beatTitle: item.beat.title,
        licenseTier: item.licenseTier,
        price: item.priceUsd,
        audioUrl: item.beat.audioUrl,
        wavUrl: item.beat.wavUrl,
        stemsUrl: item.beat.stemsUrl,
      })),
    }),
  });

  const initJson = (await initRes.json()) as {
    accessCode?: string;
    authorizationUrl?: string;
    reference?: string;
    error?: string;
  };

  if (!initRes.ok || !initJson.accessCode || !initJson.reference) {
    throw new Error(initJson.error || 'Could not initialize Paystack checkout.');
  }

  if (typeof window.PaystackPop !== 'function') {
    throw new Error('Paystack checkout script failed to load. Please refresh the page or check your connection.');
  }

  const transactionRef = await new Promise<string>((resolve, reject) => {
    const popup = new window.PaystackPop!();
    popup.checkout({
      accessCode: initJson.accessCode!,
      onSuccess: (tx) => {
        resolve(tx.reference || initJson.reference!);
      },
      onCancel: () => {
        reject(new Error('Paystack checkout window was closed before completing payment.'));
      },
      onError: (err) => {
        reject(new Error(err?.message || 'Paystack checkout encountered an error.'));
      },
    });
  });

  const verifiedOrder = await verifyPaystackReference(transactionRef);
  await persistCompletedOrderToFirestore(params.user, verifiedOrder);
  return verifiedOrder;
}
