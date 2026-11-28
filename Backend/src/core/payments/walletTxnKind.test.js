import test from 'node:test';
import assert from 'node:assert/strict';

import { toWalletTransaction } from './wallet.service.js';

// 165: only real order refunds are typed and labelled as refunds.
test('wallet rows: only order_refund is a refund; change, cashback, tip return are their own kind', () => {
    const row = (category, extra = {}) => toWalletTransaction({ id: 'x', type: 'credit', amount: 10, status: 'completed', category, metadata: {}, ...extra });
    assert.deepEqual([row('order_refund').type, row('order_refund').kind], ['refund', 'refund']);
    const change = row('adjustment', { metadata: { kind: 'cod_change_credit' } });
    assert.deepEqual([change.type, change.kind], ['addition', 'change_credit']);
    assert.equal(row('wallet_topup', { description: 'Cashback on order QS1', metadata: { source: 'cashback' } }).kind, 'cashback');
    assert.equal(row('referral_reward').kind, 'referral');
    const tip = row('adjustment', { metadata: { kind: 'tip_return', source: 'adjustment' } });
    assert.deepEqual([tip.type, tip.kind], ['addition', 'tip_returned']);
});
