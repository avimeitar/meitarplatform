import { requirePageUser } from "@/lib/session";

export const metadata = { title: "ראשי" };

export default async function DashboardPage() {
  const u = await requirePageUser();
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>שלום, {u.firstName}</h1>
          <p className="sub">{u.roleName}</p>
        </div>
      </div>
    </section>
  );
}
