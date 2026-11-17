/**
 * Demo data for a fresh Quick Spicy test database: one delivery zone covering
 * Markapuram and Cumbum (Andhra Pradesh), home categories, six approved
 * restaurants with menus, three home banners and one approved demo rider.
 *
 * Every image is a file the web app already serves (Frontend/public/landing),
 * addressed through FRONTEND_URL, so nothing is uploaded.
 *
 * Builds restaurants through the application's own deriveRestaurantFields and
 * fromRestaurantLocation (see seed-demo-restaurant.mjs for why), and is
 * idempotent: zone and city by name, categories by name, restaurants on the
 * name+phone unique pair, dishes by restaurant+name, banners by publicId,
 * rider by phone.
 *
 *   node scripts/seed-quick-spicy-demo.mjs
 *
 * Demo logins (staging only, where every OTP is 1234): restaurant owners use
 * the restaurant phones below, the rider uses RIDER_PHONE.
 */
import 'dotenv/config';
import { prisma } from '../src/config/prisma.js';
import { deriveRestaurantFields, fromRestaurantLocation } from '../src/modules/food/restaurant/restaurant.mapper.js';
import { invalidateActiveZonesCache } from '../src/modules/food/landing/controllers/zonePublic.controller.js';
import { invalidateCache } from '../src/middleware/cache.js';

if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo data into a production deployment.');
    process.exit(1);
}

const WEB = String(process.env.FRONTEND_URL || 'https://new.quickspicy.in').replace(/\/+$/, '');
const img = (file) => `${WEB}/landing/${file}`;
const PHOTO = {
    biryani: img('biryani.webp'),
    chicken65: img('chicken-65.webp'),
    paneer: img('paneer-tikka.webp'),
    manchurian: img('manchurian.webp'),
    fishCurry: img('fish-curry.webp'),
    friedRice: img('fried-rice.webp'),
    kulcha: img('kulcha.webp'),
    prawns: img('prawns-biryani.webp'),
    mutton: img('mutton-biryani.webp'),
    vegBiryani: img('veg-biryani.webp'),
};

// ---- city and zone ------------------------------------------------------------
const city = await prisma.foodCity.upsert({
    where: { nameKey: 'markapuram' },
    create: { name: 'Markapuram', nameKey: 'markapuram', state: 'Andhra Pradesh' },
    update: {},
});

// A loose box around both towns; the admin panel can redraw it.
const RING = [
    { latitude: 15.90, longitude: 78.95 },
    { latitude: 15.90, longitude: 79.45 },
    { latitude: 15.45, longitude: 79.45 },
    { latitude: 15.45, longitude: 78.95 },
];
const zoneData = {
    name: 'Markapuram & Cumbum',
    zoneName: 'Markapuram & Cumbum',
    serviceLocation: 'Markapuram, Cumbum',
    country: 'India',
    city: city.name,
    cityId: city.id,
    unit: 'kilometer',
    coordinates: RING,
    isActive: true,
};
const existingZone = await prisma.foodZone.findFirst({ where: { name: zoneData.name } });
const zone = existingZone
    ? await prisma.foodZone.update({ where: { id: existingZone.id }, data: zoneData })
    : await prisma.foodZone.create({ data: zoneData });
console.log(`zone: ${zone.name} (${zone.id})`);

// ---- home categories (global: no zone, no restaurant) ---------------------------
const CATEGORY_DEFS = [
    ['Biryani', PHOTO.biryani, 'Both'],
    ['Starters', PHOTO.chicken65, 'Both'],
    ['Chinese', PHOTO.friedRice, 'Both'],
    ['North Indian', PHOTO.paneer, 'Both'],
    ['South Indian', PHOTO.fishCurry, 'Both'],
    ['Breads', PHOTO.kulcha, 'Veg'],
];
const C = {};
for (const [i, [name, image, foodTypeScope]] of CATEGORY_DEFS.entries()) {
    const found = await prisma.foodCategory.findFirst({ where: { name, restaurantId: null, zoneId: null } });
    const data = { name, image, foodTypeScope, isApproved: true, approvalStatus: 'approved', isActive: true, sortOrder: i };
    C[name] = found
        ? await prisma.foodCategory.update({ where: { id: found.id }, data })
        : await prisma.foodCategory.create({ data });
}
console.log('categories:', Object.keys(C).join(', '));

