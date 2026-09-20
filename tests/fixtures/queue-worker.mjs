import { FileDeliveryQueue } from "../../dist/coordination/file-delivery-queue.js";
const [directory, hold, source] = process.argv.slice(2);
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
try {
  const lease = await new FileDeliveryQueue(directory, 10000).acquire(
    source,
    controller.signal,
  );
  console.log(JSON.stringify({ event: "acquired", source, time: Date.now() }));
  await new Promise((resolve) => setTimeout(resolve, Number(hold)));
  await lease.release();
  console.log(JSON.stringify({ event: "released", source, time: Date.now() }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
