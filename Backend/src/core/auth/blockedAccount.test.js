import test from 'node:test';
import assert from 'node:assert/strict';

import { formatBlockedMessage, blockedAccountError } from './blockedAccount.js';
import { AuthError } from './errors.js';

test('a ban with a reason names it, and the support number', () => {
    assert.equal(
        formatBlockedMessage('Repeated fake orders.', '+91 98765 43210'),
        'Quick Spicy banned your account due to the reason: Repeated fake orders. Please contact the Quick Spicy team at +91 98765 43210.',
    );
});

test('no reason or no phone falls back to the plain wording', () => {
    assert.equal(
        formatBlockedMessage(null, '+91 98765 43210'),
        'Quick Spicy has blocked your account. Please contact the Quick Spicy team at +91 98765 43210.',
    );
    assert.equal(
        formatBlockedMessage('  Abuse  ', ''),
        'Quick Spicy banned your account due to the reason: Abuse. Please contact the Quick Spicy team.',
    );
    assert.equal(formatBlockedMessage('', ''), 'Quick Spicy has blocked your account. Please contact the Quick Spicy team.');
});

test('the error carries the ban details for the error handler', () => {
    const err = blockedAccountError(AuthError, 'msg', 'Abuse');
    assert.equal(err.statusCode, 401);
    assert.equal(err.isBlocked, true);
    assert.equal(err.banReason, 'Abuse');
});
