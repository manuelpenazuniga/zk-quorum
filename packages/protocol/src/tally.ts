import { ZKQ_DEFAULT_TALLY_BUCKETS } from "./version.js";
import type { NullifierHash, TallyBucket } from "./ids.js";
import { ZkqProtocolError } from "./errors.js";
import { bytesToBigEndianBigInt, hexToBytes, assertByteLength } from "./hash.js";

export interface TallyBucketLayout {
  readonly count: number;
}

export const DEFAULT_TALLY_BUCKET_LAYOUT: TallyBucketLayout = Object.freeze({
  count: ZKQ_DEFAULT_TALLY_BUCKETS,
});

export function bucketForNullifier(nullifier: NullifierHash, layout: TallyBucketLayout = DEFAULT_TALLY_BUCKET_LAYOUT): TallyBucket {
  const bytes = hexToBytes(nullifier);
  assertByteLength(bytes, 32, "nullifierHash");
  const big = bytesToBigEndianBigInt(bytes);
  const idx = Number(big & 0x0fn);
  if (idx < 0 || idx >= layout.count) {
    throw new ZkqProtocolError("TALLY_BUCKET_OUT_OF_RANGE", "computed bucket out of range", { idx, layout: layout.count });
  }
  return idx;
}

export interface TallyCell {
  readonly bucket: TallyBucket;
  readonly option: number;
  readonly count: bigint;
}

export interface TallyState {
  readonly buckets: number;
  readonly options: number;
  readonly cells: ReadonlyMap<string, bigint>;
}

function cellKey(bucket: TallyBucket, option: number): string {
  return `${bucket}:${option}`;
}

export function createTallyState(options: number, buckets: number = DEFAULT_TALLY_BUCKET_LAYOUT.count): TallyState {
  if (!Number.isInteger(options) || options < 1) {
    throw new ZkqProtocolError("INVALID_OPTION_COUNT", "options must be a positive integer", { options });
  }
  if (!Number.isInteger(buckets) || buckets < 1 || buckets > 256) {
    throw new ZkqProtocolError("TALLY_BUCKET_OUT_OF_RANGE", "bucket count must be in [1, 256]", { buckets });
  }
  return { buckets, options, cells: new Map() };
}

export function incrementTally(state: TallyState, bucket: TallyBucket, option: number, by: bigint = 1n): TallyState {
  if (option < 0 || option >= state.options) {
    throw new ZkqProtocolError("INVALID_VOTE_RANGE", "option out of range", { option, max: state.options });
  }
  if (bucket < 0 || bucket >= state.buckets) {
    throw new ZkqProtocolError("TALLY_BUCKET_OUT_OF_RANGE", "bucket out of range", { bucket, max: state.buckets });
  }
  if (by < 0n) {
    throw new ZkqProtocolError("TALLY_OVERFLOW", "tally increment must be non-negative", { by: by.toString() });
  }
  const key = cellKey(bucket, option);
  const prev = state.cells.get(key) ?? 0n;
  const next = prev + by;
  const cells = new Map(state.cells);
  cells.set(key, next);
  return { buckets: state.buckets, options: state.options, cells };
}

export function tallyTotal(state: TallyState, option: number): bigint {
  if (option < 0 || option >= state.options) {
    throw new ZkqProtocolError("INVALID_VOTE_RANGE", "option out of range", { option, max: state.options });
  }
  let total = 0n;
  for (let b = 0; b < state.buckets; b += 1) {
    total += state.cells.get(cellKey(b, option)) ?? 0n;
  }
  return total;
}

export function tallyAll(state: TallyState): bigint[] {
  const out: bigint[] = new Array(state.options).fill(0n);
  for (let opt = 0; opt < state.options; opt += 1) {
    out[opt] = tallyTotal(state, opt);
  }
  return out;
}
