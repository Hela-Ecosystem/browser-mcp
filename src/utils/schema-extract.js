'use strict';

/**
 * Structured-data-first schema extraction.
 *
 * Runs inside the page, so it must be self-contained. Sources are consulted in
 * order of reliability:
 *   1. JSON-LD (`application/ld+json`)
 *   2. itemprop microdata
 *   3. HTML tables (header/value and label/value shapes)
 *   4. the original keyword heuristic, only for properties none of the above
 *      could resolve.
 *
 * Returning the wrong element confidently is worse than returning null, so a
 * structured match needs an exact key token (or a strong prefix match).
 */

function extractSchemaInPage({ scopeSelector, schemaProps }) {
    const root = (scopeSelector && document.querySelector(scopeSelector)) || document.body || document.documentElement;
    const entries = [];

    function addEntry(source, path, value, entityType) {
        if (value === null || value === undefined) return;
        const text = typeof value === 'string' ? value.trim() : value;
        if (text === '') return;
        const keyPath = path.map(part => String(part).toLowerCase());
        entries.push({
            source,
            key: keyPath[keyPath.length - 1] || '',
            path: keyPath,
            value: text,
            entityType: entityType ? String(entityType).toLowerCase() : undefined,
        });
    }

    function walkJsonLd(value, path, entityType) {
        if (Array.isArray(value)) {
            value.forEach(item => walkJsonLd(item, path, entityType));
            return;
        }
        if (!value || typeof value !== 'object') return;

        const type = typeof value['@type'] === 'string' ? value['@type'] : entityType;
        for (const key of Object.keys(value)) {
            if (key === '@context') continue;
            // @graph is a container of entities, not an annotation to discard.
            if (key.charAt(0) === '@' && key !== '@graph') continue;
            const child = value[key];
            if (child && typeof child === 'object') {
                walkJsonLd(child, path.concat(key), type);
            } else {
                addEntry('jsonld', path.concat(key), child, type);
            }
        }
    }

    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
        try {
            walkJsonLd(JSON.parse(script.textContent || 'null'), [], undefined);
        } catch (_) {
            // One malformed block must not disable the others.
        }
    });

    // Microdata: the value lives in content/datetime/value/src/href before text.
    root.querySelectorAll('[itemprop]').forEach(el => {
        const prop = el.getAttribute('itemprop');
        if (!prop) return;
        const scope = el.closest('[itemtype]');
        const entityType = scope ? scope.getAttribute('itemtype') : undefined;
        const value = el.getAttribute('content')
            || el.getAttribute('datetime')
            || el.getAttribute('value')
            || (el.tagName === 'IMG' ? (el.getAttribute('src') || el.getAttribute('alt')) : null)
            || (el.tagName === 'A' ? el.href : null)
            || (el.tagName === 'META' ? el.getAttribute('content') : null)
            || el.innerText;
        addEntry('microdata', [prop], value, entityType);
    });

    // Tables: support both header/value tables and two-column label/value tables.
    root.querySelectorAll('table').forEach(table => {
        let headers = [];
        Array.from(table.querySelectorAll('tr')).forEach(row => {
            const cells = Array.from(row.querySelectorAll('th,td'));
            if (!cells.length) return;
            const texts = cells.map(cell => (cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim());
            const headerRow = cells.every(cell => cell.tagName === 'TH');
            if (headerRow) {
                if (!headers.length) headers = texts.map(text => text.toLowerCase());
                return;
            }
            headers.forEach((header, index) => {
                if (header && texts[index]) addEntry('table', [header], texts[index]);
            });
            if (cells.length >= 2 && texts[0]) {
                addEntry('table', [texts[0].toLowerCase()], texts[1]);
            }
        });
    });

    const SYNONYMS = {
        qty: ['quantity'],
        quantity: ['qty'],
        cost: ['price'],
        amount: ['price'],
        price: ['cost', 'amount'],
        title: ['name', 'headline'],
        headline: ['name', 'title'],
        name: ['title'],
    };
    const SOURCE_RANK = { jsonld: 3, microdata: 2, table: 1 };
    const normalise = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');

    function tokensFor(name, definition) {
        const description = definition && definition.description ? String(definition.description) : '';
        const words = `${String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2')} ${description}`
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(word => word.length > 1);
        const expanded = [];
        words.forEach(word => {
            expanded.push(word);
            (SYNONYMS[word] || []).forEach(synonym => expanded.push(synonym));
        });
        return Array.from(new Set(expanded));
    }

    function scoreEntry(entry, tokens) {
        const keys = [entry.key].concat(entry.path).map(normalise).filter(Boolean);
        let score = 0;
        let matched = 0;
        let exact = false;
        for (const token of tokens) {
            const wanted = normalise(token);
            if (!wanted) continue;
            if (keys.indexOf(wanted) !== -1) {
                score += 6;
                matched++;
                exact = true;
            } else if (keys.some(key => key.length > 2 && wanted.length > 2 && (key.startsWith(wanted) || wanted.startsWith(key)))) {
                score += 2;
                matched++;
            }
        }
        if (entry.entityType && tokens.map(normalise).indexOf(normalise(entry.entityType)) !== -1) score += 3;
        score += SOURCE_RANK[entry.source] || 0;
        return { score, matched, exact };
    }

    function bestEntry(tokens) {
        let best = null;
        for (const entry of entries) {
            const scored = scoreEntry(entry, tokens);
            if (!scored.matched) continue;
            if (!scored.exact && scored.score < 4) continue;
            if (!best
                || scored.score > best.score
                || (scored.score === best.score && scored.matched > best.matched)) {
                best = { ...scored, entry };
            }
        }
        return best ? best.entry : null;
    }

    function coerce(value, definition) {
        const type = (definition && definition.type) || 'string';
        if (type === 'number' || type === 'integer') {
            if (typeof value === 'number') return value;
            const cleaned = String(value).replace(/[^0-9.,-]/g, '');
            const numeric = Number.parseFloat(cleaned.indexOf(',') > -1 && cleaned.indexOf('.') === -1
                ? cleaned.replace(',', '.')
                : cleaned.replace(/,/g, ''));
            return Number.isFinite(numeric) ? numeric : null;
        }
        if (type === 'boolean') {
            if (typeof value === 'boolean') return value;
            return /^(true|yes|1|on)$/i.test(String(value).trim());
        }
        if (type === 'array') return Array.isArray(value) ? value : [value];
        if (type === 'object') return value;
        return String(value);
    }

    // Last resort: the original keyword/selector heuristic for unmatched keys.
    function heuristic(key, definition) {
        const hint = String((definition && definition.description) || '').toLowerCase();
        const type = (definition && definition.type) || 'string';
        const candidates = [];
        if (hint.indexOf('price') !== -1 || hint.indexOf('cost') !== -1) {
            candidates.push('[class*="price"]', '[itemprop="price"]', '[data-price]', '[class*="amount"]');
        }
        if (hint.indexOf('heading') !== -1 || hint.indexOf('headline') !== -1) candidates.push('h1', 'h2');
        if (hint.indexOf('title') !== -1 || hint.indexOf('name') !== -1) {
            candidates.push('h1', 'h2', '[itemprop="name"]', '[class*="title"]');
        }
        if (hint.indexOf('description') !== -1) {
            candidates.push('[itemprop="description"]', '[class*="description"]', '[class*="summary"]', 'p');
        }
        if (hint.indexOf('image') !== -1 || hint.indexOf('img') !== -1) candidates.push('img[src]', '[itemprop="image"]');
        if (hint.indexOf('url') !== -1 || hint.indexOf('link') !== -1) candidates.push('a[href]', 'link[rel="canonical"]');
        if (hint.indexOf('rating') !== -1 || hint.indexOf('score') !== -1) {
            candidates.push('[itemprop="ratingValue"]', '[class*="rating"]', '[class*="score"]');
        }
        if (hint.indexOf('author') !== -1) candidates.push('[itemprop="author"]', '[class*="author"]', '[rel="author"]');
        if (hint.indexOf('date') !== -1) candidates.push('time[datetime]', '[itemprop="datePublished"]', '[class*="date"]');
        candidates.push(`[itemprop="${key}"]`, `[class*="${key}"]`, `[id*="${key}"]`, `[data-${key}]`);

        let found = null;
        for (const selector of candidates) {
            try {
                const el = root.querySelector(selector);
                if (el) { found = el; break; }
            } catch (_) {
                // Key may contain characters that are not valid in a selector.
            }
        }
        if (!found) return null;

        if (type === 'boolean') return true;
        if (type === 'array') {
            const selector = candidates[candidates.length - 1];
            try {
                return Array.from(root.querySelectorAll(selector)).map(el => el.innerText && el.innerText.trim()).filter(Boolean).slice(0, 20);
            } catch (_) {
                return [];
            }
        }
        const raw = found.getAttribute('content') || found.getAttribute('datetime')
            || found.getAttribute('data-price') || (found.innerText && found.innerText.trim())
            || found.getAttribute('src') || found.getAttribute('href') || null;
        if (raw === null) return null;
        return type === 'number' || type === 'integer' ? coerce(raw, definition) : (type === 'object' ? raw : String(raw));
    }

    const result = {};
    for (const key of Object.keys(schemaProps || {})) {
        const definition = schemaProps[key] || {};
        const tokens = tokensFor(key, definition);
        const type = definition.type || 'string';

        if (type === 'array') {
            const collected = [];
            for (const entry of entries) {
                const scored = scoreEntry(entry, tokens);
                if ((scored.exact || (scored.matched && scored.score >= 4)) && collected.indexOf(entry.value) === -1) {
                    collected.push(entry.value);
                }
            }
            if (collected.length) {
                result[key] = collected.slice(0, 20);
                continue;
            }
        } else {
            const entry = bestEntry(tokens);
            if (entry) {
                result[key] = coerce(entry.value, definition);
                continue;
            }
        }

        result[key] = heuristic(key, definition);
    }

    return result;
}

module.exports = { extractSchemaInPage };
