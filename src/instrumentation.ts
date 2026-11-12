// Once, when the server starts: follow an open claim and the agent's activity, page or no page.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { follow } = await import("./server/claim");
    const { watch } = await import("./server/watch");
    follow();
    watch();
  }
}
