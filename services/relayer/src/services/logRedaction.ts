const REDACTED = "[redacted]" as const;

const HEX_64_RE = /^0x[0-9a-fA-F]{128}$/;
const HEX_32_RE = /^0x[0-9a-fA-F]{64}$/;
const HEX_VAR_RE = /^0x[0-9a-fA-F]+$/;
const SECRET_KEY_RE = /secret/i;

export interface RedactionRule {
  readonly key: RegExp | string;
  readonly replace: (raw: unknown) => unknown;
}

export const DEFAULT_REDACTION_RULES: ReadonlyArray<RedactionRule> = [
  { key: /nullifier[_]?secret/i, replace: () => REDACTED },
  { key: /trapdoor/i, replace: () => REDACTED },
  { key: /salt/i, replace: () => REDACTED },
  { key: /seed/i, replace: () => REDACTED },
  { key: /private[_]?key/i, replace: () => REDACTED },
  { key: /passphrase/i, replace: () => REDACTED },
  { key: /authorization/i, replace: () => REDACTED },
  { key: /bearer/i, replace: () => REDACTED },
  { key: /(^|[_-])ip($|[_-])/i, replace: () => REDACTED },
  { key: /remote[-_]?addr/i, replace: () => REDACTED },
  { key: /x-forwarded-for/i, replace: () => REDACTED },
  { key: /user[-_]agent/i, replace: () => REDACTED },
];

function looksLikeHexField(key: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (SECRET_KEY_RE.test(key)) return true;
  if (HEX_32_RE.test(value) && /commitment|nullifier|hash/i.test(key)) {
    return false;
  }
  if (HEX_64_RE.test(value) && /pub|address/i.test(key)) {
    return false;
  }
  if (HEX_VAR_RE.test(value) && /(secret|private|priv|sk|seed|salt|trap)/i.test(key)) {
    return true;
  }
  if (HEX_VAR_RE.test(value) && /proof|signature|sig/i.test(key)) {
    return true;
  }
  return false;
}

function redactValue(key: string, value: unknown, rules: ReadonlyArray<RedactionRule>): unknown {
  for (const rule of rules) {
    const matches = typeof rule.key === "string" ? key === rule.key : rule.key.test(key);
    if (matches) return rule.replace(value);
  }
  if (looksLikeHexField(key, value)) {
    return REDACTED;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(key, v, rules));
  }
  if (value !== null && typeof value === "object") {
    return redactObject(value as Record<string, unknown>, rules);
  }
  return value;
}

export function redactObject<T>(input: T, rules: ReadonlyArray<RedactionRule> = DEFAULT_REDACTION_RULES): T {
  if (input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.map((v) => redactValue("", v, rules)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = redactValue(k, v, rules);
  }
  return out as T;
}

export interface RedactingLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): RedactingLogger;
}

export interface RedactingLoggerOptions {
  readonly enabled: boolean;
  readonly sink?: (line: string) => void;
  readonly rules?: ReadonlyArray<RedactionRule>;
}

export function createRedactingLogger(options: RedactingLoggerOptions): RedactingLogger {
  const emit = (level: string, bindings: Record<string, unknown>, event: string, fields?: Record<string, unknown>): void => {
    if (!options.enabled) return;
    const merged = { ...bindings, ...(fields ?? {}) };
    const safe = redactObject(merged, options.rules);
    const line = JSON.stringify({ level, event, ...safe });
    if (options.sink) options.sink(line);
    else process.stdout.write(line + "\n");
  };

  const make = (bindings: Record<string, unknown>): RedactingLogger => ({
    info: (event, fields) => emit("info", bindings, event, fields),
    warn: (event, fields) => emit("warn", bindings, event, fields),
    error: (event, fields) => emit("error", bindings, event, fields),
    child: (extra) => make({ ...bindings, ...redactObject(extra, options.rules) }),
  });
  return make({});
}
