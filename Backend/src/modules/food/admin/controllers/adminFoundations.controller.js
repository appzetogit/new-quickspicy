import * as verticals from '../services/adminVertical.service.js';
import * as cohorts from '../services/adminRiderCohort.service.js';
import * as translations from '../services/adminTranslation.service.js';
import { languageFromQuery } from '../../shared/language.js';

/** Thin handlers: the same { success, message, data } envelope as the rest of /admin. */
const handle = (status, message, run) => async (req, res, next) => {
    try {
        const data = await run(req);
        const text = typeof message === 'function' ? message(data) : message;
        return res.status(status).json({ success: true, message: text, data });
    } catch (error) {
        return next(error);
    }
};

// ----- Verticals -----
export const listVerticals = handle(200, 'Verticals fetched', (req) => verticals.listVerticals(req.query));
export const createVertical = handle(201, 'Vertical created', (req) => verticals.createVertical(req.body || {}));
export const updateVertical = handle(200, 'Vertical updated', (req) => verticals.updateVertical(req.params.id, req.body || {}));
export const deleteVertical = handle(200, (d) => (d.deleted ? 'Vertical deleted' : 'Vertical switched off'),
    (req) => verticals.deleteVertical(req.params.id));
export const setRestaurantVerticals = handle(200, 'Restaurant verticals updated',
    (req) => verticals.setRestaurantVerticals(req.params.id, req.body || {}));
export const listPublicVerticals = handle(200, 'Verticals fetched',
    (req) => verticals.listPublicVerticals(languageFromQuery(req.query)));

// ----- Rider cohorts -----
export const listRiderCohorts = handle(200, 'Cohorts fetched', (req) => cohorts.listRiderCohorts(req.query));
export const createRiderCohort = handle(201, 'Cohort created', (req) => cohorts.createRiderCohort(req.body || {}));
export const updateRiderCohort = handle(200, 'Cohort updated', (req) => cohorts.updateRiderCohort(req.params.id, req.body || {}));
export const deleteRiderCohort = handle(200, 'Cohort deleted', (req) => cohorts.deleteRiderCohort(req.params.id));
export const addRidersToCohort = handle(200, 'Riders added to cohort',
    (req) => cohorts.addRidersToCohort(req.params.id, req.body || {}));
export const setRiderServiceArea = handle(200, 'Rider service area updated',
    (req) => cohorts.setRiderServiceArea(req.params.id, req.body || {}));
/** Rider app: the logged-in rider's own zones. */
export const getMyServiceArea = handle(200, 'Service area fetched', (req) => cohorts.getRiderServiceArea(req.user?.userId));

// ----- Translations -----
export const listTranslations = handle(200, 'Translations fetched', (req) => translations.listTranslations(req.query));
export const updateTranslation = handle(200, 'Translation saved',
    (req) => translations.updateTranslation(req.params.entity, req.params.id, req.body || {}));
export const bulkUpdateTranslations = handle(200, 'Translations saved',
    (req) => translations.bulkUpdateTranslations(req.body || {}));
