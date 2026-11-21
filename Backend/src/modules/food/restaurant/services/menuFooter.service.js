import { loadActiveFeeSettings } from '../../orders/services/order-pricing.service.js';

/**
 * The note block at the end of a store's menu (client spec C6), returned as
 * `menuFooter` on GET /food/restaurant/restaurants/:id so the web and the
 * Flutter apps render the same text.
 *
 * Facts it states, and where they come from:
 *  - Taxes: GST is charged on the food only, at the zone's fee-settings
 *    `gstRate`, on top of the menu price (order-pricing.service.js). So menu
 *    prices are exclusive of GST whenever that rate is above 0.
 *  - Packing: the restaurant's own `packagingCharge`, added once per order
 *    as the bill's packagingFee (resolvePackagingFee in order-pricing). 0 is
 *    reported rather than left out, so the app can say so plainly.
 *  - FSSAI number, legal name (GST legal name, else the store name) and the
 *    store address are the restaurant's own public fields.
 */

export const NUTRITION_NOTE = 'An average active adult requires 2,000 kcal energy per day, however calorie needs may vary.';
export const MENU_DISCLAIMER =
    'Menu items, prices, photos and descriptions are set by the restaurant. Dishes may vary from the pictures shown. '
    + 'Please inform the restaurant of any allergies before ordering.';

const formatRate = (rate) => (Number.isInteger(rate) ? String(rate) : rate.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

const addressOf = (restaurant = {}) => {
    const loc = restaurant.location || {};
    const formatted = String(restaurant.formattedAddress || loc.formattedAddress || '').trim();
    if (formatted) return formatted;
    return [
        restaurant.addressLine1 ?? loc.addressLine1,
        restaurant.addressLine2 ?? loc.addressLine2,
        restaurant.area ?? loc.area,
        restaurant.city ?? loc.city,
        restaurant.state ?? loc.state,
        restaurant.pincode ?? loc.pincode,
    ]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .join(', ');
};

/** Pure: the footer for a public restaurant detail and the GST rate that applies to it. */
export function buildMenuFooter(restaurant = {}, { gstRate = null } = {}) {
    // null = the rate could not be read; say only what is certain.
    const unknown = gstRate === null || gstRate === undefined;
    const rate = Number(gstRate);
    const safeRate = unknown ? null : Number.isFinite(rate) && rate > 0 ? rate : 0;
    const pricesIncludeTax = unknown ? null : safeRate === 0;
    const taxNote = unknown
        ? 'Applicable taxes, if any, are shown in your bill at checkout.'
        : pricesIncludeTax
            ? 'Menu prices are final. No GST is added at checkout.'
            : `Menu prices are exclusive of taxes. GST of ${formatRate(safeRate)}% on food is added at checkout.`;

    const rawPacking = Number(restaurant.packagingCharge);
    const packagingCharge = Number.isFinite(rawPacking) && rawPacking > 0 ? Math.round(rawPacking * 100) / 100 : 0;
    const packagingNote = packagingCharge > 0
        ? `A packing charge of ₹${Number.isInteger(packagingCharge) ? packagingCharge : packagingCharge.toFixed(2)} per order is added to your bill.`
        : 'No packing charges are added to your bill.';

    const fssaiNumber = String(restaurant.fssaiNumber || '').trim() || null;
    const legalName = String(restaurant.gstLegalName || '').trim() || String(restaurant.restaurantName || restaurant.name || '').trim() || null;
    const address = addressOf(restaurant) || null;

    const notes = [
        { key: 'menu_disclaimer', title: 'Menu disclaimer', text: MENU_DISCLAIMER },
        { key: 'nutrition', title: 'Nutritional information', text: NUTRITION_NOTE },
        { key: 'taxes', title: 'Taxes', text: taxNote },
        { key: 'packing', title: 'Packing charges', text: packagingNote },
    ];
    if (fssaiNumber) notes.push({ key: 'fssai', title: 'FSSAI licence', text: `Lic. No. ${fssaiNumber}` });

    return {
        legalName,
        address,
        fssaiNumber,
        gstNumber: restaurant.gstNumber || null,
        packagingCharge,
        packagingNote,
        tax: { gstRate: safeRate, pricesIncludeTax, appliesTo: 'food', note: taxNote },
        nutritionNote: NUTRITION_NOTE,
        menuDisclaimer: MENU_DISCLAIMER,
        notes,
    };
}

/** Loads the zone's GST rate and builds the footer. Never throws: a footer is not worth a 500. */
export async function getMenuFooter(restaurant = {}) {
    let gstRate = null;
    try {
        const fees = await loadActiveFeeSettings(restaurant.zoneId || null);
        gstRate = Number(fees?.gstRate) || 0;
    } catch {
        gstRate = null;
    }
    return buildMenuFooter(restaurant, { gstRate });
}
