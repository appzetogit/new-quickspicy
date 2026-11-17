/**
 * Language for customer-facing text: English (default) and Telugu.
 *
 * Read from `?lang=` only, never from Accept-Language. The public endpoints are
 * cached by URL (middleware/cache.js), so a language chosen by a header would be
 * cached under the plain URL and served to everyone after the first Telugu
 * reader. The apps send `?lang=te` (from the user's preferredLanguage).
 *
 * Telugu text lives beside the English in `nameTe` / `descriptionTe`. Empty
 * means not translated yet, and the English is used instead.
 */
export const SUPPORTED_LANGUAGES = Object.freeze(['en', 'te']);
export const DEFAULT_LANGUAGE = 'en';

/** "te", "TE", "te-IN" -> "te"; anything unsupported -> null. */
export const normalizeLanguage = (value) => {
    const code = String(value ?? '').trim().toLowerCase().split(/[-_]/)[0];
    return SUPPORTED_LANGUAGES.includes(code) ? code : null;
};

/** The language a request asks for, from `?lang=`; English otherwise. */
export const languageFromQuery = (query = {}) => normalizeLanguage(query?.lang) || DEFAULT_LANGUAGE;

/** The Telugu text when asked for and present, otherwise the English. */
export const pickText = (english, telugu, lang) => {
    if (lang === 'te' && String(telugu ?? '').trim()) return String(telugu);
    return english;
};

/**
 * A row with `name` (and `description`, when it has one) in the requested
 * language. The originals stay available as `nameEn` / `descriptionEn`, and
 * `nameTe` is kept so an app can show both.
 */
export const localizeRow = (row, lang) => {
    if (!row || typeof row !== 'object') return row;
    const out = { ...row, nameEn: row.name, name: pickText(row.name, row.nameTe, lang) };
    if (row.description !== undefined) {
        out.descriptionEn = row.description;
        out.description = pickText(row.description, row.descriptionTe, lang);
    }
    return out;
};
