import { fileURLToPath } from "node:url";

process.env.DOORBELL_CONFIG_DIR = fileURLToPath(
    new URL("../.doorbell-dev/", import.meta.url),
);

await import("../dist/cli.js");