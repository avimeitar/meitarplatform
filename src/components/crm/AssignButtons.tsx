"use client";

import { assignLeadAction, autoAssignAction } from "@/app/actions/leads";
import { Icon } from "@/components/Icon";
import { useRunner } from "@/components/ui/useRunner";
import { firstName } from "./bits";

export function AssignButtons({ leadId, people }: { leadId: string; people: { id: string; name: string }[] }) {
  const runner = useRunner();
  return (
    <div className="assign">
      <span className="muted">שיוך:</span>
      {people.map((p) => (
        <button key={p.id} type="button" className="name-btn" aria-label={`שיוך ל${p.name}`} onClick={() => runner(assignLeadAction(leadId, p.id))}>
          {firstName(p.name)}
        </button>
      ))}
    </div>
  );
}

export function AutoAssignAll({ leadIds }: { leadIds: string[] }) {
  const runner = useRunner();
  if (!leadIds.length) return null;
  return (
    <div className="row-end">
      <button type="button" className="btn sm" onClick={() => runner(autoAssignAction(leadIds))}>
        <Icon name="repeat" />
        שיוך אוטומטי לכל מי שלא שויך
      </button>
    </div>
  );
}
