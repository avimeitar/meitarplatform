import Link from "next/link";

export const metadata = { title: "הדף לא נמצא" };

// Instead of the framework's English "page could not be found", e.g. a lead that was deleted.
export default function NotFound() {
  return (
    <main className="state-page">
      <div className="panel state-panel">
        <h1>הדף לא נמצא</h1>
        <p className="muted">יכול להיות שהליד נמחק, שהקישור לא שלם, או שאין לך גישה אליו.</p>
        <div className="row-end">
          <Link className="btn primary" href="/leads">
            לרשימת הלידים
          </Link>
          <Link className="btn" href="/">
            למסך הראשי
          </Link>
        </div>
      </div>
    </main>
  );
}
