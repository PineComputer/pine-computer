// Runs once when the server starts: the worker follows each run as it happens, launches
// queued ones and notices a stopped Computer whether or not a page is open.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./server/worker");
    startWorker();
  }
}
