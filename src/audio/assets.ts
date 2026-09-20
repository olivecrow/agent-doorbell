import { fileURLToPath } from "node:url";

export function getNotificationAssetPath(): string {
    const assetUrl = new URL("../../assets/notification.mp3", import.meta.url);

    return fileURLToPath(assetUrl);
}
