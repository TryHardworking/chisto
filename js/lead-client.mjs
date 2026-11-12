// Dependency-free browser adapter. Copy this file to your frontend's public JS folder.
// It knows nothing about Telegram, the business type, prices, or Netlify credentials.
export class LeadClientError extends Error {
  constructor(code, { fields, retryAfter, uncertain = false } = {}) {
    super(code);
    this.name = "LeadClientError";
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
    this.uncertain = uncertain;
  }
}

export function createLeadClient(config, dependencies = {}) {
  const root = dependencies.baseUrl || globalThis.location?.href;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const cryptoImpl = dependencies.cryptoImpl || globalThis.crypto;
  const Abort = dependencies.AbortControllerImpl || globalThis.AbortController;
  const timeoutMs = dependencies.timeoutMs || 12000;
  let pending = false;
  let attempt;
  let endpoint;
  try {
    if (!config.endpoint) throw new Error();
    endpoint = new URL(config.endpoint, root);
    if (endpoint.origin !== new URL(root).origin || !["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error();
  } catch { throw new LeadClientError("INVALID_CONFIGURATION"); }
  if (typeof config.projectId !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(config.projectId) || config.projectId.length > 64 ||
    ["constructor", "prototype"].includes(config.projectId) || typeof config.consentVersion !== "string" || !config.consentVersion.trim() || config.consentVersion.length > 80 ||
    typeof fetchImpl !== "function" || typeof Abort !== "function" || typeof cryptoImpl?.randomUUID !== "function") {
    throw new LeadClientError("INVALID_CONFIGURATION");
  }

  return {
    get pending() { return pending; },
    async send(values) {
      if (pending) throw new LeadClientError("REQUEST_IN_PROGRESS");
      const payload = { ...values, projectId: config.projectId, consentVersion: config.consentVersion, currency: config.currency || "RUB" };
      delete payload.requestId;
      const signature = JSON.stringify(payload);
      if (!attempt || attempt.signature !== signature) attempt = { signature, requestId: cryptoImpl.randomUUID() };
      payload.requestId = attempt.requestId;
      const controller = new Abort();
      pending = true;
      let timeout;
      const deadline = new Promise((resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new LeadClientError("CONNECTION_UNCONFIRMED", { uncertain: true }));
        }, timeoutMs);
      });
      try {
        const result = await Promise.race([deadline, (async () => {
          const response = await fetchImpl(endpoint.href, {
            method: "POST", credentials: "same-origin", redirect: "error", signal: controller.signal,
            headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload),
          });
          if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|\s*$)/i.test(response.headers.get("Content-Type") || "")) {
            throw new LeadClientError("CONNECTION_UNCONFIRMED", { uncertain: true });
          }
          const result = await response.json();
          if (!response.ok || result?.accepted !== true) {
            const code = /^[A-Z_]{1,64}$/.test(result?.code || "") ? result.code : "CONNECTION_UNCONFIRMED";
            throw new LeadClientError(code, { fields: result?.fields,
              retryAfter: Number.isSafeInteger(result?.retryAfter) && result.retryAfter > 0 && result.retryAfter <= 86400 ? result.retryAfter : undefined,
              uncertain: ["CONNECTION_UNCONFIRMED", "DELIVERY_UNCERTAIN"].includes(code) });
          }
          return result;
        })()]);
        // Reset only after an explicit success. Keep the UUID on errors and timeouts.
        attempt = undefined;
        return result;
      } catch (error) {
        if (error instanceof LeadClientError) throw error;
        throw new LeadClientError("CONNECTION_UNCONFIRMED", { uncertain: true });
      } finally { clearTimeout(timeout); pending = false; }
    },
  };
}
