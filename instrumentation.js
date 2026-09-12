// Starts the reminder scheduler once when the Next.js server boots.
// See lib/scheduler.js.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
