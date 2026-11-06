"use client";

import Link from "next/link";
import { useEffect } from "react";

// Instead of the framework's English error page.
export default function ScreenError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section>
      <div className="panel state-panel" role="alert">
        <h1>משהו השתבש</h1>
        <p className="muted">לא הצלחנו לטעון את המסך. אם החיבור לאינטרנט חלש, כדאי לבדוק אותו ולנסות שוב.</p>
        <div className="row-end">
          <Link className="btn" href="/">
            למסך הראשי
          </Link>
          <button type="button" className="btn primary" onClick={() => retry()}>
            לנסות שוב
          </button>
        </div>
      </div>
    </section>
  );
}
