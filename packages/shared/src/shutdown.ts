export function installShutdown(logger: { info: Function; error: Function }, close: () => Promise<void>): void {
  let stopping = false;
  const handler = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "graceful shutdown started");
    const timeout = setTimeout(() => {
      logger.error("graceful shutdown timed out");
      process.exit(1);
    }, 15_000);
    try {
      await close();
      clearTimeout(timeout);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "graceful shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void handler("SIGTERM"));
  process.on("SIGINT", () => void handler("SIGINT"));
}