// ---- restaurants ------------------------------------------------------------------
const RESTAURANTS = [
    {
        name: 'Spicy Andhra Mess', phone: '9000033001', lat: 15.7372, lng: 79.2705,
        area: 'Main Bazaar', town: 'Markapuram', pincode: '523316', address: '14 Main Bazaar Road',
        cuisines: ['Andhra', 'South Indian'], veg: false, eta: '25-30 mins', rating: 4.4, ratings: 86,
        cover: PHOTO.fishCurry,
        menu: [
            ['Andhra Chicken Biryani', 220, 'NonVeg', 'Biryani', PHOTO.biryani],
            ['Chicken 65', 180, 'NonVeg', 'Starters', PHOTO.chicken65],
            ['Fish Curry Meals', 190, 'NonVeg', 'South Indian', PHOTO.fishCurry],
            ['Veg Biryani', 150, 'Veg', 'Biryani', PHOTO.vegBiryani],
        ],
    },
    {
        name: 'Markapur Biryani Point', phone: '9000033002', lat: 15.7330, lng: 79.2660,
        area: 'Station Road', town: 'Markapuram', pincode: '523316', address: '3 Station Road',
        cuisines: ['Biryani', 'Mughlai'], veg: false, eta: '30-35 mins', rating: 4.5, ratings: 142,
        cover: PHOTO.mutton,
        menu: [
            ['Chicken Dum Biryani', 230, 'NonVeg', 'Biryani', PHOTO.biryani],
            ['Mutton Biryani', 320, 'NonVeg', 'Biryani', PHOTO.mutton],
            ['Prawns Biryani', 300, 'NonVeg', 'Biryani', PHOTO.prawns],
            ['Paneer Tikka Masala', 210, 'Veg', 'North Indian', PHOTO.paneer],
            ['Butter Kulcha', 50, 'Veg', 'Breads', PHOTO.kulcha],
        ],
    },
    {
        name: 'Royal Chinese Corner', phone: '9000033003', lat: 15.7400, lng: 79.2750,
        area: 'Gandhi Nagar', town: 'Markapuram', pincode: '523316', address: '21 Gandhi Nagar',
        cuisines: ['Chinese', 'Fast Food'], veg: false, eta: '20-25 mins', rating: 4.2, ratings: 64,
        cover: PHOTO.manchurian,
        menu: [
            ['Chicken Fried Rice', 170, 'NonVeg', 'Chinese', PHOTO.friedRice],
            ['Mushroom Manchurian', 160, 'Veg', 'Chinese', PHOTO.manchurian],
            ['Veg Fried Rice', 140, 'Veg', 'Chinese', PHOTO.friedRice],
            ['Chilli Chicken 65', 190, 'NonVeg', 'Starters', PHOTO.chicken65],
        ],
    },
    {
        name: 'Sri Sai Veg Tiffins', phone: '9000033004', lat: 15.7310, lng: 79.2720,
        area: 'Temple Street', town: 'Markapuram', pincode: '523316', address: '8 Temple Street',
        cuisines: ['South Indian', 'North Indian'], veg: true, eta: '15-20 mins', rating: 4.6, ratings: 118,
        cover: PHOTO.paneer,
        menu: [
            ['Paneer Tikka Masala', 190, 'Veg', 'North Indian', PHOTO.paneer],
            ['Masala Kulcha', 70, 'Veg', 'Breads', PHOTO.kulcha],
            ['Veg Biryani', 140, 'Veg', 'Biryani', PHOTO.vegBiryani],
            ['Mushroom Manchurian', 150, 'Veg', 'Chinese', PHOTO.manchurian],
        ],
    },
    {
        name: 'Cumbum Dum Biryani', phone: '9000033005', lat: 15.5822, lng: 79.1105,
        area: 'Bus Stand Road', town: 'Cumbum', pincode: '523333', address: '5 Bus Stand Road',
        cuisines: ['Biryani', 'Andhra'], veg: false, eta: '25-30 mins', rating: 4.3, ratings: 77,
        cover: PHOTO.biryani,
        menu: [
            ['Chicken Dum Biryani', 210, 'NonVeg', 'Biryani', PHOTO.biryani],
            ['Mutton Biryani', 300, 'NonVeg', 'Biryani', PHOTO.mutton],
            ['Chicken 65', 170, 'NonVeg', 'Starters', PHOTO.chicken65],
            ['Veg Biryani', 140, 'Veg', 'Biryani', PHOTO.vegBiryani],
        ],
    },
    {
        name: 'Lake View Family Restaurant', phone: '9000033006', lat: 15.5790, lng: 79.1140,
        area: 'Lake Road', town: 'Cumbum', pincode: '523333', address: '2 Lake Road',
        cuisines: ['South Indian', 'Chinese', 'North Indian'], veg: false, eta: '30-35 mins', rating: 4.1, ratings: 53,
        cover: PHOTO.prawns,
        menu: [
            ['Kerala Fish Curry', 220, 'NonVeg', 'South Indian', PHOTO.fishCurry],
            ['Prawns Biryani', 290, 'NonVeg', 'Biryani', PHOTO.prawns],
            ['Chicken Fried Rice', 160, 'NonVeg', 'Chinese', PHOTO.friedRice],
            ['Paneer Tikka Masala', 200, 'Veg', 'North Indian', PHOTO.paneer],
            ['Butter Kulcha', 45, 'Veg', 'Breads', PHOTO.kulcha],
        ],
    },
];

