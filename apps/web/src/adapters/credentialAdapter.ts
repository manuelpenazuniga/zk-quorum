export interface CredentialInput {
  readonly electionId: `0x${string}`;
  readonly publicSchemaId: "PUBLIC_SCHEMA_V1_R0" | "PUBLIC_SCHEMA_V1_R1";
  readonly nullifierSecret: string;
  readonly trapdoor: string;
  readonly label: string;
  readonly stateRoot: `0x${string}`;
  readonly associationRoot: `0x${string}`;
  readonly electionScope: `0x${string}`;
  readonly optionCount: number;
  readonly vote?: number;
  readonly salt?: string;
}

export interface DerivedCredential {
  readonly credentialCommitment: `0x${string}`;
  readonly nullifierHash: `0x${string}`;
  readonly ballotCommitment: `0x${string}` | null;
  readonly publicSignals: ReadonlyArray<string>;
}

export interface CredentialAdapter {
  readonly id: string;
  derive(input: CredentialInput): Promise<DerivedCredential>;
}

export const PENDING_CREDENTIAL_REASON = "credential-derivation-pending" as const;
