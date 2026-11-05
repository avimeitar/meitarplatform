const WHAT: Record<string, string> = {
  DATABASE_URL: "חיבור למסד הנתונים (שירות PostgreSQL ב-Railway)",
  BETTER_AUTH_SECRET: "מפתח אבטחה להתחברות (משתנה BETTER_AUTH_SECRET)",
  OTP: "שירות לשליחת קודי כניסה ב-SMS או בוואטסאפ",
};

export function SetupNotice({ missing }: { missing: string[] }) {
  return (
    <main className="login">
      <div className="login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-blue.webp" alt="מיתר נדל״ן והשקעות" />
        <h1>המערכת כמעט מוכנה</h1>
        <p className="sub">כדי להתחיל צריך להשלים בהגדרות של Railway:</p>
        <ul className="setup-list">
          {missing.map((m) => (
            <li key={m}>{WHAT[m] ?? m}</li>
          ))}
        </ul>
        <p className="login-hint">ההוראות המלאות נמצאות בקובץ docs/SETUP.md בגיטהאב.</p>
      </div>
    </main>
  );
}
