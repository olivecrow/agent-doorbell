import { fileURLToPath } from "node:url";

export function getNotificationAssetPath(sound: "default" | "missing-api-key" = "default"): string {
    const filename = sound === "missing-api-key" ? "notification-no-key.mp3" : "notification.mp3";
    const assetUrl = new URL(`../../assets/${filename}`, import.meta.url);

    return fileURLToPath(assetUrl);
}
