"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Btn, PageTitle, Ticket } from "@/components/kit";
import { useHome } from "@/lib/home";

function Queue() {
  const router = useRouter();
  const { data } = useHome();
  const first = data?.line.review[0];

  // Reviewing is the only thing to do here, so go straight to the first item.
  useEffect(() => {
    if (first) router.replace(`/review/${first.kind}/${first.id}`);
  }, [first, router]);

  if (!data || first) return <div className="h-64 animate-pulse rounded-3xl bg-slate-100" />;
  const recent = [...data.line.posted, ...data.line.scheduled, ...data.line.stopped].slice(0, 9);
  return (
    <>
      <PageTitle title="All caught up." sub="Nothing is waiting for you. New work lands here the moment it is ready." action={<Btn href="/make" big>Make something</Btn>} />
      {recent.length ? (
        <section>
          <h2 className="mb-3 text-lg font-bold">Recently</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{recent.map((p) => <Ticket key={`${p.kind}-${p.id}`} piece={p} />)}</div>
        </section>
      ) : null}
    </>
  );
}

export default function ReviewPage() {
  return (
    <ControlCenterLayout>
      <Queue />
    </ControlCenterLayout>
  );
}
