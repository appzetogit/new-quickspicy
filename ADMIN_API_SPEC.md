# Admin API — additions

New admin endpoints, for the admin panel or any admin tool. All are under
`/api/v1/food/admin`, need an admin Bearer token, and return
`{ success, message, data }`. Sub-admins need the permission shown.

## Business verticals (Food, Home Food, …) — `restaurant_management`

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/verticals` | `?includeInactive=true` | `{ verticals: [{ id, name, nameTe, slug, description, image, isDefault, isActive, sortOrder, restaurantCount }] }` |
| POST | `/verticals` | `{ name, nameTe?, description?, image?, isDefault?, isActive?, sortOrder? }` | `{ vertical }` |
| PATCH | `/verticals/:id` | any of the above | `{ vertical }` |
| DELETE | `/verticals/:id` | — | `{ deleted, deactivated, restaurantCount }` |
| PUT | `/restaurants/:id/verticals` | `{ verticalIds: ["…"] }` | `{ restaurant: { id, restaurantName, verticalIds } }` |

- Names are unique ignoring case and spacing.
- Exactly one vertical is the default ("Food" out of the box). Restaurants with no verticals belong to it. Making another one default moves the flag; the default cannot be deleted, switched off or un-defaulted directly.
- DELETE on a vertical restaurants still use switches it off instead (`deactivated: true`). An unused one is removed, and categories/products pointing at it fall back to "no vertical".
- `PUT .../verticals` replaces the list. `[]` puts the restaurant back in the default vertical. Unknown or switched-off ids are refused.

## Outlets of one brand — `restaurant_management`

| Method | Path | Body | Returns |
|---|---|---|---|
| PUT | `/restaurants/:id/outlets` | `{ outletIds: ["…"] }` | `{ outletGroupId, outlets: [{ id, restaurantName, area, city, status }] }` |
| DELETE | `/restaurants/:id/outlets` | — | `{ outletGroupId, outlets }` (what is left) |

- PUT links `:id` and the listed restaurants into one group, keeping `:id`'s group if it already has one. Restaurants in another group move into this one.
- DELETE takes `:id` out of its group. A group left with a single restaurant is dissolved.
- Customers see the other outlets at `GET /food/restaurant/restaurants/:id/outlets`. List cards carry `outletCount`.

## Rider cohorts and service areas — `delivery_management`

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/delivery/cohorts` | `?includeInactive=true` | `{ cohorts: [{ id, name, description, zoneIds, zones: [{ id, name, isActive }], isActive, sortOrder, riderCount }] }` |
| POST | `/delivery/cohorts` | `{ name, description?, zoneIds?, isActive?, sortOrder? }` | `{ cohort }` |
| PATCH | `/delivery/cohorts/:id` | any of the above | `{ cohort }` |
| DELETE | `/delivery/cohorts/:id` | — | `{ deleted: true, ridersReleased }` |
| POST | `/delivery/cohorts/:id/riders` | `{ riderIds: ["…"] }` (max 500) | `{ cohortId, ridersUpdated }` |
| PATCH | `/delivery/:id/service-area` | `{ zoneId?, cohortId? }` (`null` clears) | `{ rider: { id, name, zoneId, cohortId } }` |

- A rider has one home zone and at most one cohort; adding riders to a cohort moves them out of any other.
- Deleting a cohort leaves its riders with no cohort; it never deletes riders.
- Riders see the result at `GET /food/delivery/service-area` (see DELIVERY_API_SPEC.md).
- Dispatch uses this only in zones switched to "riders from this zone only" (next section).

