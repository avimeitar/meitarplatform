export const dynamic = "force-dynamic";
export const metadata = { title: "חיבור לידים מפייסבוק" };

const TEXT: Record<string, [string, string]> = {
  connected: ["החיבור הצליח", "הלידים מהטפסים של העמוד יגיעו מעכשיו לקבוצת מיתר לבד. אפשר לסגור את החלון."],
  denied: ["החיבור לא הושלם", "לא אושרה הגישה בפייסבוק. אפשר לפתוח שוב את הקישור ולאשר את כל ההרשאות."],
  nopages: ["לא נבחר עמוד", "בפייסבוק צריך לבחור לפחות עמוד אחד. אפשר לפתוח שוב את הקישור ולבחור את העמוד."],
  expired: ["הקישור לא בתוקף", "עבר הזמן שלו או שבוטל. אפשר לבקש מקבוצת מיתר קישור חדש."],
  setup: ["החיבור עוד לא זמין", "קבוצת מיתר עדיין משלימה את ההגדרות מול פייסבוק. אפשר לנסות שוב בעוד כמה ימים."],
  unavailable: ["החיבור עוד לא זמין", "קבוצת מיתר עדיין משלימה את ההגדרות מול פייסבוק. אפשר לנסות שוב בעוד כמה ימים."],
  failed: ["משהו השתבש", "פייסבוק לא אישר את החיבור. אפשר לנסות שוב, ואם זה חוזר לשלוח לקבוצת מיתר את ההודעה שמופיעה כאן."],
};

/** Where a lead supplier lands after connecting their Facebook page. */
export default async function ConnectFacebookDone({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [title, text] = TEXT[sp.status ?? ""] ?? TEXT.failed;
  return (
    <main className="login">
      <div className="login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-blue.webp" alt="מיתר נדל״ן והשקעות" />
        <h1>{title}</h1>
        <p className="sub">{text}</p>
        {sp.status === "failed" && sp.why && (
          <p className="muted ltr" style={{ fontSize: 13 }}>
            {sp.why.slice(0, 200)}
          </p>
        )}
      </div>
    </main>
  );
}
