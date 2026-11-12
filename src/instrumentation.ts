// Runs once when the server starts: the worker records turns, fires schedules and
// watches for passkey requests whether or not a page is open.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./server/worker");
    startWorker();
  }
}
