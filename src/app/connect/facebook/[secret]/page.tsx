import { liveInvite } from "@/lib/metaInvites";

export const dynamic = "force-dynamic";
export const metadata = { title: "חיבור לידים מפייסבוק" };

/** What a lead supplier opens: one button to send the leads of their Facebook page's forms to Meitar. */
export default async function ConnectFacebookPage({ params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  const inv = await liveInvite(secret);
  return (
    <main className="login">
      <div className="login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-blue.webp" alt="מיתר נדל״ן והשקעות" />
        {inv ? (
          <>
            <h1>חיבור הלידים מפייסבוק לקבוצת מיתר</h1>
            <p className="sub">
              שלום {inv.supplier}. אחרי החיבור, כל ליד שנכנס בטפסי הלידים של העמוד שתבחרו, בפייסבוק או באינסטגרם, יגיע ישר לקבוצת מיתר. אין צורך ב-Make, ב-Zapier או בהעתקה ידנית.
            </p>
            <ul className="connect-points">
              <li>מתחברים עם משתמש הפייסבוק שמנהל את העמוד, ובוחרים את העמוד.</li>
              <li>קבוצת מיתר מקבלת רק את הלידים מהטפסים, ולא גישה לשום דבר אחר בעמוד.</li>
              <li>אפשר לנתק בכל רגע, בהגדרות העסק בפייסבוק.</li>
            </ul>
            <a className="btn primary full" href={`/api/meta/connect?invite=${encodeURIComponent(secret)}`}>
              התחברות עם פייסבוק
            </a>
          </>
        ) : (
          <>
            <h1>הקישור לא בתוקף</h1>
            <p className="sub">יכול להיות שעבר הזמן שלו או שבוטל. אפשר לבקש מקבוצת מיתר קישור חדש.</p>
          </>
        )}
      </div>
    </main>
  );
}
