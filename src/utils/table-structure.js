'use strict';

/**
 * Shape extracted table rows for MCP output.
 *
 * `header` was advertised as "default true" in the schema, but JSON-Schema
 * defaults are not applied by the server, so the handler received `undefined`
 * and every call fell through to the flat branch (browser-mcp#20). Treating
 * only `false` as opt-out makes the documented default real.
 *
 * A first row is only consumed as headers when it actually is one (cells are
 * `<th>` or the row sits in `<thead>`); otherwise keying by the first data row
 * would silently delete a record.
 */
function structureTable(rows, { header = true, firstRowIsHeader = false } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return { table: [] };
    }
    if (header === false) {
        return { table: rows, headers: null };
    }
    if (!firstRowIsHeader) {
        return {
            table: rows,
            headers: null,
            note: 'No header row found (the first row has no <th> cells); rows are returned as arrays.',
        };
    }

    const [rawHeaders, ...body] = rows;
    const headers = rawHeaders.map((value, index) => {
        const name = String(value ?? '').trim();
        return name || `col${index}`;
    });
    // Duplicate column names would overwrite each other in the keyed form.
    const seen = new Map();
    const uniqueHeaders = headers.map((name) => {
        const count = seen.get(name) ?? 0;
        seen.set(name, count + 1);
        return count === 0 ? name : `${name}_${count + 1}`;
    });

    return {
        table: body.map((row) => {
            const record = {};
            uniqueHeaders.forEach((name, index) => {
                record[name] = row[index] ?? null;
            });
            return record;
        }),
        headers: uniqueHeaders,
    };
}

module.exports = { structureTable };