## Zone-restricted dispatch — `delivery_management`

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/dispatch/settings` | — | `{ …, zones: [{ id, name, city, dispatchMode, effectiveMode, ridersFromZoneOnly }] }` |
| PATCH | `/dispatch/zones/:zoneId` | `{ ridersFromZoneOnly: true\|false }` and/or `{ dispatchMode: null\|"auto"\|"manual" }` | `{ zoneId, ridersFromZoneOnly?, dispatchMode?, effectiveMode? }` |

- Off (the default), a zone's orders go to the nearest free rider, as before.
- On, auto dispatch only offers the zone's orders to riders who **serve** it: their home zone is that zone, or their cohort (if active) lists it. Others are skipped as if busy.
- In the manual picker (`GET /orders/:id/eligible-riders`) each rider has `servesZone`. Assigning a rider who doesn't serve a restricted zone needs `force: true` and a `reason`, like a rider outside the zone.
- A body with only `ridersFromZoneOnly` leaves the dispatch mode alone.

## Rider pay rules by zone

There is no separate pay-rule screen: rider pay already comes from the **per-zone fee settings** (`GET/PUT /fee-settings` with a zone). Each distance band in `deliveryFeeRanges` has `deliveryBoyBasePay` and `deliveryBoyPerKm`, plus `riderMinPayPerTrip` as a floor. A zone without its own settings uses the platform ones. Pay that depends on a cohort, or on how many orders a rider does (slabs), is set up as an incentive (next section).

## Rider incentives — `delivery_management`

Existing endpoints, now with targeting, daily/weekly runs, order slabs and auto-credit:

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/delivery/earning-addons` | — | `{ earningAddons: [addon] }` |
| POST | `/delivery/earning-addons` | addon fields (below) | `{ earningAddon }` |
| PATCH | `/delivery/earning-addons/:id` | addon fields | `{ earningAddon }` |
| PATCH | `/delivery/earning-addons/:id/status` | `{ status: "active"\|"inactive" }` | `{ earningAddon }` |
| DELETE | `/delivery/earning-addons/:id` | — | |
| GET | `/delivery/earning-addon-history` | `?search=&from=&to=&page=&limit=` | `{ history: [{ …, periodKey, periodStart, periodEnd, tier, status }], pagination }` |
| POST | `/delivery/earning-addon-history/:id/credit` | `{ notes? }` | the grant |
| POST | `/delivery/earning-addon-history/:id/cancel` | `{ reason? }` | the grant |
| POST | `/delivery/earning-addon-completions/check` | `{ deliveryPartnerId: "all"\|id }` | `{ completionsFound, autoCredited }` |

Addon fields: `title, description, criteria ("orders"|"online_hours"), requiredOrders, requiredOnlineHours (or requiredOnlineMinutes), earningAmount, startDate, endDate, maxRedemptions`, and new:

- `zoneIds: []`: only riders who serve one of these zones (home zone or cohort zones), and only orders **from** these zones count. Empty means everyone and every order.
- `cohortIds: []`: only riders in one of these cohorts. If both are set, both must hold.
- `recurrence: "none" | "daily" | "weekly"`: `none` counts over the whole offer and pays once. `daily` / `weekly` restart the count every IST day / Monday–Sunday IST week inside the offer dates, and pay once per period.
- `tiers: [{ requiredOrders, earningAmount }]`: order slabs (orders criteria only). Each slab reached pays its own amount, once per period. `[{4, 80}, {8, 200}]` pays ₹80 at 4 orders and another ₹200 at 8. With slabs, `requiredOrders` / `earningAmount` are not used.
- `autoCredit: true`: credit the rider's wallet as soon as a target is met, instead of waiting in the history for an admin to credit it.

Targets are checked after every delivery and by an hourly sweep, which also picks up online-hours targets and auto-credits. A grant an admin cancelled is not re-created by these automatic checks; the manual check above can re-grant it.

## Weekly payout statements — `transaction_management`

