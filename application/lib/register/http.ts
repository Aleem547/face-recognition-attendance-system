import { RegisterError } from "./service.ts";

// Same-origin cookie authentication: mutations require the exact configured
// Origin and JSON, with no wildcard CORS or forwarded-host trust.
export function assertMutationRequest(request: Request, configuredOrigin: string | undefined) {
  if (!configuredOrigin) throw new RegisterError(503, "Authentication origin is not configured.");
  let expected: string;
  try { expected = new URL(configuredOrigin).origin; }
  catch { throw new RegisterError(503, "Authentication origin is not configured."); }
  if (request.headers.get("origin") !== expected) throw new RegisterError(403, "Untrusted request origin.");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new RegisterError(403, "Untrusted request origin.");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new RegisterError(415, "Use application/json.");
}
export async function readSmallJson(request: Request) {
  const limit = 16 * 1024;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new RegisterError(413, "Request is too large.");
  if (!request.body) throw new RegisterError(400, "A JSON body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RegisterError(413, "Request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new RegisterError(400, "Invalid JSON."); }
}
