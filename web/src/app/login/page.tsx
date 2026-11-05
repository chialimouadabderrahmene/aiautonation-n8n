"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { login, APIError } from "@/lib/api";
import { Banner, Btn } from "@/components/kit";

const field = "mt-1 w-full rounded-xl border border-rule bg-card px-4 py-3 outline-none focus:border-ink";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Could not sign in. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-paper lg:grid-cols-2">
      <div className="flex flex-col justify-between bg-ink p-8 text-paper sm:p-12">
        <p className="font-display text-4xl font-extrabold">eki<span className="text-palm">.</span></p>
        <div className="my-10">
          <h1 className="text-5xl font-extrabold leading-[1.02] sm:text-6xl">One idea in.<br />Posted content and answered customers out.</h1>
          <ol className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-semibold text-paper/70">
            {["Make", "Review", "Post", "Answer"].map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                {i > 0 ? <span className="belt w-8" aria-hidden /> : null}
                {s}
              </li>
            ))}
          </ol>
        </div>
        <div className="weave -mx-8 -mb-8 sm:-mx-12 sm:-mb-12" aria-hidden />
      </div>
      <div className="flex items-center justify-center p-8">
        <form onSubmit={onSubmit} className="w-full max-w-sm">
          <h2 className="text-3xl font-bold">Sign in</h2>
          {error ? <div className="mt-4"><Banner tone="berry">{error}</Banner></div> : null}
          <label htmlFor="email" className="mt-6 block text-sm font-semibold">Email</label>
          <input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          <label htmlFor="password" className="mt-4 block text-sm font-semibold">Password</label>
          <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
          <div className="mt-6"><Btn type="submit" big disabled={loading} className="w-full">{loading ? "Signing in..." : "Sign in"}</Btn></div>
        </form>
      </div>
    </div>
  );
}
