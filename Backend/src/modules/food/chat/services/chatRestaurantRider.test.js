import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { sendMessage, listConversations, getHistory } from './chat.service.js';

/**
 * A restaurant's message to the rider on an accepted order reaches the rider:
 * it is in the rider's inbox (peer RESTAURANT) and its history, and the rider
 * can answer it on the same thread.
 */
const ids = { restaurant: null, user: null, rider: null, order: null };

test.before(async () => {
    const tag = uniqueTag('RRChat');
    ids.restaurant = (await prisma.foodRestaurant.create({
        data: { restaurantName: `${tag} Kitchen`, ownerName: 'Owner', ownerPhone: uniquePhone('9'), status: 'approved' },
    })).id;
    ids.user = (await prisma.foodUser.create({ data: { name: `${tag} Customer`, phone: uniquePhone('5') } })).id;
    ids.rider = (await prisma.foodDeliveryPartner.create({
        data: { name: `${tag} Rider`, phone: uniquePhone('8'), status: 'approved' },
    })).id;
    ids.order = (await prisma.foodOrder.create({
        data: {
            order_id: `T-${tag}`.slice(0, 30), restaurantId: ids.restaurant, userId: ids.user,
            addrStreet: '1 Test Street', addrCity: 'Indore', addrState: 'MP',
            subtotal: 100, total: 100, paymentMethod: 'razorpay', paymentStatus: 'paid', orderStatus: 'preparing',
            dispatchStatus: 'accepted', dispatchDeliveryPartnerId: ids.rider, dispatchAcceptedAt: new Date(),
        },
    })).id;
});

test.after(async () => {
    await prisma.foodChatMessage.deleteMany({ where: { orderId: ids.order } });
    await prisma.foodChatConversation.deleteMany({ where: { orderId: ids.order } });
    await prisma.foodOrder.deleteMany({ where: { id: ids.order } });
    await prisma.foodDeliveryPartner.deleteMany({ where: { id: ids.rider } });
    await prisma.foodUser.deleteMany({ where: { id: ids.user } });
    await prisma.foodRestaurant.deleteMany({ where: { id: ids.restaurant } });
    await prisma.$disconnect();
});

test('restaurant to rider: listed and readable for the rider, who can reply', async () => {
    const sent = await sendMessage(
        { role: 'RESTAURANT', id: ids.restaurant },
        { orderId: ids.order, peerRole: 'DELIVERY_PARTNER', text: 'Order is packed' },
    );
    const rider = { role: 'DELIVERY_PARTNER', id: ids.rider };

    const { conversations } = await listConversations(rider, { orderId: ids.order });
    const thread = conversations.find((c) => c.peer?.role === 'RESTAURANT');
    assert.ok(thread, 'the restaurant thread is in the rider inbox');
    assert.equal(thread.conversationId, sent.conversationId);
    assert.equal(thread.unread, 1);

    const history = await getHistory(rider, { conversationId: sent.conversationId });
    assert.equal(history.messages.at(-1).text, 'Order is packed');

    const reply = await sendMessage(rider, { orderId: ids.order, peerRole: 'RESTAURANT', text: 'Coming' });
    assert.equal(reply.conversationId, sent.conversationId);
});
