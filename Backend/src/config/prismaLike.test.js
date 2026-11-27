import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from './prisma.js';
import { uniquePhone, uniqueTag } from '../utils/testIds.js';

test('search terms with % or _ match literally, not as wildcards', async () => {
    const tag = uniqueTag('Like');
    const plain = await prisma.foodUser.create({ data: { phone: uniquePhone('7'), name: `${tag} Plain` } });
    const odd = await prisma.foodUser.create({ data: { phone: uniquePhone('7'), name: `${tag} 50%_off` } });
    try {
        const ids = [plain.id, odd.id];
        const where = { id: { in: ids }, name: { contains: '%', mode: 'insensitive' } };
        assert.deepEqual((await prisma.foodUser.findMany({ where })).map((u) => u.id), [odd.id]);
        // The same where object reused for count must not be escaped twice.
        assert.equal(await prisma.foodUser.count({ where }), 1);
        assert.equal(await prisma.foodUser.count({ where: { id: { in: ids }, name: { contains: '_' } } }), 1);
        assert.equal(await prisma.foodUser.count({ where: { id: { in: ids }, OR: [{ name: { endsWith: '%_off' } }] } }), 1);
        assert.equal(await prisma.foodUser.count({ where: { id: { in: ids }, name: { startsWith: tag } } }), 2);
    } finally {
        await prisma.foodUser.deleteMany({ where: { id: { in: [plain.id, odd.id] } } });
    }
});
