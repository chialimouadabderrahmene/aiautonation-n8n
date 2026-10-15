"use client";

import { useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Button, Card, ErrorState, LoadingState, PageHeader } from "@/components/ui";
import { api, APIError } from "@/lib/api";

type Settings = Record<string, unknown>;

const BOOLEAN_SETTINGS: { key: string; label: string; help: string }[] = [
  { key: "whatsappTemplatesApproved", label: "WhatsApp templates approved", help: "Confirm only after Meta has actually approved all 15 templates (whatsapp-templates.md) — this cannot be checked automatically." },
  { key: "autopilotSocialPostingEnabled", label: "Autopilot social posting", help: "Keep off until a week of human-reviewed output has passed, per the existing safety guidance." },
  { key: "feedbackFormConfigured", label: "Feedback form configured", help: "Confirm once FEEDBACK_FORM_URL points at a real form." },
];

const TEXT_SETTINGS: { key: string; label: string }[] = [
  { key: "defaultAiProvider", label: "Default AI provider" },
  { key: "defaultVideoProvider", label: "Default video provider" },
  { key: "defaultVoiceProvider", label: "Default voice provider" },
  { key: "defaultLanguage", label: "Default language" },
  { key: "defaultTone", label: "Default tone" },
  { key: "defaultAspectRatio", label: "Default aspect ratio" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    try {
      setSettings(await api.get<Settings>("/api/settings"));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load settings");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(key: string, value: unknown) {
    setSaving(key);
    try {
      await api.put(`/api/settings/${key}`, { value });
      await load();
    } catch (err) {
      alert(err instanceof APIError ? err.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  }

  if (error) return <ControlCenterLayout><ErrorState message={error} onRetry={load} /></ControlCenterLayout>;
  if (!settings) return <ControlCenterLayout><LoadingState /></ControlCenterLayout>;

  return (
    <ControlCenterLayout>
      <PageHeader title="Settings" subtitle="Defaults for the Video Generator, plus manual confirmations the readiness engine can't verify by itself." />

      <div className="space-y-6">
        <Card>
          <h2 className="text-lg font-bold text-slate-900">Manual confirmations</h2>
          <p className="mt-1 text-sm text-slate-500">These feed workflow readiness — only confirm what is actually true.</p>
          <div className="mt-4 space-y-4">
            {BOOLEAN_SETTINGS.map((s) => (
              <label key={s.key} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={Boolean(settings[s.key])}
                  disabled={saving === s.key}
                  onChange={(e) => save(s.key, e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-800">{s.label}</span>
                  <span className="block text-xs text-slate-400">{s.help}</span>
                </span>
              </label>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-slate-900">Video Generator defaults</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {TEXT_SETTINGS.map((s) => (
              <div key={s.key}>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">{s.label}</label>
                <div className="flex gap-2">
                  <input
                    defaultValue={String(settings[s.key] ?? "")}
                    onBlur={(e) => e.target.value !== String(settings[s.key]) && save(s.key, e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
                  />
                  {saving === s.key ? <Button disabled>...</Button> : null}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </ControlCenterLayout>
  );
}
