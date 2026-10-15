# Native automation runtime

The supported runtime is the native TypeScript API plus BullMQ worker, PostgreSQL, Redis, and object storage. n8n is not provisioned, required, or reachable by the application.

The original n8n/Airtable/ManyChat/Buffer/Apify proposal remains historical source material only. It is not an implementation dependency. Native workflow readiness, enable/disable, scheduling, approvals, publishing, provider calls, retries, and usage recording are owned by the API and worker modules.

The database retains legacy n8n-named columns and the `N8N` execution enum for backward-compatible reads of old records. New records must use native workflow state and `VIDEO_WORKER` or `CONTROL_CENTER` execution sources. A future cleanup migration may remove legacy columns only after a production data-retention decision and a verified backup.

## Verification

- API typecheck/build: `cd api && npm run typecheck && npm run build`
- Web typecheck/build: `cd web && npm run typecheck && npm run build`
- Local Compose topology: `docker compose -f docker/docker-compose.yml config`
- Railway deployment: `node scripts/railway-deploy.mjs --skip-n8n --no-smoke`

The current Railway environment has no n8n service. Provider credentials, customer social accounts, marketplace activation contract details, and staging smoke tests remain external launch prerequisites.
