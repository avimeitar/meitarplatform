import { Shell } from "@/components/Shell";
import { SetupNotice } from "@/components/SetupNotice";
import { appBaseURL, authConfigured } from "@/lib/auth";
import { shellData } from "@/lib/crm/queries";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cfg = authConfigured();
  if (!cfg.ok) return <SetupNotice missing={cfg.missing} />;
  const user = await requirePageUser();
  const { counts, projects, people, shift, meetingHost, lists } = await shellData(user);
  return (
    <Shell user={{ id: user.id, name: user.name, firstName: user.firstName, roleName: user.roleName, permissions: user.permissions }} counts={counts} projects={projects} people={people} shift={shift} meetingHost={meetingHost} lists={lists} appUrl={appBaseURL()}>
      {children}
    </Shell>
  );
}
