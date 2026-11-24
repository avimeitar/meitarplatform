export const metadata = { title: "מדיניות פרטיות" };

/** Public: the privacy policy that Meta asks for (in Hebrew, and in English for Meta's reviewers). */
export default function PrivacyPage() {
  return (
    <main className="legal" dir="rtl">
      <h1>מדיניות פרטיות: מערכת הלקוחות של קבוצת מיתר</h1>
      <p>המערכת משמשת את קבוצת מיתר נדל״ן והשקעות לניהול פניות של לקוחות שהתעניינו בפרויקטים שלה.</p>
      <h2>איזה מידע נאסף</h2>
      <p>שם, טלפון, אימייל ותשובות לשאלות בטופס, כשאדם ממלא טופס לידים (כולל טפסי לידים בפייסבוק ובאינסטגרם) או פונה אלינו. בנוסף נשמרים פרטי הקמפיין או הטופס שממנו הגיעה הפנייה.</p>
      <h2>למה</h2>
      <p>כדי לחזור לפונים, לתאם פגישות ולטפל בפנייה. המידע לא נמכר ולא מועבר לאחרים, ומשמש רק את קבוצת מיתר.</p>
      <h2>איך הוא נשמר</h2>
      <p>במסד נתונים מאובטח, עם גישה לעובדי קבוצת מיתר בלבד, לפי הרשאות. גישה לפייסבוק נשמרת מוצפנת, ומשמשת רק לקריאת לידים מטפסי הלידים.</p>
      <h2>מחיקת מידע</h2>
      <p>
        אפשר לבקש לעיין במידע או למחוק אותו. ההוראות בעמוד <a href="/data-deletion">מחיקת מידע</a>.
      </p>
      <hr />
      <section dir="ltr" lang="en">
        <h2>Privacy policy (English)</h2>
        <p>
          This system is used by Meitar Group (Meitar Real Estate &amp; Investments) to manage inquiries from people interested in its projects. When someone fills out a lead form,
          including Facebook and Instagram Lead Ads forms, we collect the details they submit (name, phone, email and form answers) and the campaign or form it came from.
        </p>
        <p>
          The data is used only to contact the person about their inquiry and to schedule meetings. It is not sold or shared with third parties. It is stored in a secured database
          accessible only to Meitar Group staff, by role. Facebook access tokens are stored encrypted and are used only to read leads from Lead Ads forms.
        </p>
        <p>
          To access or delete your data, see <a href="/data-deletion">data deletion instructions</a>.
        </p>
      </section>
    </main>
  );
}
