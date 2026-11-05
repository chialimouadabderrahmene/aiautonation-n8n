"use client";

import { useParams } from "next/navigation";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Desk, QueueRail } from "@/components/ReviewDesk";
import { PieceKind } from "@/lib/home";

export default function ReviewItemPage() {
  const params = useParams<{ kind: string; id: string }>();
  const kind = (["video", "carousel", "post"].includes(params.kind) ? params.kind : "video") as PieceKind;
  return (
    <ControlCenterLayout>
      <QueueRail currentId={params.id} />
      <Desk key={`${kind}-${params.id}`} kind={kind} id={params.id} />
    </ControlCenterLayout>
  );
}