One statement per rider or restaurant per Monday–Sunday IST week, built from the same ledger figures as the balance sheet (captured orders not yet settled).

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/withdrawals/payout-statements/generate` | `{ entityType?: "rider"\|"restaurant"\|"all", weekStart?: "YYYY-MM-DD" }` (default: last complete week) | `{ weekStart, weekEnd, created, refreshed, removed, frozen }` |
| GET | `/withdrawals/payout-statements` | `?entityType=&entityId=&status=draft\|approved\|paid\|void&weekStart=&page=&limit=` | `{ statements: [statement], pagination }` |
| GET | `/withdrawals/payout-statements/:id` | — | statement with `lines` |
| GET | `/withdrawals/payout-statements/:id/pdf` | `?inline=1` to view in the browser | the PDF |
| PATCH | `/withdrawals/payout-statements/:id/adjustment` | `{ amount, note }` (signed; note required unless 0) | statement |
| POST | `/withdrawals/payout-statements/:id/approve` | — | statement |
| POST | `/withdrawals/payout-statements/:id/mark-paid` | `{ payoutRef?, notes? }` | statement |
| POST | `/withdrawals/payout-statements/:id/void` | `{ reason? }` | statement |

Statement: `{ id, entityType, entityId, name, phone, weekKey, periodStart, periodEnd, orders, grossSales, commission, earnings, incentives, cashCollected, cashDeposited, cashInHand, adjustments, adjustmentNote, net, status, approvedAt, paidAt, payoutRef, notes, settlementId, lineCount, lines? }`.

- Riders: `earnings` = the rider's share of the week's orders (tips included), `incentives` = incentives and bonuses, `net = earnings + incentives − cashInHand + adjustments`. A negative `net` means the rider holds more customer cash than they earned and owes the difference.
- Restaurants: `grossSales` = item sales, `earnings` = restaurant share after commission, `net = earnings + adjustments`.
- **draft**: made by generate (also every 6 hours for last week) and refreshed each time; adjustments survive a refresh. **approved**: figures frozen, and the rider / restaurant can now see it. **paid**: records a payment you made by bank or UPI. It settles that week's orders through the balance sheet and notifies the rider / restaurant. It does **not** send money. **void**: dropped; a later generate makes a fresh draft.
- Only an approved statement can be marked paid, and only once.

## Rider document verification — `delivery_management`

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/delivery/:id/documents` | — | `{ riderId, name, riderStatus, documents: [doc], summary }` |
| PATCH | `/delivery/:id/documents/:key` | `{ status: "approved"\|"rejected"\|"pending", reason?, expiresAt? }` | same as GET |

- `key`: `profilePhoto`, `aadharPhoto`, `panPhoto`, `drivingLicensePhoto`, or the key of a registration field of type document.
- doc: `{ key, label, custom, required, url, number, status, reason, expiresAt, reviewedAt, canReupload }`, where status is `missing | pending | approved | rejected | expired`.
- Rejecting needs a `reason`; the rider gets a push asking them to upload again. `expiresAt` (e.g. licence validity) turns an approved document into `expired` after that date.
- When the rider uploads a new file, the document goes back to `pending` on its own.
- `summary`: `{ approved, pending, rejected, expired, missing, allVerified }`. It sits beside the rider's overall approve/reject and doesn't change it.

