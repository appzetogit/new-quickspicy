import test from 'node:test';
import assert from 'node:assert/strict';

import { buildIncomingOrderPushData } from './order-dispatch.service.js';

test('the offer push carries the customer\'s note for the rider, never the kitchen note', () => {
    const order = { id: 'o1', order_id: 'QS1', items: [], note: 'Less spicy', deliveryInstructions: 'Ring the bell' };
    const data = buildIncomingOrderPushData(order, {}, new Date(), 45000);
    assert.equal(data.deliveryInstructions, 'Ring the bell');
    assert.ok(!Object.values(data).includes('Less spicy'));
    // FCM data values must all be strings.
    assert.ok(Object.values(data).every((v) => typeof v === 'string'));
    assert.equal(buildIncomingOrderPushData({ id: 'o2', items: [] }, {}, new Date()).deliveryInstructions, '');
});

test('the offer push carries the order ETA', () => {
    const at = new Date('2026-11-28T10:30:00.000Z');
    const data = buildIncomingOrderPushData({ id: 'o3', items: [], etaMinutes: 25, estimatedDeliveryAt: at }, {}, new Date());
    assert.equal(data.estimatedDeliveryAt, at.toISOString());
    assert.equal(data.etaMinutes, '25');
    assert.equal(buildIncomingOrderPushData({ id: 'o4', items: [] }, {}, new Date()).estimatedDeliveryAt, '');
});
