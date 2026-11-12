// Starts the habitat's clock with the server: residents wake whether or not anyone is watching.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startClock } = await import("./engine/scheduler");
    startClock();
  }
}
