'use strict';
// Regenerates sheet-templates/*.csv (header row only) from schemas/sheet-columns.json.
// Header-only on purpose: sample rows with fake customers would be messaged/analysed if imported into production.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const cols = JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'sheet-columns.json'), 'utf8'));
const out = path.join(root, 'sheet-templates');
fs.mkdirSync(out, { recursive: true });
for (const [tab, headers] of Object.entries(cols)) {
  const file = tab.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.csv';
  fs.writeFileSync(path.join(out, file), headers.join(',') + '\n');
}
console.log(`wrote ${Object.keys(cols).length} header-only CSVs to sheet-templates/`);
