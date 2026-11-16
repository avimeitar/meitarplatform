// Runs once when the server starts: base data (roles, projects), the first administrator, and task reminders.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootstrap } = await import("./lib/bootstrap");
  await bootstrap();
  // reminders for tasks that fall due, to the phones that turned them on
  if (process.env.DATABASE_URL) {
    const { startReminders } = await import("./lib/push");
    startReminders();
  }
}
