"use client";

import { useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Card, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/ui";
import { api, APIError } from "@/lib/api";

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  role: string | null;
  status: string;
  source: string | null;
  lastMessageAt: string | null;
}

interface Listing {
  id: string;
  name: string | null;
  description: string | null;
  price: string | null;
  status: string;
  contact: { phone: string; name: string | null };
}

export default function WhatsAppPage() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [c, l] = await Promise.all([api.get<Contact[]>("/api/whatsapp/contacts"), api.get<Listing[]>("/api/whatsapp/listings")]);
      setContacts(c);
      setListings(l);
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <ControlCenterLayout>
      <PageHeader title="WhatsApp Onboarding" subtitle="Keyword → group invite link (JOIN) or signup (VENDOR/BUYER) → product listing, handled natively — no n8n workflow involved." />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!contacts || !listings ? (
        <LoadingState />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">Contacts ({contacts.length})</h2>
            <div className="space-y-2">
              {contacts.map((c) => (
                <Card key={c.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="font-semibold">{c.name || c.phone}</span>
                      {c.role ? <Badge tone="blue">{c.role}</Badge> : null}
                      <span className="ml-2 text-xs text-slate-400">{c.phone}</span>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                </Card>
              ))}
              {contacts.length === 0 ? <p className="text-sm text-slate-500">No contacts yet.</p> : null}
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">Product listings ({listings.length})</h2>
            <div className="space-y-2">
              {listings.map((l) => (
                <Card key={l.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="font-semibold">{l.name || "(untitled)"}</span>
                      <span className="ml-2 text-xs text-slate-400">
                        {l.contact.name || l.contact.phone} · {l.price ?? "no price yet"}
                      </span>
                    </div>
                    <StatusBadge status={l.status} />
                  </div>
                </Card>
              ))}
              {listings.length === 0 ? <p className="text-sm text-slate-500">No listings yet.</p> : null}
            </div>
          </section>
        </div>
      )}
    </ControlCenterLayout>
  );
}
