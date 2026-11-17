// Runs once when the server starts: the worker makes the scheduled checks and stops
// the Computer between them, whether or not a page is open.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./server/worker");
    startWorker();
  }
}
