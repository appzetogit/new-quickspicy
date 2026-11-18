import test from 'node:test';
import assert from 'node:assert/strict';

import { findConfigProblems, panelCoverage } from './validateEnv.js';

/**
 * Boot-time configuration checks.
 *
 * The point of these is that production refuses to start rather than serving
 * traffic it cannot complete. A server missing a payment secret looks healthy
 * to a load balancer and fails one customer at a time.
 */

/** A production configuration with nothing missing. */
const complete = (over = {}) => ({
    nodeEnv: 'production',
    databaseUrl: 'postgresql://localhost/x',
    jwtAccessSecret: 'a',
    jwtRefreshSecret: 'b',
    razorpayKeyId: 'k',
    razorpayKeySecret: 's',
    razorpayWebhookSecret: 'w',
    smsApiKey: 'sms',
    smsSenderId: 'sender',
    smsDltTemplateId: 'dlt',
    firebaseServiceAccount: '{}',
    ...over,
});

test('a complete production configuration is accepted', () => {
    assert.deepEqual(findConfigProblems(complete()), []);
});

test('production refuses to start with the OTP bypass on', () => {
    const problems = findConfigProblems(complete({ useDefaultOtp: true }));

    // Every OTP becomes 1234 and comes back in the login response. Anyone can
    // then sign in as any phone number, including an admin's.
    assert.equal(problems.length, 1);
    assert.match(problems[0], /USE_DEFAULT_OTP/);
});

test('the OTP bypass is allowed outside production', () => {
    const problems = findConfigProblems({
        nodeEnv: 'development',
        databaseUrl: 'x', jwtAccessSecret: 'a', jwtRefreshSecret: 'b',
        useDefaultOtp: true,
    });
    assert.deepEqual(problems, [], 'a developer needs neither a gateway nor an SMS account');
});

test('each production secret is reported by name, with what it breaks', () => {
    for (const field of [
        'razorpayKeyId', 'razorpayKeySecret', 'razorpayWebhookSecret',
        'smsApiKey', 'smsSenderId', 'smsDltTemplateId',
    ]) {
        const problems = findConfigProblems(complete({ [field]: undefined }));
        assert.equal(problems.length, 1, `dropping ${field} should be the only problem`);
        // The name of the variable to set, and the consequence of not setting
        // it — an error naming neither is one nobody can act on.
        // It also says where in the admin panel the key can go instead.
        assert.match(problems[0], /^[A-Z0-9_ or]+ is not set, nor saved in admin → .+ — .+\.$/);
    }
});

test('keys saved and switched on in the admin panel stand in for missing env vars', () => {
    const bare = complete({
        razorpayKeyId: undefined, razorpayKeySecret: undefined, razorpayWebhookSecret: undefined,
        smsApiKey: undefined, smsSenderId: undefined, smsDltTemplateId: undefined,
        firebaseServiceAccount: undefined,
    });
    assert.equal(findConfigProblems(bare).length, 7);

    const account = JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com', private_key: 'k', project_id: 'p' });
    const thirdParty = {
        razorpay: { enabled: true, keyId: 'rzp', keySecret: 's', webhookSecret: 'w' },
        sms_india_hub: { enabled: true, apiKey: 'a', senderId: 'QSPICY' },
    };
    assert.deepEqual(findConfigProblems(bare, panelCoverage({ thirdParty, firebase: { serviceAccountCredential: account } })), []);

    // Twilio does the SMS just as well.
    const viaTwilio = panelCoverage({ thirdParty: { twilio: { enabled: true, accountSid: 'AC', authToken: 't', phoneNumber: '+1' } } });
    assert.equal(viaTwilio.sms, true);

    // Saved but switched off counts for nothing, as at runtime.
    const off = panelCoverage({ thirdParty: { ...thirdParty, razorpay: { ...thirdParty.razorpay, enabled: false } } });
    assert.equal(findConfigProblems(bare, off).filter((p) => p.startsWith('RAZORPAY')).length, 3);

    // A Firebase credential that is not a service account does not count.
    assert.equal(panelCoverage({ firebase: { serviceAccountCredential: '{"apiKey":"x"}' } }).firebase, false);
});

test('either form of the Firebase credential satisfies the check', () => {
    const viaPath = complete({ firebaseServiceAccount: undefined, firebaseServiceAccountPath: '/x.json' });
    assert.deepEqual(findConfigProblems(viaPath), []);

    const neither = complete({ firebaseServiceAccount: undefined });
    assert.equal(findConfigProblems(neither).length, 1);
});

test('the things with no safe default are demanded everywhere', () => {
    const problems = findConfigProblems({ nodeEnv: 'development' });

    // No database and no way to sign a token: nothing works in any environment.
    assert.equal(problems.length, 3);
    assert.ok(problems.some((p) => p.startsWith('DATABASE_URL')));
    assert.ok(problems.some((p) => p.includes('JWT_ACCESS_SECRET')));
    assert.ok(problems.some((p) => p.includes('JWT_REFRESH_SECRET')));
});

test('a dependency that is switched on has to be configured', () => {
    const noUrl = findConfigProblems(complete({ redisEnabled: true }));
    assert.equal(noUrl.length, 1);
    assert.match(noUrl[0], /REDIS_URL/);

    // Queues run on Redis, so asking for one without the other cannot work.
    const noRedis = findConfigProblems(complete({ bullmqEnabled: true }));
    assert.equal(noRedis.length, 1);
    assert.match(noRedis[0], /BULLMQ_ENABLED/);
});

test('open CORS in production is warned about, not refused', async () => {
    const { findConfigWarnings } = await import('./validateEnv.js');

    // A warning, because it does not affect the mobile apps and an operator
    // should still be able to bring the API up — but not silence.
    const open = findConfigWarnings(complete({ corsOrigins: [] }));
    assert.equal(open.length, 1);
    assert.match(open[0], /CORS_ORIGINS/);

    assert.deepEqual(findConfigWarnings(complete({ corsOrigins: ['https://admin.example.com'] })), []);
    assert.deepEqual(findConfigWarnings({ nodeEnv: 'development', corsOrigins: [] }), []);

    // And it is only ever a warning: the same configuration is fit to run.
    assert.deepEqual(findConfigProblems(complete({ corsOrigins: [] })), []);
});
