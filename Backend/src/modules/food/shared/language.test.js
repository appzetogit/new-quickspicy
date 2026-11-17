import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLanguage, languageFromQuery, pickText, localizeRow } from './language.js';

test('only English and Telugu are recognised; regional tags fold to the language', () => {
    assert.equal(normalizeLanguage('te'), 'te');
    assert.equal(normalizeLanguage('TE'), 'te');
    assert.equal(normalizeLanguage('te-IN'), 'te');
    assert.equal(normalizeLanguage('en_GB'), 'en');
    assert.equal(normalizeLanguage('hi'), null);
    assert.equal(normalizeLanguage(''), null);
    assert.equal(normalizeLanguage(undefined), null);
});

test('the language comes from ?lang= and defaults to English', () => {
    assert.equal(languageFromQuery({ lang: 'te' }), 'te');
    assert.equal(languageFromQuery({ lang: 'fr' }), 'en');
    assert.equal(languageFromQuery({}), 'en');
    assert.equal(languageFromQuery(undefined), 'en');
});

test('Telugu is used only when asked for and actually translated', () => {
    assert.equal(pickText('Biryani', 'బిర్యానీ', 'te'), 'బిర్యానీ');
    assert.equal(pickText('Biryani', 'బిర్యానీ', 'en'), 'Biryani');
    // Not translated yet: English, never an empty label.
    assert.equal(pickText('Biryani', '', 'te'), 'Biryani');
    assert.equal(pickText('Biryani', '   ', 'te'), 'Biryani');
    assert.equal(pickText('Biryani', null, 'te'), 'Biryani');
});

test('a localized row keeps the English beside the translation', () => {
    const row = { id: 'x', name: 'Biryani', nameTe: 'బిర్యానీ', description: 'Rice', descriptionTe: '' };
    const te = localizeRow(row, 'te');
    assert.equal(te.name, 'బిర్యానీ');
    assert.equal(te.nameEn, 'Biryani');
    // Description has no Telugu yet, so it stays English.
    assert.equal(te.description, 'Rice');
    assert.equal(te.descriptionEn, 'Rice');

    const noDescription = localizeRow({ name: 'Food', nameTe: 'ఆహారం' }, 'te');
    assert.equal('description' in noDescription, false);
});
