import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone } from '../../../../utils/testIds.js';
import { updateCurrentUserProfile } from './userProfile.service.js';

test('an invalid date of birth is refused and the saved one is kept', async () => {
    const user = await prisma.foodUser.create({ data: { phone: uniquePhone('7'), dateOfBirth: new Date('2000-01-31T00:00:00Z') } });
    try {
        for (const bad of ['2023-13-45', '2023-02-30', 'abc', '2999-01-01']) {
            await assert.rejects(() => updateCurrentUserProfile(user.id, { dateOfBirth: bad }), /valid past date/);
        }
        const kept = await prisma.foodUser.findUnique({ where: { id: user.id } });
        assert.equal(kept.dateOfBirth.toISOString().slice(0, 10), '2000-01-31');
        // The app echoes the stored ISO value back; that must still save.
        const { user: same } = await updateCurrentUserProfile(user.id, { dateOfBirth: '2000-01-31T00:00:00.000Z' });
        assert.equal(same.dateOfBirth.toISOString().slice(0, 10), '2000-01-31');
    } finally {
        await prisma.foodUser.delete({ where: { id: user.id } });
    }
});
