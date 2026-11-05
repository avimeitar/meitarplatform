"use server";

import { headers } from "next/headers";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getCurrentUser, requestIp } from "@/lib/session";

export async function signOutAction(): Promise<void> {
  const u = await getCurrentUser();
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch {
    // already signed out
  }
  if (u) await audit({ actorId: u.id, actorName: u.name, action: "auth.logout", ip: await requestIp() });
}
