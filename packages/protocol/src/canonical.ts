/**
 * Genuinely canonical JSON: object keys are sorted recursively, arrays are
 * preserved in their original order, and `undefined` / functions are
 * dropped. `bigint` values are emitted as decimal strings with a `__bigint__`
 * tag so round-tripping is unambiguous; callers that want a hashable
 * canonical form should pre-convert bigints to their intended wire shape
 * (e.g. `"__bigint__:123"`) and the canonical form will then be stable.
 *
 * Map and Set are intentionally rejected: a JSON payload that contains one
 * is not JSON-serializable, and pretending otherwise is how hashes drift
 * between systems. Throw a clear error instead.
 */
import { ZkqProtocolError } from "./errors.js";

const BIGINT_TAG = "__bigint__:";

function canonicalise(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "bigint") return `${BIGINT_TAG}${value.toString()}`;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ZkqProtocolError("BUNDLE_INVALID", "non-finite number in canonical JSON", { value });
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj instanceof Map || obj instanceof Set) {
      throw new ZkqProtocolError("BUNDLE_INVALID", "Map/Set not allowed in canonical JSON");
    }
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      if (typeof v === "function") continue;
      out[k] = canonicalise(v);
    }
    return out;
  }
  throw new ZkqProtocolError("BUNDLE_INVALID", "unsupported value in canonical JSON", { type: typeof value });
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

export function isCanonicalJson(input: string): boolean {
  try {
    const parsed: unknown = JSON.parse(input);
    return JSON.stringify(canonicalise(parsed)) === input;
  } catch {
    return false;
  }
}