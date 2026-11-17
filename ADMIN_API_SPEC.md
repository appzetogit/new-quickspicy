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
- Dispatch does not enforce zones yet.

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
