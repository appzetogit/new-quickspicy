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
