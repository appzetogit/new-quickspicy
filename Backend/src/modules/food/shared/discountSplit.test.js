import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDiscountSplit } from './discountSplit.util.js';

const restaurantOffer = {
    couponCode: 'SAVE50', discountType: 'flat_price', discountValue: 50,
    createdByRole: 'RESTAURANT', adminBearPercentage: 0, restaurantBearPercentage: 100,
};

test('an old order whose coupon was deleted is not pinned on another offer of the same amount', () => {
    const split = resolveDiscountSplit({
        money: { discount: 50, subtotal: 300, couponCode: 'GONE50' },
        offers: [restaurantOffer],
        restaurantId: 'r1',
    });
    assert.equal(split.restaurantDiscountShare, 0);
    assert.equal(split.adminDiscountShare, 50);
});

test('the order\'s own coupon still decides the split', () => {
    const split = resolveDiscountSplit({
        money: { discount: 50, subtotal: 300, couponCode: 'save50' },
        offers: [restaurantOffer],
        restaurantId: 'r1',
    });
    assert.equal(split.restaurantDiscountShare, 50);
});
