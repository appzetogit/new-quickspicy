import express from 'express';
import { searchController, listAdminCategoriesController } from '../controllers/search.controller.js';
import { cacheResponse } from '../../../../middleware/cache.js';
import { searchDishesController, suggestController } from '../controllers/dishSearch.controller.js';

const router = express.Router();

/**
 * Unified Search Endpoint
 * GET /api/v1/food/search/unified
 */
router.get('/unified', cacheResponse(120, 'search_unified', { browserTtlSeconds: 30 }), searchController);

/**
 * Dish-level search: every matching dish, at the customer's price, sortable by
 * price / rating / distance. GET /api/v1/food/search/dishes
 */
router.get('/dishes', cacheResponse(60, 'search_dishes', { browserTtlSeconds: 30 }), searchDishesController);

/** Type-ahead, from the 3rd character. GET /api/v1/food/search/suggest */
router.get('/suggest', cacheResponse(60, 'search_suggest', { browserTtlSeconds: 30 }), suggestController);

/**
 * Admin Categories Only Endpoint (to avoid restaurant-created ones as requested)
 * GET /api/v1/food/search/categories/admin
 */
router.get('/categories/admin', cacheResponse(1800, 'search_categories_admin', { browserTtlSeconds: 300 }), listAdminCategoriesController);

export default router;
