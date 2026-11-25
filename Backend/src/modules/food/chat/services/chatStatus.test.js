import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone } from '../../../../utils/testIds.js';
import {
    getConversationStatusHistory,
    sendMessage,
    updateConversationStatus,
} from './chat.service.js';

/**
 * Live Chat ticket statuses (BRD 49): Open, In progress, Resolved (closed) and
 * Flag; support replying moves an Open thread to In progress; every change is
 * kept in the status history.
 */

const ADMIN = { role: 'ADMIN', id: 'admin-test' };
const users = [];
const threads = [];

const thread = (conversationId) => prisma.foodChatConversation.findUnique({ where: { conversationId } });

async function newThread(text = 'help') {
    const user = await prisma.foodUser.create({ data: { phone: uniquePhone('7') } });
    users.push(user);
    const message = await sendMessage({ role: 'USER', id: user.id }, { peerRole: 'ADMIN', text });
    threads.push(message.conversationId);
    return { user, conversationId: message.conversationId };
}

test.after(async () => {
    const rows = await prisma.foodChatConversation.findMany({
        where: { conversationId: { in: threads } },
        select: { id: true },
    });
    await prisma.foodSupportTicketStatusHistory.deleteMany({
        where: { ticketSource: 'chat', ticketId: { in: rows.map((r) => r.id) } },
    });
    await prisma.foodChatMessage.deleteMany({ where: { conversationId: { in: threads } } });
    await prisma.foodChatConversation.deleteMany({ where: { conversationId: { in: threads } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await prisma.$disconnect();
});

test('a customer writing in leaves the thread Open; a support reply moves it to In progress', async () => {
    const { user, conversationId } = await newThread();
    assert.equal((await thread(conversationId)).status, 'open');

    // The customer writing again changes nothing.
    await sendMessage({ role: 'USER', id: user.id }, { peerRole: 'ADMIN', text: 'hello?' });
    assert.equal((await thread(conversationId)).status, 'open');

    await sendMessage(ADMIN, { peerRole: 'USER', peerId: user.id, text: 'On it' });
    assert.equal((await thread(conversationId)).status, 'in_progress');

    const { history } = await getConversationStatusHistory(ADMIN, conversationId);
    assert.equal(history.length, 1);
    assert.equal(history[0].fromStatus, 'open');
    assert.equal(history[0].toStatus, 'in_progress');
    assert.equal(history[0].note, 'Admin replied');
});

test('support replying to a Resolved or Flagged thread does not change it', async () => {
    const { user, conversationId } = await newThread();

    await updateConversationStatus(ADMIN, conversationId, 'flagged');
    await sendMessage(ADMIN, { peerRole: 'USER', peerId: user.id, text: 'Checking with the restaurant' });
    assert.equal((await thread(conversationId)).status, 'flagged');

    await updateConversationStatus(ADMIN, conversationId, 'resolved');
    const row = await thread(conversationId);
    assert.equal(row.status, 'closed', '"resolved" is stored as closed');
    assert.ok(row.closedAt);
});

test('every manual change is in the history, oldest first, in panel terms', async () => {
    const { conversationId } = await newThread();

    await updateConversationStatus(ADMIN, conversationId, 'flagged');
    await updateConversationStatus(ADMIN, conversationId, 'closed');
    await updateConversationStatus(ADMIN, conversationId, 'open');
    // Setting the same status again is not a change.
    await updateConversationStatus(ADMIN, conversationId, 'open');

    const { history } = await getConversationStatusHistory(ADMIN, conversationId);
    assert.deepEqual(
        history.map((h) => [h.fromStatus, h.toStatus]),
        [
            ['open', 'flagged'],
            ['flagged', 'closed'],
            ['closed', 'open'],
        ],
    );
});

test('only support can flag a thread or read its history', async () => {
    const { user, conversationId } = await newThread();
    const customer = { role: 'USER', id: user.id };

    await assert.rejects(() => updateConversationStatus(customer, conversationId, 'flagged'), /Only support/);
    await assert.rejects(() => getConversationStatusHistory(customer, conversationId), /Only support/);
    // A customer can still close their own thread, as before.
    await updateConversationStatus(customer, conversationId, 'closed');
    assert.equal((await thread(conversationId)).status, 'closed');
});

test('an unknown status is refused', async () => {
    const { conversationId } = await newThread();
    await assert.rejects(() => updateConversationStatus(ADMIN, conversationId, 'archived'), /Status must be/);
});
