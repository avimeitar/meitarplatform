"use client";

import { Icon } from "@/components/Icon";
import { PushToggle } from "@/components/crm/PushToggle";
import { useDrawer } from "@/components/ui/Overlays";

/** "תזכורות בטלפון": turns on the phone notification for tasks that fall due. */
export function PushButton() {
  const drawer = useDrawer();
  return (
    <button
      type="button"
      className="btn"
      onClick={() =>
        drawer.open({
          title: "תזכורות בטלפון",
          sheet: true,
          content: (
            <div className="sheet-body">
              <p className="muted">כשמגיע הזמן של משימה, היא קופצת על המסך כשהמערכת פתוחה. כדי לקבל התראה בטלפון גם כשהמערכת סגורה, מפעילים כאן, בכל טלפון פעם אחת.</p>
              <PushToggle />
            </div>
          ),
        })
      }
    >
      <Icon name="bell" />
      תזכורות בטלפון
    </button>
  );
}
