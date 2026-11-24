// Runs once when the server starts: base data (roles, projects), the first administrator, task reminders, and the Lead Ads safety net.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootstrap } = await import("./lib/bootstrap");
  await bootstrap();
  // reminders for tasks that fall due, to the phones that turned them on
  if (process.env.DATABASE_URL) {
    const { startReminders } = await import("./lib/push");
    startReminders();
    // Facebook and Instagram leads the webhook may have missed (only once a Meta app is set)
    const { startMetaPull } = await import("./lib/metaLeads");
    startMetaPull();
  }
}
