import { prisma } from "@/lib/db";
import { availableChannels } from "@/lib/otp";
import { formatPhone } from "@/lib/phone";
import { requirePageUser } from "@/lib/session";
import { AccountScreen } from "./AccountScreen";

export const metadata = { title: "החשבון שלי" };

export default async function AccountPage() {
  const me = await requirePageUser();
  const u = await prisma.user.findUniqueOrThrow({ where: { id: me.id }, select: { otpChannel: true, phoneNumber: true } });
  const sessions = await prisma.session.count({ where: { userId: me.id, expiresAt: { gt: new Date() } } });
  return <AccountScreen name={me.name} roleName={me.roleName} phone={formatPhone(u.phoneNumber)} channel={u.otpChannel === "whatsapp" ? "whatsapp" : "sms"} channels={availableChannels()} sessions={sessions} />;
}
