export const metadata = { title: "מחיקת מידע" };

/** Public: how to have one's data deleted (Meta asks for this page). */
export default function DataDeletionPage() {
  return (
    <main className="legal" dir="rtl">
      <h1>מחיקת מידע</h1>
      <p>כדי למחוק את המידע שלך ממערכת הלקוחות של קבוצת מיתר:</p>
      <ol>
        <li>שולחים בקשה בוואטסאפ או במייל לקבוצת מיתר, עם השם ומספר הטלפון שהשארת בטופס.</li>
        <li>תוך 30 יום המידע נמחק מהמערכת, ונשלח אישור.</li>
      </ol>
      <p>אפשר גם לבקש קודם לראות איזה מידע שמור.</p>
      <hr />
      <section dir="ltr" lang="en">
        <h2>Data deletion instructions (English)</h2>
        <ol>
          <li>Send a request to Meitar Group by WhatsApp or email, with the name and phone number you submitted in the form.</li>
          <li>Your data is deleted from the system within 30 days, and you receive a confirmation.</li>
        </ol>
        <p>You can also ask first to see what data is stored.</p>
      </section>
    </main>
  );
}
