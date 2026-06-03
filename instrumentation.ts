export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Next 15 calls `onRequestError` to forward unhandled errors from the runtime
// into instrumentation. Sentry exports this under the captureRequestError name.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
