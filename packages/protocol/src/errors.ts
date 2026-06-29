export const ZKQ_PROTOCOL_ERROR_TAG = "ZKQ_PROTOCOL_ERROR" as const;

export type ZkqErrorCode =
  | "SCOPE_DERIVATION_FAILED"
  | "INVALID_HEX"
  | "INVALID_HEX_LENGTH"
  | "INVALID_BYTE_LENGTH"
  | "INVALID_OPTION_COUNT"
  | "INVALID_VOTE_RANGE"
  | "INVALID_SCHEMA_VERSION"
  | "INVALID_SIGNAL_COUNT"
  | "INVALID_SIGNAL_KIND"
  | "INVALID_FIELD_ELEMENT"
  | "INVALID_VK_HASH"
  | "MISSING_PUBLIC_SIGNAL"
  | "MANIFEST_INVALID"
  | "ARTIFACT_HASH_MISMATCH"
  | "ARTIFACT_MISSING"
  | "BUNDLE_INVALID"
  | "BUNDLE_HASH_MISMATCH"
  | "EVENT_SCHEMA_MISMATCH"
  | "NULLIFIER_DUPLICATE"
  | "R1_NON_ZERO_SALT"
  | "R1_REVEAL_MISMATCH"
  | "R1_REVEAL_DUPLICATE"
  | "R1_NOT_REVEALED"
  | "TALLY_BUCKET_OUT_OF_RANGE"
  | "TALLY_OVERFLOW"
  | "VOTER_AUTH_FORBIDDEN"
  | "ELECTRON_SCOPE_MISMATCH"
  | "ELECTION_NOT_OPEN"
  | "ELECTION_NOT_FOUND"
  | "WASM_HASH_MISMATCH"
  | "ADAPTER_NOT_CONFIGURED"
  | "RELAYER_RATE_LIMITED"
  | "RELAYER_PAYLOAD_TOO_LARGE"
  | "RELAYER_IDEMPOTENT_REPLAY";

export class ZkqProtocolError extends Error {
  public readonly code: ZkqErrorCode;
  public readonly detail: Record<string, unknown> | undefined;

  constructor(code: ZkqErrorCode, message: string, detail?: Record<string, unknown>) {
    super(`[${ZKQ_PROTOCOL_ERROR_TAG}:${code}] ${message}`);
    this.name = "ZkqProtocolError";
    this.code = code;
    if (detail !== undefined) {
      this.detail = Object.freeze({ ...detail });
    }
  }

  public toJSON(): { name: string; code: ZkqErrorCode; message: string; detail?: Record<string, unknown> } {
    const base: { name: string; code: ZkqErrorCode; message: string; detail?: Record<string, unknown> } = {
      name: this.name,
      code: this.code,
      message: this.message,
    };
    if (this.detail !== undefined) base.detail = this.detail;
    return base;
  }
}

export function isZkqProtocolError(value: unknown): value is ZkqProtocolError {
  return value instanceof ZkqProtocolError;
}
