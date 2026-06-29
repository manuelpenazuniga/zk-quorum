export interface AppConfig {
  readonly relayEndpoint: string;
  readonly circuitAvailable: boolean;
  readonly publicSchemaId: "PUBLIC_SCHEMA_V1_R0" | "PUBLIC_SCHEMA_V1_R1";
  readonly defaultNetworkPassphrase: string;
}

const DEFAULT_CONFIG: AppConfig = {
  relayEndpoint: "http://127.0.0.1:8787",
  circuitAvailable: false,
  publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
  defaultNetworkPassphrase: "Test SDF Network ; September 2015",
};

export function loadAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
