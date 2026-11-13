// Runs once when the server starts: the worker records finished jobs, launches queued
// ones and notices stopped Computers whether or not a page is open.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./server/worker");
    startWorker();
  }
}
