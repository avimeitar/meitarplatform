import Link from "next/link";
import { Icon } from "@/components/Icon";

export const metadata = { title: "אין הרשאה" };

export default function DeniedPage() {
  return (
    <main className="login">
      <div className="login-card" style={{ textAlign: "center" }}>
        <span className="ph-ic">
          <Icon name="lock" />
        </span>
        <h1>אין לך הרשאה למסך הזה</h1>
        <p className="sub">אם צריך גישה, מנהל המערכת יכול להוסיף אותה בהרשאות.</p>
        <Link className="btn primary full" href="/">
          חזרה למסך הראשי
        </Link>
      </div>
    </main>
  );
}
