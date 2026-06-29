export interface RunSummary {
  readonly runId: string;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly counts: Readonly<Record<string, number>>;
  readonly buckets: Readonly<Record<string, number>>;
  readonly errors: ReadonlyArray<string>;
  readonly rootHashes: Readonly<Record<string, string>>;
  readonly wasmHash: string;
  readonly vkR0Hash: string;
  readonly vkR1Hash: string;
  readonly contractId: string;
  readonly txHashes: ReadonlyArray<string>;
  readonly extras: Readonly<Record<string, string | number | boolean>>;
}

export function buildRunSummary(args: {
  readonly runId: string;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly counts: Readonly<Record<string, number>>;
  readonly buckets: Readonly<Record<string, number>>;
  readonly errors: ReadonlyArray<string>;
  readonly rootHashes: Readonly<Record<string, string>>;
  readonly wasmHash: string;
  readonly vkR0Hash: string;
  readonly vkR1Hash: string;
  readonly contractId: string;
  readonly txHashes: ReadonlyArray<string>;
  readonly extras: Readonly<Record<string, string | number | boolean>>;
}): RunSummary {
  return args;
}

export function summaryToMarkdown(s: RunSummary): string {
  const lines: string[] = [];
  lines.push(`# Run summary — ${s.runId}`);
  lines.push("");
  lines.push("## Tool versions");
  for (const [k, v] of Object.entries(s.toolVersions)) lines.push(`- ${k}: \`${v}\``);
  lines.push("");
  lines.push("## Counts");
  for (const [k, v] of Object.entries(s.counts)) lines.push(`- ${k}: ${v}`);
  lines.push("");
  lines.push("## Bucket histogram");
  for (const [k, v] of Object.entries(s.buckets)) lines.push(`- bucket ${k}: ${v}`);
  lines.push("");
  lines.push("## Roots");
  for (const [k, v] of Object.entries(s.rootHashes)) lines.push(`- ${k}: \`${v}\``);
  lines.push("");
  lines.push("## Hashes");
  lines.push(`- contract: \`${s.contractId}\``);
  lines.push(`- wasm: \`${s.wasmHash}\``);
  lines.push(`- vk R0: \`${s.vkR0Hash}\``);
  lines.push(`- vk R1: \`${s.vkR1Hash}\``);
  lines.push("");
  lines.push("## Transactions");
  lines.push(`- ${s.txHashes.length} tx hash(es) recorded`);
  if (s.errors.length > 0) {
    lines.push("");
    lines.push("## Errors");
    for (const e of s.errors) lines.push(`- ${e}`);
  }
  lines.push("");
  lines.push("## Extras");
  for (const [k, v] of Object.entries(s.extras)) lines.push(`- ${k}: \`${String(v)}\``);
  return lines.join("\n") + "\n";
}
