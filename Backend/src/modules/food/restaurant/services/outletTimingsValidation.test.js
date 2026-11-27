import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { upsertOutletTimingsForRestaurant } from './outletTimings.service.js';

/** 25:99 was swapped for the default hours, and an all-invalid day read as open 24h. */
let restaurantId;

test.before(async () => {
    const r = await prisma.foodRestaurant.create({
        data: { restaurantName: `${uniqueTag('Hours')} Kitchen`, ownerName: 'O', ownerPhone: uniquePhone('9'), status: 'approved' },
    });
    restaurantId = r.id;
});

test.after(async () => {
    await prisma.foodRestaurantOutletTimings.deleteMany({ where: { restaurantId } });
    await prisma.foodRestaurant.deleteMany({ where: { id: restaurantId } });
    await prisma.$disconnect();
});

test('invalid outlet times are refused', async () => {
    const save = (Monday) => upsertOutletTimingsForRestaurant(restaurantId, { Monday });
    await assert.rejects(() => save({ isOpen: true, openingTime: '25:99', closingTime: '22:00' }), /Monday: "25:99"/);
    await assert.rejects(() => save({ isOpen: true, slots: [{ open: '24:00', close: '99:99' }] }), /not a valid time/);
    await assert.rejects(() => save({ isOpen: true, slots: [{ open: '10:00' }] }), /opening and a closing/);

    const ok = await save({ isOpen: true, slots: [{ open: '11:00', close: '15:00' }, { open: '19:00', close: '23:00' }] });
    assert.equal(ok.outletTimings.Monday.slots.length, 2);
    // A closed day's times are not looked at.
    await save({ isOpen: false, openingTime: 'junk' });
});
