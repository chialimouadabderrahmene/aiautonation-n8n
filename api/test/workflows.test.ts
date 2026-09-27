import { describe, it, expect } from "vitest";
import path from "node:path";
process.env.WORKFLOWS_DIR = path.resolve(__dirname, "../../n8n-workflows");
import { loadWorkflowFile, transformWorkflow, requiredCredentialNames, workflowFilesAvailable, detectTriggerKind, definitionHash } from "../src/modules/n8n/workflows";
import { WORKFLOW_MANIFEST } from "../src/modules/workflows/manifest";
import { MANAGED_CREDENTIALS } from "../src/modules/n8n/credentials";

const ids = Object.fromEntries(MANAGED_CREDENTIALS.map((c, i) => [c.name, `cred${i}`]));

describe("n8n workflow import transform", () => {
  it("manifest and files match exactly (22 workflows)", () => {
    expect(WORKFLOW_MANIFEST).toHaveLength(22);
    expect(workflowFilesAvailable().sort()).toEqual(WORKFLOW_MANIFEST.map((w) => w.key).sort());
  });
  for (const entry of WORKFLOW_MANIFEST) {
    it(`${entry.key}: every credential is managed, Sheets uses the service account, error handler resolved`, () => {
      const file = loadWorkflowFile(entry.key);
      const def = transformWorkflow(file, ids, "ERRWF");
      const s = JSON.stringify(def);
      expect(s).not.toContain("googleSheetsOAuth2Api");
      expect(s).not.toContain('"oAuth2Api"');
      expect(s).not.toContain("eki-cred-");
      expect(def.settings?.errorWorkflow).not.toBe("ekiwf00");
      for (const n of def.nodes) {
        if (n.type === "n8n-nodes-base.googleSheets") expect(n.parameters.authentication).toBe("serviceAccount");
        for (const ref of Object.values(n.credentials ?? {})) expect(Object.values(ids)).toContain(ref.id);
      }
      if (entry.key !== "00-global-error-handler") expect(def.settings?.errorWorkflow).toBe("ERRWF");
      for (const name of requiredCredentialNames(file)) expect(MANAGED_CREDENTIALS.map((c) => c.name)).toContain(name);
      expect(["manual", "webhook", "error"]).toContain(detectTriggerKind(file));
      // Import must never carry an active flag or an id.
      expect(s).not.toMatch(/"active":\s*true/);
      expect((def as Record<string, unknown>).id).toBeUndefined();
    });
  }
  it("drops credential refs that are not synced yet instead of pointing at missing ids", () => {
    const def = transformWorkflow(loadWorkflowFile("01-ai-content-generation"), {}, null);
    expect(JSON.stringify(def)).not.toContain('"credentials"');
    expect(def.settings?.errorWorkflow).toBeUndefined();
  });
  it("hash changes when credentials change (forces an update in n8n)", () => {
    const f = loadWorkflowFile("01-ai-content-generation");
    expect(definitionHash(transformWorkflow(f, ids, "A"))).not.toBe(definitionHash(transformWorkflow(f, { ...ids, "Eki Telegram Bot": "other" }, "A")));
  });
});
