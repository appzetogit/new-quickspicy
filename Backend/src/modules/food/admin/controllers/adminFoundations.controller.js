import * as verticals from '../services/adminVertical.service.js';
import * as cohorts from '../services/adminRiderCohort.service.js';
import * as translations from '../services/adminTranslation.service.js';
import * as outlets from '../../restaurant/services/outlets.service.js';
import { languageFromQuery } from '../../shared/language.js';
import * as statements from '../services/payoutStatement.service.js';
import { renderStatementPdf } from '../services/payoutStatementPdf.js';
import * as riderDocs from '../../delivery/services/riderDocuments.service.js';
import * as platformSettings from '../services/platformSettings.service.js';
import * as adminTools from '../services/adminTools.service.js';
import { listStoredFiles } from '../../../../services/storage.service.js';

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

// ----- Outlets of one brand -----
export const linkOutlets = handle(200, 'Outlets linked', (req) => outlets.linkOutlets(req.params.id, req.body || {}));
export const unlinkOutlet = handle(200, 'Outlet unlinked', (req) => outlets.unlinkOutlet(req.params.id));

// ----- Translations -----
export const listTranslations = handle(200, 'Translations fetched', (req) => translations.listTranslations(req.query));
export const updateTranslation = handle(200, 'Translation saved',
    (req) => translations.updateTranslation(req.params.entity, req.params.id, req.body || {}));
export const bulkUpdateTranslations = handle(200, 'Translations saved',
    (req) => translations.bulkUpdateTranslations(req.body || {}));

// ----- Phase 3: payout statements and rider documents -----

const adminIdOf = (req) => req.user?.userId || null;

/** Sends a statement as a PDF download (or inline with ?inline=1). */
const sendStatementPdf = (load) => async (req, res, next) => {
    try {
        const statement = await load(req);
        const pdf = await renderStatementPdf(statement);
        const name = `quickspicy-${statement.entityType}-statement-${statement.weekKey}.pdf`;
        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${name}"`);
        // A payslip is personal; no shared cache should keep it.
        res.set('Cache-Control', 'private, no-store');
        return res.status(200).send(pdf);
    } catch (error) {
        return next(error);
    }
};

// Admin
export const listPayoutStatements = handle(200, 'Statements fetched', (req) => statements.listStatements(req.query));
export const generatePayoutStatements = handle(200, 'Statements generated',
    (req) => statements.generateWeeklyStatements(req.body || {}));
export const getPayoutStatement = handle(200, 'Statement fetched', (req) => statements.getStatement(req.params.id));
export const adjustPayoutStatement = handle(200, 'Statement adjusted',
    (req) => statements.adjustStatement(req.params.id, req.body || {}));
export const approvePayoutStatement = handle(200, 'Statement approved',
    (req) => statements.approveStatement(req.params.id, adminIdOf(req)));
export const markPayoutStatementPaid = handle(200, 'Statement marked paid',
    (req) => statements.markStatementPaid(req.params.id, req.body || {}, adminIdOf(req)));
export const voidPayoutStatement = handle(200, 'Statement voided',
    (req) => statements.voidStatement(req.params.id, req.body || {}));
export const payoutStatementPdf = sendStatementPdf((req) => statements.getStatement(req.params.id));

// Rider / restaurant: their own
const ownType = (req) => (req.user?.role === 'RESTAURANT' ? 'restaurant' : 'rider');
export const listOwnPayoutStatements = handle(200, 'Statements fetched',
    (req) => statements.listOwnStatements(ownType(req), req.user?.userId, req.query));
export const getOwnPayoutStatement = handle(200, 'Statement fetched',
    (req) => statements.getOwnStatement(ownType(req), req.user?.userId, req.params.id));
export const ownPayoutStatementPdf = sendStatementPdf(
    (req) => statements.getOwnStatement(ownType(req), req.user?.userId, req.params.id));

// Rider documents
export const getRiderDocuments = handle(200, 'Documents fetched', (req) => riderDocs.getRiderDocuments(req.params.id));
export const reviewRiderDocument = handle(200, 'Document reviewed',
    (req) => riderDocs.reviewRiderDocument(req.params.id, req.params.key, req.body || {}, adminIdOf(req)));
export const getOwnDocuments = handle(200, 'Documents fetched', (req) => riderDocs.getOwnDocuments(req.user?.userId));
export const reuploadOwnDocument = handle(200, 'Document uploaded', (req) => riderDocs.reuploadOwnDocument(
    req.user?.userId, req.params.key, req.file || req.files?.[0], { number: req.body?.number }));

// ----- Settings pages, reports and tools that used to be UI-only -----
export const getPlatformSetting = handle(200, 'Settings fetched', (req) => platformSettings.getPlatformSetting(req.params.key));
export const savePlatformSetting = handle(200, 'Settings saved', (req) => platformSettings.savePlatformSetting(req.params.key, req.body?.value ?? req.body ?? {}, adminIdOf(req)));
export const getPublicPlatformSettings = handle(200, 'Settings fetched', () => platformSettings.getPublicPlatformSettings());
export const couponOrderReport = handle(200, 'Report fetched', (req) => adminTools.couponOrderReport(req.query));
export const customerRewardsReport = handle(200, 'Report fetched', (req) => adminTools.customerRewardsReport(req.query));
export const creditCustomerWallet = handle(200, 'Money added to the wallet', (req) => adminTools.creditCustomerWallet(req.params.id, req.body || {}, adminIdOf(req)));
export const listCustomerWalletCredits = handle(200, 'Credits fetched', (req) => adminTools.listCustomerWalletCredits(req.query));
export const bulkImportRestaurants = handle(200, (d) => `${d.created} created, ${d.failed} not created`, (req) => adminTools.bulkImportRestaurants(req.body?.rows));
export const listFiles = handle(200, 'Files fetched', (req) => listStoredFiles(String(req.query.folder || ''), { limit: req.query.limit }));