## Telugu translations — `food_management`

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/translations` | `?entity=item\|category\|vertical&missing=true&search=&restaurantId=&page=&limit=` | `{ entity, items: [{ id, name, nameTe, description?, descriptionTe? }], total, page, limit }` |
| PATCH | `/translations/:entity/:id` | `{ nameTe?, descriptionTe? }` | `{ item }` |
| PUT | `/translations` | `{ translations: [{ entity, id, nameTe?, descriptionTe? }] }` (max 500) | `{ updated }` |

- `missing=true` lists what still needs translating (for dishes: the name, or a description that exists but has no Telugu).
- Only dishes (`item`) have descriptions.
- The bulk call is all-or-nothing: one bad row and nothing is saved.
- An empty Telugu text means "use the English", so clearing a translation is sending `""`.

## Settings pages, reports and tools (built out 2026-11-18)

| Method | Path | Body / query | Returns | Permission |
|---|---|---|---|---|
| GET | `/platform-settings/:key` | — | `{ key, value, updatedAt }` (secrets masked `••••1234`) | `system_settings` |
| PUT | `/platform-settings/:key` | `{ value: {...} }` | same | `system_settings` |
| GET | `/reports/coupon-orders` | `?from=&to=&couponCode=&page=&limit=` | `{ coupons: [...], orders: [...], pagination }` | `report_management` |
| GET | `/reports/customer-rewards` | `?from=&to=&search=&page=` | `{ rows: [{ name, phone, cashback, referral, topupBonus, adminCredit, total }], totals, pagination }` | `report_management` |
| POST | `/customers/:id/wallet/credit` | `{ amount, reason, requestId }` | `{ transactionId, amount, balance }` | `customer_management` edit |
| GET | `/customers/wallet-credits` | `?page=&limit=` | `{ credits: [...], pagination }` | `customer_management` |
| POST | `/restaurants/bulk-import` | `{ rows: [{ restaurantName, ownerName, ownerPhone, zone, ownerEmail?, city?, area?, address?, pincode?, latitude?, longitude?, cuisines? }] }` (max 500) | `{ created, failed, results: [{ line, ok, id?, reason? }] }` | `restaurant_management` create |
| GET | `/files` | `?folder=` | `{ folder, folders: [...], files: [{ path, name, size, url, modifiedAt }] }` | `system_settings` |
| GET | `/withdrawals/balance-sheet/history` | now also `?from=&to=`; rows carry `name`, `phone` | | `transaction_management` |

Setting keys: `app_web, firebase, analytics, ai, react_site, join_us, login_setup, email_templates, theme, react_registration, offline_payment, notification_channels, addon_activation, third_party, withdraw_methods, wallet_bonus, landing_admin, landing_react`. Any field named like a key, token, secret, password or credential is masked on read; sending the masked value back keeps the stored one.

- Admin wallet credits are capped at ₹50,000 each, need a reason, and a repeated `requestId` credits once.
- `wallet_bonus` = `{ enabled, rules: [{ title, minAmount, bonusType: flat|percentage, value, maxBonus, startDate, endDate, isActive }] }`. The best matching rule is credited once per confirmed wallet top-up.
- Bulk-imported restaurants are `pending` with no documents; the owner finishes onboarding after OTP login.

## Order bill, running late, change to wallet, company UPI (2026-11-20)
All under `/food/admin`.

| Method | Path | Section | Body / query → data |
|---|---|---|---|
| GET | `/orders/:orderId/invoice` | order_management | the customer's bill JSON (same as `GET /food/orders/:id/invoice`) |
| GET | `/orders/:orderId/invoice.html` | order_management | printable bill (₹, GST, platform fee, full address) |
| POST | `/orders/:orderId/running-late` | order_management | `{ reason: traffic\|rain\|restaurant_delay\|other, extraMinutes: 1–120, note? }` → `{ etaMinutes, estimatedDeliveryAt, delay, message }`; pushes the customer |
| GET | `/change-credits` | transaction_management | `status=pending\|approved\|rejected`, `fromDate`, `toDate`, `deliveryPartnerId`, `page`, `limit` → `{ items: [{ id, orderId, orderDisplayId, orderTotal, orderStatus, rider, customer, amount, cashCollected, orderCashDue, overpaid, riderNote, status, rejectReason, reviewedAt, walletTxnId, createdAt }], pagination }` |
| GET | `/change-credits/summary` | transaction_management | `date=YYYY-MM-DD` (IST, default today) → `{ requested: { pending, approved, rejected }, approvedToday, rejectedToday, pendingTotal: { count, amount, oldestAt }, approvedByRider: [...] }` |
| POST | `/change-credits/:id/approve` | transaction_management (edit) | credits the customer's wallet (`recordTransaction`, category `adjustment`, idempotent per request) and pushes them; the amount is added to the rider's cash in hand |
| POST | `/change-credits/:id/reject` | transaction_management (edit) | `{ reason }` (required, shown to the rider) |
| GET / PUT | `/company-collection-settings` | system_settings | `{ useCompanyUpiQr, upiId, payeeName, bank: { accountHolderName, accountNumber, ifsc, bankName } }`. Read returns the account number masked (`••••1234`) plus `razorpayConfigured` and `activeMode` (`company_upi \| razorpay \| none`); sending the mask or an empty number keeps the stored one (`bank.clearAccountNumber: true` removes it) |
| GET | `/upi-collections` | transaction_management | `status=awaiting_payment\|rider_confirmed\|reconciled\|mismatch\|abandoned` → `{ items, summary: { <status>: { count, amount } }, pagination }` |
| POST | `/upi-collections/:orderId/reconcile` | transaction_management (edit) | `{ outcome: reconciled\|mismatch, note }` (note required for mismatch) |

**Change-to-wallet accounting.** The rider keeps the customer's whole note (e.g. ₹500 on a ₹380 order) and the ₹120 change goes to the customer's wallet. On approval the ₹120 is added to the rider's cash in hand everywhere it is computed (rider wallet `cashInHand` + `changeKeptForCustomers`, admin rider list, balance sheet / payout statements on unsettled cash orders), so their deposit covers it. Pending or rejected requests change nothing.

**Company UPI.** Orders collected this way carry `payment.qr.provider = "company_upi"` and `payment.qr.needsReconciliation` (true until reconciled). The online payments report labels them `Company UPI` with status `Rider confirmed – reconcile` / `UPI mismatch`, and `companyUpi` / `needsReconciliation` flags per row; the admin orders list shows "Company UPI (verify)". Admin page: Transactions → Change to Wallet & UPI (`/admin/food/change-to-wallet`). Settings: 3rd Party page, "Company UPI collection".

**Late-order watchdog.** The scheduler (`run-scheduled-jobs.js`, every 5 min) sends a one-time "Sorry, your order is delayed" push for live, unscheduled orders more than 10 min past `promisedDeliveryAt` (the first ETA, or the time last announced in a running-late update). `order.delay.autoNotice` turns true.

## Online payment per zone (2026-11-21) — `system_settings`
All under `/food/admin`. Same screen and endpoints as the per-zone COD settings (Settings → COD & User Payments).

| Method | Path | Body / query → data |
|---|---|---|
| GET | `/cod-settings` | → `{ platformCodEnabled, platformOnlinePaymentEnabled: true, zones: [{ id, name, city, codEnabled, codMinDeliveredOrders, onlinePaymentEnabled, effective: { newCustomer, returningCustomer }, effectiveOnlinePayment: { allowed, reason, bothOff } }] }` |
| PATCH | `/zones/:id/cod` | any of `{ codEnabled: true\|false\|null, codMinDeliveredOrders: int ≥ 0, onlinePaymentEnabled: true\|false\|null }` → `{ zone: <same row shape> }`. 400 on a bad value or an empty body. |

- `onlinePaymentEnabled`: `null` = platform default, which is **on** (there is no platform-wide online switch); `false` turns Razorpay checkout off for orders from restaurants in that zone; `true` pins it on. An absent key leaves it unchanged.
- "Online payment" means the customer's Razorpay checkout for a new order, including the online part of a wallet + online split. Not affected: wallet-only orders, wallet top-ups (not zone-bound), the rider's COD collection QR (`collect/qr`, Razorpay link or company UPI), and verifying / webhooks for payments already started.
- Both COD and online off is allowed but `effectiveOnlinePayment.bothOff` is `true` and the screen shows a warning: customers there can only pay with a wallet that covers the whole order, and checkout tells everyone else no method is available.
- `PATCH /cod-settings` (the platform COD switch) is unchanged.
