# Google Sheets template

The database is one spreadsheet, **Eki Launch Database**, with **16 tabs**. The authoritative definition is [schemas/google-sheets-schema.md](schemas/google-sheets-schema.md) (human readable) and [schemas/sheet-columns.json](schemas/sheet-columns.json) (machine readable — the workflows, the staging mock and `tools/validate-workflows.js` all read it).

## Create it
1. New spreadsheet → name it **Eki Launch Database**.
2. For each file in [`sheet-templates/`](sheet-templates): *File → Import → Upload → "Insert new sheet(s)"* → rename the new tab to the exact tab name (`Leads`, `Waitlist`, `Referrals`, `Content Calendar`, `Content Drafts`, `Feedback`, `Analytics`, `Agent Reports`, `Intelligence`, `PainPoints`, `ContentQueue`, `SocialProof`, `Social Posts`, `Automation Logs`, `WhatsApp Conversations`, `PublishedContent`). The CSVs contain **only the header row on purpose** — sample rows with fake customers would be messaged or analysed if they reached production.
3. Populate `Content Calendar` days 1-30 from [content-strategy/30-day-content-calendar.md](content-strategy/30-day-content-calendar.md) after reviewing the claims in the captions.
4. Copy the spreadsheet id into `GOOGLE_SHEETS_ID`; share the sheet only with the people and the Google account used by the n8n credential.

## Regenerating the CSVs
`node tools/make-sheet-templates.js` rewrites `sheet-templates/*.csv` from `schemas/sheet-columns.json`. If you add a column: update `sheet-columns.json`, the schema doc, regenerate, add the column to the live sheet, then change the workflow generator/JSON and re-run `staging/`.

## Operational notes
- Google Sheets API allows ~60 write requests per minute per user; the loops in 05/06/19/08 write one lead at a time and each run is capped (`WA_MAX_PER_RUN`, 50 feedback emails).
- Sheets is not transactional: two workflows updating the same lead in the same second can overwrite each other's fields (each write is a read-merge-write of the full row). At the expected volume this is a low risk; for higher volume move the lead store to PostgreSQL (Railway already provides one).
- The `Leads` tab holds phone numbers and opt-in evidence; `WhatsApp Conversations` holds message text. Treat as personal data (retention, access, deletion requests).