let items = 0;
for (const r of RESTAURANTS) {
    const derived = deriveRestaurantFields({ restaurantName: r.name, ownerPhone: r.phone, estimatedDeliveryTime: r.eta });
    const location = fromRestaurantLocation({
        latitude: r.lat,
        longitude: r.lng,
        formattedAddress: `${r.address}, ${r.area}, ${r.town}, Andhra Pradesh ${r.pincode}`,
        addressLine1: r.address,
        area: r.area,
        city: r.town,
        state: 'Andhra Pradesh',
        pincode: r.pincode,
    });
    const data = {
        restaurantName: r.name,
        ownerName: `${r.name} Owner`,
        ownerEmail: `owner.${r.phone}@quickspicy.in`,
        ownerPhone: r.phone,
        primaryContactNumber: r.phone,
        ...derived,
        ...location,
        zoneId: zone.id,
        deliveryRadiusKm: 25,
        cuisines: r.cuisines,
        openingTime: '00:00',
        closingTime: '23:59',
        openDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        pureVegRestaurant: r.veg,
        isAcceptingOrders: true,
        estimatedDeliveryTime: r.eta,
        featuredDish: r.menu[0][0],
        featuredPrice: r.menu[0][1],
        rating: r.rating,
        totalRatings: r.ratings,
        profileImage: r.menu[0][4],
        coverImages: [r.cover, r.menu[1][4]],
        status: 'approved',
        approvedAt: new Date(),
    };
    const restaurant = await prisma.foodRestaurant.upsert({
        where: {
            restaurantNameNormalized_ownerPhoneLast10: {
                restaurantNameNormalized: derived.restaurantNameNormalized,
                ownerPhoneLast10: derived.ownerPhoneLast10,
            },
        },
        create: data,
        update: data,
    });

    for (const [dish, price, foodType, cat, image] of r.menu) {
        const category = C[cat];
        const payload = {
            restaurantId: restaurant.id,
            name: dish,
            price,
            foodType,
            categoryId: category?.id || null,
            categoryName: category?.name || '',
            image,
            images: [image],
            isAvailable: true,
            approvalStatus: 'approved',
        };
        const found = await prisma.foodItem.findFirst({ where: { restaurantId: restaurant.id, name: dish } });
        if (found) await prisma.foodItem.update({ where: { id: found.id }, data: payload });
        else await prisma.foodItem.create({ data: payload });
        items += 1;
    }

    const [inside] = await prisma.$queryRaw`
        SELECT ST_Contains(z.boundary::geometry, ST_SetSRID(ST_MakePoint(${r.lng}, ${r.lat}), 4326)) AS inside
        FROM food_zones z WHERE z.id = ${zone.id}`;
    console.log(`restaurant: ${r.name} (${r.town}) phone=${r.phone} inZone=${inside?.inside} dishes=${r.menu.length}`);
}
console.log(`menu items: ${items}`);

// ---- home banners -------------------------------------------------------------------
const BANNERS = [
    ['seed/banner-biryani', img('banners/banner-biryani.webp'), 'Biryani, hot & quick'],
    ['seed/banner-starters', img('banners/banner-starters.webp'), 'Spicy starters'],
    ['seed/banner-pay', img('banners/banner-pay.webp'), 'Pay online or in cash'],
];
for (const [i, [publicId, imageUrl, title]] of BANNERS.entries()) {
    const found = await prisma.foodHeroBanner.findFirst({ where: { publicId } });
    const data = { publicId, imageUrl, title, sortOrder: i, isActive: true, zoneId: null };
    if (found) await prisma.foodHeroBanner.update({ where: { id: found.id }, data });
    else await prisma.foodHeroBanner.create({ data });
}
console.log(`hero banners: ${BANNERS.length}`);

// ---- demo rider -----------------------------------------------------------------------
const RIDER_PHONE = '9000044001';
const riderData = {
    name: 'Demo Rider',
    phone: RIDER_PHONE,
    city: 'Markapuram',
    state: 'Andhra Pradesh',
    zoneId: zone.id,
    vehicleType: 'bike',
    vehicleName: 'Honda Activa',
    vehicleNumber: 'AP39 QS 0001',
    status: 'approved',
    approvedAt: new Date(),
};
const rider = await prisma.foodDeliveryPartner.upsert({
    where: { phone: RIDER_PHONE },
    create: riderData,
    update: riderData,
});
console.log(`rider: ${rider.name} phone=${rider.phone} status=${rider.status}`);

await invalidateActiveZonesCache().catch(() => {});
for (const key of ['restaurants:*', 'restaurant_detail:*', 'categories*', 'hero*', 'landing*']) {
    await invalidateCache(key).catch(() => {});
}
await prisma.$disconnect();
process.exit(0);
