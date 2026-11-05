"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Banner, Btn, Chip, PageTitle } from "@/components/kit";
import { api, APIError } from "@/lib/api";
import { SetupStep, useHome } from "@/lib/home";
import { Integration, IntegrationField } from "@/lib/types";

const field = "w-full rounded-xl border border-rule bg-card px-3 py-2.5 outline-none focus:border-ink";

function plainError(err: unknown, fallback: string): string {
  return err instanceof APIError ? err.message : fallback;
}

function FieldRow({ f, value, onChange }: { f: IntegrationField; value: string; onChange: (v: string) => void }) {
  const placeholder = f.secret && f.maskedPreview ? `Saved (${f.maskedPreview}). Leave empty to keep it.` : f.placeholder ?? (f.default ? `Default: ${f.default}` : "");
  return (
    <div>
      <label htmlFor={f.name} className="mb-1 block text-sm font-semibold">{f.label}{f.required ? "" : <span className="font-normal text-ink-faint"> (optional)</span>}</label>
      {f.type === "select" && f.options ? (
        <select id={f.name} value={value} onChange={(e) => onChange(e.target.value)} className={field}>
          {!f.required ? <option value="">{f.default ? `Default (${f.default})` : "None"}</option> : null}
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : f.type === "json" || f.type === "textarea" ? (
        <textarea id={f.name} value={value} onChange={(e) => onChange(e.target.value)} rows={3} spellCheck={false} placeholder={placeholder} className={`${field} font-mono text-xs`} />
      ) : (
        <input id={f.name} type={f.secret ? "password" : "text"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} placeholder={placeholder} className={field} />
      )}
      {f.help ? <p className="mt-1 text-xs text-ink-faint">{f.help}</p> : null}
    </div>
  );
}

/** One provider: paste the key, press one button. Saving and checking are a single action. */
function Provider({ item, onChanged }: { item: Integration; onChanged: () => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(item.fields.filter((f) => !f.secret).map((f) => [f.name, item.config[f.name] ?? ""])));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [more, setMore] = useState(false);
  const oauth = item.authType === "OAUTH";
  const main = item.fields.filter((f) => f.required || (f.secret && !f.group));
  const extra = item.fields.filter((f) => !main.includes(f));
  const connected = item.status === "CONNECTED";

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const secrets: Record<string, string> = {};
    const config: Record<string, string> = {};
    for (const f of item.fields) {
      const v = (values[f.name] ?? "").trim();
      if (f.secret) {
        if (v) secrets[f.name] = v;
      } else config[f.name] = v;
    }
    try {
      await api.put(`/api/integrations/${item.provider}`, { secrets, config });
      if (oauth) {
        const { authorizeUrl } = await api.post<{ authorizeUrl: string }>(`/api/integrations/${item.provider}/oauth/start`);
        window.location.href = authorizeUrl;
        return;
      }
      const r = await api.post<{ ok: boolean; message: string }>(`/api/integrations/${item.provider}/test`);
      setResult({ ok: r.ok, text: r.ok ? "Connected. It works." : r.message });
    } catch (err) {
      setResult({ ok: false, text: plainError(err, "That did not save. Please try again.") });
    } finally {
      setBusy(false);
      await onChanged();
    }
  }

  async function disconnect() {
    if (!confirm(`Disconnect ${item.label}? Its saved keys are removed from Eki.`)) return;
    setBusy(true);
    await api.delete(`/api/integrations/${item.provider}`).catch(() => undefined);
    setBusy(false);
    setResult(null);
    await onChanged();
  }

  return (
    <form onSubmit={save} className="rise rounded-2xl bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{item.label}</p>
        {connected ? <span className="rounded-full bg-leaf-wash px-3 py-1 text-xs font-bold text-leaf-deep">Connected</span> : item.status === "TEST_FAILED" ? <span className="rounded-full bg-berry-wash px-3 py-1 text-xs font-bold text-berry">Not working</span> : null}
      </div>
      {item.docsUrl ? <p className="mt-1 text-sm"><a href={item.docsUrl} target="_blank" rel="noreferrer" className="font-semibold text-palm underline underline-offset-2">Where do I get this?</a></p> : null}
      {oauth && item.oauthRedirectUri ? (
        <div className="mt-3 rounded-xl bg-plantain-wash p-3 text-sm">
          Paste this into your app&apos;s settings on their site:
          <code className="mt-1 block break-all rounded bg-white p-2 font-mono text-xs">{item.oauthRedirectUri}</code>
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {main.map((f) => <FieldRow key={f.name} f={f} value={values[f.name] ?? ""} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />)}
      </div>
      {extra.length ? (
        <div className="mt-3">
          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="text-sm font-semibold text-ink-soft underline underline-offset-2">{more ? "Hide extra settings" : `Extra settings (${extra.length})`}</button>
          {more ? <div className="mt-3 grid gap-3 md:grid-cols-2">{extra.map((f) => <FieldRow key={f.name} f={f} value={values[f.name] ?? ""} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />)}</div> : null}
        </div>
      ) : null}
      {result ? <div className="mt-3"><Banner tone={result.ok ? "leaf" : "berry"}>{result.text}</Banner></div> : item.status === "TEST_FAILED" && item.lastTestMessage ? <div className="mt-3"><Banner tone="berry">{item.lastTestMessage}</Banner></div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Btn type="submit" disabled={busy}>{busy ? "Checking..." : oauth ? "Save and connect account" : connected ? "Save and check again" : "Save and check"}</Btn>
        {item.configured ? <Btn tone="ghost" disabled={busy} onClick={() => void disconnect()}>Disconnect</Btn> : null}
      </div>
      <p className="mt-2 text-xs text-ink-faint">Keys are encrypted the moment you save and are never shown again.</p>
    </form>
  );
}

interface Brand { id: string; name: string; voiceAdjectives: string[]; tone: string | null; preferredPhrases: string[]; bannedWords: string[]; exampleSentences: string[] }

function BrandForm({ onDone }: { onDone: () => Promise<void> }) {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [name, setName] = useState("Eki");
  const [voice, setVoice] = useState("");
  const [tone, setTone] = useState("");
  const [say, setSay] = useState("");
  const [never, setNever] = useState("");
  const [example, setExample] = useState("");
  const [appLink, setAppLink] = useState("");
  const [vendorLink, setVendorLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void Promise.all([api.get<Brand[]>("/api/brand/profiles"), api.get<Record<string, unknown>>("/api/settings").catch(() => ({} as Record<string, unknown>))]).then(([list, settings]) => {
      const b = list[0];
      if (b) {
        setBrand(b);
        setName(b.name.replace(" (starter)", ""));
        setVoice(b.voiceAdjectives.join(", "));
        setTone(b.tone ?? "");
        setSay(b.preferredPhrases.join(", "));
        setNever(b.bannedWords.join(", "));
        setExample(b.exampleSentences[0] ?? "");
      }
      const values = ((settings as { values?: Record<string, unknown> }).values ?? settings) as Record<string, unknown>;
      setAppLink(String(values.appDownloadLink ?? ""));
      setVendorLink(String(values.appVendorLink ?? ""));
    });
  }, []);

  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const body = { name: name.trim() || "Eki", voiceAdjectives: list(voice), tone: tone.trim() || null, preferredPhrases: list(say), bannedWords: list(never), exampleSentences: example.trim() ? [example.trim()] : [] };
    try {
      if (brand) await api.put(`/api/brand/profiles/${brand.id}`, body);
      else {
        const created = await api.post<Brand>("/api/brand/profiles", body);
        await api.post(`/api/brand/profiles/${created.id}/activate`);
      }
      if (appLink.trim()) await api.put("/api/settings/appDownloadLink", { value: appLink.trim() });
      if (vendorLink.trim()) await api.put("/api/settings/appVendorLink", { value: vendorLink.trim() });
      setMessage({ ok: true, text: "Saved. Everything Eki writes from now on uses this." });
      await onDone();
    } catch (err) {
      setMessage({ ok: false, text: plainError(err, "That did not save.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="rise grid gap-3 rounded-2xl bg-slate-50 p-4 md:grid-cols-2">
      <div><label htmlFor="b-name" className="mb-1 block text-sm font-semibold">Brand name</label><input id="b-name" value={name} onChange={(e) => setName(e.target.value)} className={field} /></div>
      <div><label htmlFor="b-voice" className="mb-1 block text-sm font-semibold">Three words for how you sound</label><input id="b-voice" value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="warm, direct, proud" className={field} /></div>
      <div><label htmlFor="b-say" className="mb-1 block text-sm font-semibold">Phrases you love</label><input id="b-say" value={say} onChange={(e) => setSay(e.target.value)} placeholder="the taste of home" className={field} /></div>
      <div><label htmlFor="b-never" className="mb-1 block text-sm font-semibold">Words to never use</label><input id="b-never" value={never} onChange={(e) => setNever(e.target.value)} placeholder="cheap, exotic" className={field} /></div>
      <div className="md:col-span-2"><label htmlFor="b-example" className="mb-1 block text-sm font-semibold">One sentence that sounds exactly like you</label><input id="b-example" value={example} onChange={(e) => setExample(e.target.value)} className={field} /></div>
      <div><label htmlFor="b-app" className="mb-1 block text-sm font-semibold">Your app or website link</label><input id="b-app" value={appLink} onChange={(e) => setAppLink(e.target.value)} placeholder="https://" className={field} /></div>
      <div><label htmlFor="b-vendor" className="mb-1 block text-sm font-semibold">Vendor sign-up link</label><input id="b-vendor" value={vendorLink} onChange={(e) => setVendorLink(e.target.value)} placeholder="https://" className={field} /></div>
      {message ? <div className="md:col-span-2"><Banner tone={message.ok ? "leaf" : "berry"}>{message.text}</Banner></div> : null}
      <div className="md:col-span-2"><Btn type="submit" disabled={busy}>{busy ? "Saving..." : "Save"}</Btn></div>
    </form>
  );
}

function Step({ step, number, items, onChanged, open, onToggle }: { step: SetupStep; number: number; items: Integration[]; onChanged: () => Promise<void>; open: boolean; onToggle: () => void }) {
  const providers = items.filter((i) => step.providers.includes(i.provider));
  const [picked, setPicked] = useState<string | null>(null);
  const current = providers.find((p) => p.provider === picked) ?? providers.find((p) => p.status === "CONNECTED") ?? providers[0];

  return (
    <li className="rounded-3xl bg-card shadow-ticket">
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-4 p-5 text-left">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display font-bold ${step.done ? "bg-leaf text-white" : "bg-ink text-paper"}`}>{step.done ? "✓" : number}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-xl font-bold">{step.title}</span>
          <span className="block text-sm text-ink-soft">{step.why}</span>
        </span>
        {!step.required && !step.done ? <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-ink-faint sm:block">Add later if you like</span> : null}
        <span className="text-xl text-ink-faint" aria-hidden>{open ? "–" : "+"}</span>
      </button>
      {open ? (
        <div className="px-5 pb-5">
          {step.id === "brand" ? <BrandForm onDone={onChanged} /> : null}
          {providers.length > 1 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {providers.map((p) => <Chip key={p.provider} active={current?.provider === p.provider} onClick={() => setPicked(p.provider)}>{p.label}{p.status === "CONNECTED" ? " ✓" : ""}</Chip>)}
            </div>
          ) : null}
          {current ? <Provider key={`${current.provider}-${current.status}`} item={current} onChanged={onChanged} /> : null}
          {step.id === "whatsapp" ? <TemplatesConfirm /> : null}
        </div>
      ) : null}
    </li>
  );
}

function TemplatesConfirm() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    void api.get<Record<string, unknown>>("/api/settings").then((s) => {
      const v = ((s as { values?: Record<string, unknown> }).values ?? s) as Record<string, unknown>;
      setOn(v.whatsappTemplatesApproved === true);
    }).catch(() => undefined);
  }, []);
  return (
    <label className="mt-3 flex items-start gap-3 rounded-2xl bg-plantain-wash p-4 text-sm">
      <input type="checkbox" checked={on} className="mt-0.5 h-4 w-4" onChange={(e) => { setOn(e.target.checked); void api.put("/api/settings/whatsappTemplatesApproved", { value: e.target.checked }); }} />
      <span><strong>Meta has approved my WhatsApp templates.</strong> Follow-up messages cannot be sent until you tick this, because WhatsApp blocks unapproved templates.</span>
    </label>
  );
}

function GoLive({ canGoLive, missing, onLive }: { canGoLive: boolean; missing: string[]; onLive: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [autoPost, setAutoPost] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setBusy(true);
    setError("");
    try {
      await api.post("/api/practice/go-live", { confirm: true, postAfterApproval: autoPost });
      setOpen(false);
      await onLive();
    } catch (err) {
      setError(plainError(err, "That did not work."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-3xl bg-ink p-6 text-paper shadow-lift">
      <h2 className="text-3xl font-bold">Ready for the real thing?</h2>
      {canGoLive ? (
        <p className="mt-1 text-paper/70">You have what you need. Anything you have not connected stays switched off until you add it.</p>
      ) : (
        <p className="mt-1 text-paper/70">Finish these first: {missing.join(", ")}.</p>
      )}
      {!open ? (
        <div className="mt-4"><Btn big disabled={!canGoLive} onClick={() => setOpen(true)}>Go live</Btn></div>
      ) : (
        <div className="rise mt-4 rounded-2xl bg-paper p-5 text-ink">
          <p className="font-display text-xl font-bold">Going live does three things:</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
            <li>Permanently deletes all sample content and sample leads.</li>
            <li>Switches every autopilot off, so nothing messages real people until you choose it.</li>
            <li>From then on, what you approve is really posted, and providers really charge you.</li>
          </ul>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input type="checkbox" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span>Post straight away when I press Approve. (If you untick this, approved work waits for you to post it yourself.)</span>
          </label>
          {error ? <div className="mt-3"><Banner tone="berry">{error}</Banner></div> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Btn tone="palm" disabled={busy} onClick={() => void go()}>{busy ? "Going live..." : "Yes, go live"}</Btn>
            <Btn tone="ghost" disabled={busy} onClick={() => setOpen(false)}>Not yet</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function Setup() {
  const { data, refresh } = useHome();
  const [items, setItems] = useState<Integration[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setItems(await api.get<Integration[]>("/api/integrations"));
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void load();
    const q = new URLSearchParams(window.location.search);
    if (q.get("oauth")) {
      setBanner({ ok: q.get("result") === "ok", text: q.get("message") ?? "" });
      window.history.replaceState(null, "", "/setup");
    }
    // Only on first arrival, including the return trip from a social login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (data && openId === null) setOpenId(data.setup.steps.find((s) => !s.done)?.id ?? "");
    // Open the first unfinished step once, then leave the choice to the person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!data) return <div className="h-64 animate-pulse rounded-3xl bg-slate-100" />;
  const missing = data.setup.steps.filter((s) => s.required && !s.done).map((s) => s.title);

  return (
    <>
      <PageTitle
        title={data.practice ? "Go live" : "Your connections"}
        sub={data.practice ? "One account at a time. Stop whenever you like. Practice mode keeps working until you decide." : "Eki is live. Add or fix connections here."}
      />
      {banner ? <div className="mb-4"><Banner tone={banner.ok ? "leaf" : "berry"}>{banner.ok ? "Account connected." : `That did not connect: ${banner.text}`}</Banner></div> : null}
      {!data.system.ok ? <div className="mb-4"><Banner tone="berry"><strong>The studio is offline.</strong> Connecting accounts will work, but nothing can be made until your developer starts the worker and queue.</Banner></div> : null}
      <ol className="space-y-3">
        {data.setup.steps.map((s, i) => (
          <Step key={s.id} step={s} number={i + 1} items={items} onChanged={load} open={openId === s.id} onToggle={() => setOpenId(openId === s.id ? "" : s.id)} />
        ))}
      </ol>
      {data.practice ? (
        <GoLive canGoLive={data.setup.canGoLive} missing={missing} onLive={load} />
      ) : (
        <div className="mt-6 rounded-3xl bg-leaf-wash p-6">
          <h2 className="text-2xl font-bold text-leaf-deep">You are live.</h2>
          <p className="mt-1 text-sm text-ink-soft">New team member? You can switch back to Practice mode to train them. While it is on, nothing real goes out.</p>
          <div className="mt-3"><Btn tone="ghost" onClick={() => { if (confirm("Back to Practice mode? While it is on, nothing real is sent or posted, including scheduled posts.")) void api.post("/api/practice/enter").then(load); }}>Back to Practice mode</Btn></div>
        </div>
      )}
    </>
  );
}

export default function SetupPage() {
  return (
    <ControlCenterLayout>
      <Setup />
    </ControlCenterLayout>
  );
}
