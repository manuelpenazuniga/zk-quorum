export type Hex = `0x${string}`;

export type Bytes32Hex = `0x${string}`;
export type Bytes64Hex = `0x${string}`;
export type BytesVarHex = Hex;

export type ElectionId = Bytes32Hex;
export type NullifierHash = Bytes32Hex;
export type BallotCommitment = Bytes32Hex;
export type RootHash = Bytes32Hex;
export type CredentialCommitment = Bytes32Hex;
export type PublicKeyHex = Bytes64Hex;
export type Sha256Hex = Bytes32Hex;
export type Salt32 = Bytes32Hex;
export type VoteValue = number;
export type OptionCount = number;
export type UnixSeconds = number;
export type TallyBucket = number;

export const HEX32_RE = /^0x[0-9a-fA-F]{64}$/;
export const HEX64_RE = /^0x[0-9a-fA-F]{128}$/;

export function isHex32(value: unknown): value is Bytes32Hex {
  return typeof value === "string" && HEX32_RE.test(value);
}

export function isHex64(value: unknown): value is Bytes64Hex {
  return typeof value === "string" && HEX64_RE.test(value);
}

export function isHex(value: unknown): value is Hex {
  if (typeof value !== "string" || !value.startsWith("0x")) return false;
  const body = value.slice(2);
  if (!/^[0-9a-fA-F]*$/.test(body)) return false;
  return body.length % 2 === 0;
}
