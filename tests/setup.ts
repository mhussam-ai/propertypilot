import { randomBytes } from "node:crypto";

// AES-256-GCM key for crypto tests — fresh each suite, never committed.
if (!process.env.KMS_KEY_B64) {
  process.env.KMS_KEY_B64 = randomBytes(32).toString("base64");
}

// Default env so the webhook auth helper has something to compare against.
if (!process.env.BOLNA_WEBHOOK_SOURCE_IPS) {
  process.env.BOLNA_WEBHOOK_SOURCE_IPS = "13.203.39.153";
}

if (!process.env.NODE_ENV) {
  Object.defineProperty(process.env, "NODE_ENV", { value: "test" });
}
