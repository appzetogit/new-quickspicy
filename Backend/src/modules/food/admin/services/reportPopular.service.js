import { Prisma } from '@prisma/client';
import { prisma } from '../../../../config/prisma.js';
import { getRestaurantTimezone } from '../../../../utils/timezone.js';
import { EARNED_ORDER } from '../../shared/restaurantPayout.sql.js';
import { fromFoodTypeColumn } from '../../shared/foodType.util.js';
import { num, reportFilters, zoneScopeSql, createdAtSql } from './reportFilters.helpers.js';

/**
 * Popular items & analytics: what sells, when orders come in, and where.
 *
 * Counts delivered orders only (EARNED_ORDER: delivered, and never a
 * cancelled one), placed inside the window -- the window and the hour of day
 * are both the time the order was placed, in India time.
 *
 * Item revenue is what the customer was charged for the line (unit price with
 * add-ons x quantity), before order-level discounts. Zone revenue is the order
 * total the customer paid.
 */

const orderWhereSql = ({ createdAt, zoneId, restaurantId }) => Prisma.sql`
    WHERE ${EARNED_ORDER}
      ${createdAtSql(createdAt)}
      ${zoneScopeSql(zoneId)}
      ${restaurantId ? Prisma.sql`AND o."restaurantId" = ${restaurantId}` : Prisma.empty}
`;

/** 24 IST hour buckets, 0..23, with every hour present. */
export const fillHours = (rows = []) => {
    const byHour = new Map(rows.map((r) => [Number(r.hour), r]));
    return Array.from({ length: 24 }, (_, hour) => ({
        hour,
        label: `${String(hour).padStart(2, '0')}:00`,
        orders: Number(byHour.get(hour)?.orders) || 0,
        revenue: num(byHour.get(hour)?.revenue),
    }));
};

export async function getPopularItemsReport(query = {}) {
    const filters = reportFilters(query);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const where = orderWhereSql(filters);
    const tz = getRestaurantTimezone();

    const [totalsRows, itemRows, hourRows, zoneRows] = await Promise.all([
        prisma.$queryRaw`
            SELECT COUNT(*)::int                    AS "orders",
                   COALESCE(SUM(o."total"), 0)      AS "revenue",
                   COUNT(DISTINCT o."restaurantId")::int AS "restaurants"
            FROM "food_orders" o
            ${where}
        `,
        prisma.$queryRaw`
            SELECT i."itemId"                                  AS "itemId",
                   o."restaurantId"                            AS "restaurantId",
                   MAX(i."name")                               AS "name",
                   BOOL_AND(i."isVeg")                         AS "isVeg",
                   -- The latest recorded diet (Veg / Egg / Non-Veg), so Egg is not shown as non-veg.
                   (ARRAY_AGG(i."foodType"::text ORDER BY o."createdAt" DESC)
                       FILTER (WHERE i."foodType" IS NOT NULL))[1] AS "foodType",
                   SUM(i."quantity")::int                      AS "quantity",
                   COALESCE(SUM(i."price" * i."quantity"), 0)  AS "revenue",
                   COUNT(DISTINCT o."id")::int                 AS "orders"
            FROM "food_order_items" i
            JOIN "food_orders" o ON o."id" = i."orderId"
            ${where}
            GROUP BY i."itemId", o."restaurantId"
            ORDER BY "quantity" DESC, "revenue" DESC
            LIMIT ${limit}
        `,
        prisma.$queryRaw`
            SELECT EXTRACT(HOUR FROM ((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}))::int AS "hour",
                   COUNT(*)::int                AS "orders",
                   COALESCE(SUM(o."total"), 0)  AS "revenue"
            FROM "food_orders" o
            ${where}
            GROUP BY 1
        `,
        prisma.$queryRaw`
            SELECT o."zoneId"                   AS "zoneId",
                   COUNT(*)::int                AS "orders",
                   COALESCE(SUM(o."total"), 0)  AS "revenue",
                   COUNT(DISTINCT o."restaurantId")::int AS "restaurants"
            FROM "food_orders" o
            ${where}
            GROUP BY o."zoneId"
            ORDER BY "orders" DESC
        `,
    ]);

    const [itemsTotal] = await prisma.$queryRaw`
        SELECT COALESCE(SUM(i."quantity"), 0)::int AS "quantity"
        FROM "food_order_items" i
        JOIN "food_orders" o ON o."id" = i."orderId"
        ${where}
    `;

    const restaurantIds = [...new Set(itemRows.map((r) => r.restaurantId))];
    const zoneIds = zoneRows.map((r) => r.zoneId).filter(Boolean);
    const [restaurants, zones] = await Promise.all([
        restaurantIds.length
            ? prisma.foodRestaurant.findMany({ where: { id: { in: restaurantIds } }, select: { id: true, restaurantName: true } })
            : [],
        zoneIds.length
            ? prisma.foodZone.findMany({ where: { id: { in: zoneIds } }, select: { id: true, name: true, zoneName: true } })
            : [],
    ]);
    const restaurantName = new Map(restaurants.map((r) => [r.id, r.restaurantName]));
    const zoneName = new Map(zones.map((z) => [z.id, z.zoneName || z.name]));

    const totals = totalsRows[0] || {};
    const totalOrders = Number(totals.orders) || 0;
    const totalRevenue = num(totals.revenue);
    const hours = fillHours(hourRows);
    const peak = hours.reduce((best, h) => (h.orders > best.orders ? h : best), { orders: 0, hour: null, label: '' });

    return {
        summary: {
            deliveredOrders: totalOrders,
            revenue: totalRevenue,
            averageOrderValue: totalOrders ? num(totalRevenue / totalOrders) : 0,
            itemsSold: Number(itemsTotal?.quantity) || 0,
            restaurants: Number(totals.restaurants) || 0,
            peakHour: peak.hour === null ? null : { hour: peak.hour, label: peak.label, orders: peak.orders },
            topZone: zoneRows[0]
                ? { zoneId: zoneRows[0].zoneId, name: zoneName.get(zoneRows[0].zoneId) || 'No zone', orders: zoneRows[0].orders }
                : null,
        },
        topItems: itemRows.map((r, index) => ({
            rank: index + 1,
            itemId: r.itemId,
            name: r.name,
            isVeg: Boolean(r.isVeg),
            // 'Veg' | 'Egg' | 'Non-Veg'
            foodType: r.foodType ? fromFoodTypeColumn(r.foodType) : r.isVeg ? 'Veg' : 'Non-Veg',
            restaurantId: r.restaurantId,
            restaurantName: restaurantName.get(r.restaurantId) || 'Unknown restaurant',
            quantity: Number(r.quantity) || 0,
            revenue: num(r.revenue),
            orders: Number(r.orders) || 0,
        })),
        peakHours: hours,
        zones: zoneRows.map((r) => ({
            zoneId: r.zoneId,
            name: r.zoneId ? (zoneName.get(r.zoneId) || 'Unknown zone') : 'No zone',
            orders: Number(r.orders) || 0,
            revenue: num(r.revenue),
            restaurants: Number(r.restaurants) || 0,
            averageOrderValue: r.orders ? num(num(r.revenue) / r.orders) : 0,
            share: totalOrders ? Math.round((Number(r.orders) / totalOrders) * 1000) / 10 : 0,
        })),
        definitions: {
            orders: 'Delivered orders only, by the time they were placed (India time).',
            itemRevenue: 'Line price (with add-ons) x quantity, before order discounts.',
            zoneRevenue: 'Order total the customer paid.',
        },
    };
}
