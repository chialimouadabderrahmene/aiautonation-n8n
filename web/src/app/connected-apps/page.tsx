"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, StatusBadge, timeAgo } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { Integration } from "@/lib/types";

interface ConnectedAccount {
  id: string;
  provider: string;
  label: string;
  externalAccountId: string;
  isDefault: boolean;
  status: string;
  connectedAt: string;
  maskedToken: string;
}

const CATEGORY_ORDER = ["AI", "MEDIA", "SOCIAL", "MESSAGING", "EMAIL", "ORCHESTRATION", "RESEARCH"] as const;
const CATEGORY_LABEL: Record<string, string> = { AI: "AI providers", MEDIA: "Content & media", SOCIAL: "Social", MESSAGING: "Communication", EMAIL: "Email", ORCHESTRATION: "Orchestration", RESEARCH: "Research" };
/** Named explicitly so this reads as "not supported" rather than a hole in the list — H: never fake a connection. */
const UNSUPPORTED = [{ key: "tiktok", label: "TikTok", note: "No native publishing integration exists yet — see docs/INTEGRATION_STATUS.md" }];

export default function ConnectedAppsPage() {
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  async function load() {
    try {
      const [i, a] = await Promise.all([api.get<Integration[]>("/api/integrations"), api.get<ConnectedAccount[]>("/api/accounts")]);
      setIntegrations(i);
      setAccounts(a);
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function test(provider: string) {
    setTesting(provider);
    try {
      await api.post(`/api/integrations/${provider}/test`);
      await load();
    } catch {
      await load();
    } finally {
      setTesting(null);
    }
  }

  const grouped = (integrations ?? []).reduce<Record<string, Integration[]>>((acc, i) => {
    (acc[i.category] ??= []).push(i);
    return acc;
  }, {});
  const accountsByProvider = (accounts ?? []).reduce<Record<string, ConnectedAccount[]>>((acc, a) => {
    (acc[a.provider] ??= []).push(a);
    return acc;
  }, {});

  return (
    <ControlCenterLayout>
      <PageHeader
        title="Connected Apps"
        subtitle="Every provider in one place. A provider is only ever marked Connected after a real connection test succeeds — never assumed from a saved key."
      />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!integrations || !accounts ? (
        <LoadingState />
      ) : (
        <div className="space-y-8">
          {CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((category) => (
            <section key={category}>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">{CATEGORY_LABEL[category] ?? category}</h2>
              <div className="space-y-2">
                {grouped[category]!.map((i) => (
                  <Card key={i.provider}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{i.label}</span>
                          <StatusBadge status={i.status} />
                          {i.connectedAccount ? <span className="text-xs text-slate-400">{i.connectedAccount}</span> : null}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {i.lastTestedAt ? `Last checked ${timeAgo(i.lastTestedAt)}${i.lastTestOk === false ? " — failed" : ""}` : "Never tested"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {i.status !== "NOT_CONFIGURED" ? (
                          <Button variant="secondary" onClick={() => test(i.provider)} disabled={testing === i.provider}>
                            {testing === i.provider ? "Testing…" : "Test connection"}
                          </Button>
                        ) : null}
                        <Link href="/integrations" className="inline-flex items-center rounded-lg bg-slate-100 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">
                          Configure
                        </Link>
                      </div>
                    </div>
                    {category === "SOCIAL" && accountsByProvider[i.provider]?.length ? (
                      <div className="mt-3 border-t border-slate-100 pt-2">
                        <p className="mb-1 text-xs font-semibold text-slate-500">Connected accounts</p>
                        <ul className="space-y-1 text-xs text-slate-600">
                          {accountsByProvider[i.provider]!.map((a) => (
                            <li key={a.id} className="flex items-center gap-2">
                              <span>{a.label}</span>
                              {a.isDefault ? <Badge tone="blue">default</Badge> : null}
                              <Badge tone={a.status === "CONNECTED" ? "green" : "red"}>{a.status}</Badge>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </Card>
                ))}
              </div>
            </section>
          ))}

          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Not yet supported</h2>
            <div className="space-y-2">
              {UNSUPPORTED.map((u) => (
                <Card key={u.key}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="font-semibold">{u.label}</span>
                      <p className="mt-1 text-xs text-slate-500">{u.note}</p>
                    </div>
                    <Badge tone="slate">Not connected</Badge>
                  </div>
                </Card>
              ))}
            </div>
          </section>

          <p className="text-xs text-slate-400">
            Manage multiple accounts of the same social platform, or capture a newly connected account under a name, on{" "}
            <Link href="/connected-accounts" className="text-brand-600 hover:underline">
              Connected Accounts
            </Link>
            .
          </p>
        </div>
      )}
    </ControlCenterLayout>
  );
}
