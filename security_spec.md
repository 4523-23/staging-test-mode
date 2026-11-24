# Security Specification — Exvis Beatz

## 1. Data Invariants
1. **Beat Catalog Integrity**: Beats in `/beats/{beatId}` can only be created, updated, or deleted by the verified Producer Admin (`enockgyamfi614@gmail.com` with `email_verified == true` or trusted `/admins/{uid}`). Public visitors may only read/list beats where `published == true`.
2. **Order Ownership & Terminal Completion Lock**: An `/orders/{orderId}` document can only be created by an authenticated verified user matching `buyerUid == request.auth.uid`, with strictly bounded fields, `totalAmount > 0`, and valid status `'pending'` or `'completed'` upon on-site payment checkout. Once an order reaches terminal status `'completed'`, non-admin clients cannot mutate it.
3. **Order Item Relational Gate (Master Gate)**: `/orders/{orderId}/items/{itemId}` documents require the parent order `/orders/{orderId}` to exist and belong to `request.auth.uid` (or admin).
4. **Producer Payout Isolation**: `/payoutConfigs/{configId}` and `/payoutRequests/{payoutId}` contain sensitive financial routing metadata (masked Bank MasterCard & MTN Mobile Money accounts) and are strictly restricted to `isAdmin()`.
5. **PII Isolation & Anti-Privilege Escalation**: `/users/{userId}` can only be read or created by `request.auth.uid == userId` (with `role == 'buyer'`) or `isAdmin()`. Users cannot assign themselves admin/producer roles.

## 2. Dirty Dozen Attack Payloads (Expected: PERMISSION_DENIED)
1. **Unverified Admin Email Spoof**: User with `email: 'enockgyamfi614@gmail.com'` and `email_verified: false` tries to create a beat in `/beats/b1`.
2. **Buyer Self-Promotion**: Authenticated buyer tries to create `/users/{uid}` with `role: 'producer'` or write to `/admins/{uid}`.
3. **Shadow Field Injection on Beat**: Producer sends extra ghost field `isFeaturedOverride: true` in `/beats/b1`.
4. **Unpublished Beat Scraping**: Anonymous user queries `/beats` without `where('published', '==', true)`.
5. **ID Poisoning**: Client writes to `/orders/{1500-char-invalid-id}` or `/beats/bad$id`.
6. **Negative Price / Zero Total Manipulation**: Client creates `/orders/o1` with `totalAmount: -50` or `totalAmount: 0`.
7. **Cross-User Order Read (PII Leak)**: Buyer A attempts `get` or `list` on `/orders` belonging to Buyer B.
8. **Orphan OrderItem Write**: Client creates `/orders/nonexistent_order/items/i1` where parent order does not exist.
9. **Terminal Order Mutation**: Buyer attempts to change `totalAmount` or `status` on a `'completed'` order.
10. **Payout Config Unauthorized Read**: Non-admin buyer attempts to read `/payoutConfigs/bank_mastercard` or `/payoutRequests/p1`.
11. **Temporal Timestamp Forgery**: Client creates `/orders/o1` with `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`.
12. **Immortal Field Overwrite**: Buyer attempts to update `buyerUid` or `createdAt` on an existing order.
