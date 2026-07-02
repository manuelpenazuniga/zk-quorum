// Minimal type declarations for snarkjs 0.7.6 (BLS12-381 / Groth16).
// The library does not ship its own types.

declare module "snarkjs" {
  export namespace groth16 {
    /**
     * Generate a Groth16 proof.
     * @param input — circuit input signals as a plain object
     * @param wasmFile — URL or path to the circuit WASM
     * @param zkeyFile — URL or path to the proving key
     * @param logger — optional logger
     */
    function fullProve(
      input: Record<string, unknown>,
      wasmFile: string,
      zkeyFile: string,
      logger?: { info: (msg: string) => void },
    ): Promise<{
      proof: {
        protocol: string;
        curve: string;
        pi_a: [string, string, string];
        pi_b: [[string, string], [string, string], [string, string]];
        pi_c: [string, string, string];
      };
      publicSignals: string[];
    }>;

    /**
     * Verify a Groth16 proof against a verification key.
     * @param vk — verification key JSON object
     * @param publicSignals — array of decimal Fr strings
     * @param proof — proof JSON object
     * @returns true if the proof is valid
     */
    function verify(
      vk: object,
      publicSignals: string[],
      proof: object,
    ): Promise<boolean>;
  }
}
