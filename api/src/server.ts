import "dotenv/config";
import { createApp } from "./app";
import { bootstrapAdmin } from "./modules/auth/auth";
import { ensureIntegrationRows } from "./modules/integrations/vault";
import { recomputeAllReadiness } from "./modules/workflows/readiness";

async function main() {
  await bootstrapAdmin();
  await ensureIntegrationRows();
  await recomputeAllReadiness();

  const app = createApp();
  const port = Number(process.env.PORT ?? 4100);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[eki-automation-api] listening on :${port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[eki-automation-api] fatal startup error", err);
  process.exit(1);
});
