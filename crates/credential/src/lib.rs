// SPDX-License-Identifier: MIT
// Credential crate: Poseidon P2/P3seq hashing and electionScope derivation
//
// Composes Poseidon255(2) hashes exactly as Circom poseidon255.circom.
// Never uses Poseidon(3) directly — only P2(P2(a,b),c) for 3-input composition.
//
// electionScope: SHA-256 domain-separated with rejection sampling to BLS12-381 Fr,
// producing a canonical 32-byte big-endian scalar.
//
// Matches plan §§5-6, D-007.

#![no_std]

extern crate alloc;

use alloc::vec::Vec;
use core::cmp::Ordering;
use soroban_poseidon::poseidon_hash;
use soroban_sdk::{crypto::bls12_381::Fr as BlsScalar, Bytes, BytesN, Env};

pub const ELECTION_SCOPE_DOMAIN_TAG: &[u8] = b"zk-quorum:election-scope:v1";
pub const ELECTION_SCOPE_MAX_ATTEMPTS: u8 = 255;

/// BLS12-381 scalar modulus as big-endian bytes.
const BLS12_381_SCALAR_MODULUS: [u8; 32] = [
    0x73, 0xED, 0xA7, 0x53, 0x29, 0x9D, 0x7D, 0x48, 0x33, 0x39, 0xD8, 0x08, 0x09, 0xA1, 0xD8, 0x05,
    0x53, 0xBD, 0xA4, 0x02, 0xFF, 0xFE, 0x5B, 0xFE, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x01,
];

/// P2(a, b) = Poseidon255 of two inputs.
/// Equivalent to Poseidon255(2) in Circom.
/// Uses soroban-poseidon with T=3 (rate=2) on BLS12-381.
pub fn p2(env: &Env, a: &BlsScalar, b: &BlsScalar) -> BlsScalar {
    let inputs = soroban_sdk::vec![env, a.to_u256(), b.to_u256(),];
    let result_u256 = poseidon_hash::<3, BlsScalar>(env, &inputs);
    BlsScalar::from_u256(result_u256)
}

/// P3seq(a, b, c) = P2(P2(a, b), c).
/// Sequential composition of two Poseidon255(2) calls.
/// Never uses Poseidon(3) directly.
pub fn p3seq(env: &Env, a: &BlsScalar, b: &BlsScalar, c: &BlsScalar) -> BlsScalar {
    let inner = p2(env, a, b);
    p2(env, &inner, c)
}

/// Compute credential commitment = P2(label, P2(nullifierSecret, trapdoor)).
pub fn compute_credential_commitment(
    env: &Env,
    label: &BlsScalar,
    nullifier_secret: &BlsScalar,
    trapdoor: &BlsScalar,
) -> BlsScalar {
    let precommitment = p2(env, nullifier_secret, trapdoor);
    p2(env, label, &precommitment)
}

/// Compute nullifier hash = P2(nullifierSecret, electionScope).
pub fn compute_nullifier_hash(
    env: &Env,
    nullifier_secret: &BlsScalar,
    election_scope: &BlsScalar,
) -> BlsScalar {
    p2(env, nullifier_secret, election_scope)
}

/// Compute ballot commitment = P2(P2(vote, salt), electionScope).
pub fn compute_ballot_commitment(
    env: &Env,
    vote: &BlsScalar,
    salt: &BlsScalar,
    election_scope: &BlsScalar,
) -> BlsScalar {
    p3seq(env, vote, salt, election_scope)
}

/// Error for election scope derivation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ElectionScopeError {
    RejectionSamplingExhausted,
}

/// Derive electionScope from network, contract, election ID using SHA-256 + rejection sampling.
///
/// Algorithm (plan §5.1):
///   message = len(domain_tag) || domain_tag || len(network) || network
///          || len(contract_id) || contract_id || len(election_id) || election_id
///   for counter in 0..=255:
///     digest = SHA-256(message || counter_u8)
///     if 0 < bigint(digest) < BLS12_381_SCALAR_MODULUS:
///       return (digest as canonical 32-byte big-endian, counter)
///   fail
///
/// Lengths are encoded as u32 big-endian.
/// This is a host-side tooling function; the contract stores the pre-computed scope.
///
/// Returns the canonical 32-byte scope and the accepted counter.
pub fn derive_election_scope_with_counter(
    env: &Env,
    network_passphrase: &[u8],
    contract_id: &[u8; 32],
    election_id: &[u8; 32],
) -> Result<(BytesN<32>, u8), ElectionScopeError> {
    let mut message = build_scope_message(network_passphrase, contract_id, election_id);

    for counter in 0..=ELECTION_SCOPE_MAX_ATTEMPTS {
        message.push(counter);

        let input_bytes = Bytes::from_slice(env, &message);
        let digest = env.crypto().sha256(&input_bytes);
        let digest_arr: [u8; 32] = digest.to_array();

        if !slice_is_zero(&digest_arr) && slice_is_lt_modulus(&digest_arr) {
            return Ok((digest.to_bytes(), counter));
        }

        message.pop();
    }

    Err(ElectionScopeError::RejectionSamplingExhausted)
}

/// Convenience wrapper: derive electionScope, discarding the counter.
/// Equivalent to `derive_election_scope_with_counter(...).map(|(s, _)| s)`.
pub fn derive_election_scope(
    env: &Env,
    network_passphrase: &[u8],
    contract_id: &[u8; 32],
    election_id: &[u8; 32],
) -> Result<BytesN<32>, ElectionScopeError> {
    derive_election_scope_with_counter(env, network_passphrase, contract_id, election_id)
        .map(|(scope, _counter)| scope)
}

/// Build the fixed-length prefix of the scope derivation message (without the counter byte).
/// Exposed for testing the exact message length vector.
fn build_scope_message(
    network_passphrase: &[u8],
    contract_id: &[u8; 32],
    election_id: &[u8; 32],
) -> Vec<u8> {
    let domain_tag = ELECTION_SCOPE_DOMAIN_TAG;
    let mut message: Vec<u8> = Vec::new();

    message.extend_from_slice(&(domain_tag.len() as u32).to_be_bytes());
    message.extend_from_slice(domain_tag);

    message.extend_from_slice(&(network_passphrase.len() as u32).to_be_bytes());
    message.extend_from_slice(network_passphrase);

    message.extend_from_slice(&(32_u32).to_be_bytes());
    message.extend_from_slice(contract_id);

    message.extend_from_slice(&(32_u32).to_be_bytes());
    message.extend_from_slice(election_id);

    message
}

/// Returns the prefix message length (excluding counter byte) for a given scope derivation.
/// Used to validate the exact message length for ledger vectors.
pub fn scope_message_len(network_passphrase: &[u8]) -> usize {
    let domain_tag = ELECTION_SCOPE_DOMAIN_TAG;
    4 + domain_tag.len() + 4 + network_passphrase.len() + 4 + 32 + 4 + 32
}

fn slice_is_zero(slice: &[u8]) -> bool {
    slice.iter().all(|&b| b == 0)
}

fn slice_is_lt_modulus(candidate: &[u8]) -> bool {
    for i in 0..32 {
        match candidate[i].cmp(&BLS12_381_SCALAR_MODULUS[i]) {
            Ordering::Less => return true,
            Ordering::Greater => return false,
            Ordering::Equal => continue,
        }
    }
    false
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{BytesN, Env, U256};

    fn env() -> Env {
        Env::default()
    }

    fn scalar_from_u64(val: u64) -> BlsScalar {
        let env = env();
        BlsScalar::from_u256(U256::from_u128(&env, val as u128))
    }

    fn scalar_from_str(env: &Env, s: &str) -> BlsScalar {
        use std::str::FromStr;
        let n = num_bigint::BigUint::from_str(s).unwrap();
        let bytes = n.to_bytes_be();
        let mut padded = [0u8; 32];
        let start = 32usize.saturating_sub(bytes.len());
        padded[start..].copy_from_slice(&bytes);
        BlsScalar::from_bytes(BytesN::from_array(env, &padded))
    }

    fn scope_to_scalar(_env: &Env, scope: &BytesN<32>) -> BlsScalar {
        BlsScalar::from_bytes(scope.clone())
    }

    #[test]
    fn test_golden_p2_1_2() {
        let env = env();
        let a = scalar_from_u64(1);
        let b = scalar_from_u64(2);
        let result = p2(&env, &a, &b);
        let expected = scalar_from_str(
            &env,
            "28821147804331559602169231704816259064962739503761913593647409715501647586810",
        );
        assert_eq!(result, expected, "P2(1, 2) golden vector mismatch");
    }

    #[test]
    fn test_golden_p3seq_1_2_3() {
        let env = env();
        let a = scalar_from_u64(1);
        let b = scalar_from_u64(2);
        let c = scalar_from_u64(3);
        let result = p3seq(&env, &a, &b, &c);
        let expected = scalar_from_str(
            &env,
            "25449209717923527142952704227728043701726876483169650107300041471510623667078",
        );
        assert_eq!(result, expected, "P2(P2(1,2), 3) golden vector mismatch");
    }

    #[test]
    fn test_golden_p2_0_0() {
        let env = env();
        let a = scalar_from_u64(0);
        let b = scalar_from_u64(0);
        let result = p2(&env, &a, &b);
        let expected = scalar_from_str(
            &env,
            "51576823595707970152643159819788304363803754756066229172775779360774743019614",
        );
        assert_eq!(result, expected, "P2(0, 0) golden vector mismatch");
    }

    #[test]
    fn test_golden_p2_large() {
        let env = env();
        let a = scalar_from_u64(1234567890);
        let b = scalar_from_u64(9876543210);
        let result = p2(&env, &a, &b);
        let expected = scalar_from_str(
            &env,
            "27771607038322859082949799815786464601077828110800763259574488164592802051706",
        );
        assert_eq!(result, expected, "P2(large, large) golden vector mismatch");
    }

    #[test]
    fn test_golden_credential_commitment() {
        let env = env();
        let label = scalar_from_u64(111);
        let nullifier_secret = scalar_from_u64(222);
        let trapdoor = scalar_from_u64(333);
        let result = compute_credential_commitment(&env, &label, &nullifier_secret, &trapdoor);
        let expected = scalar_from_str(
            &env,
            "33380155885179640208912473019492003279421010499170178573196933234221612903872",
        );
        assert_eq!(
            result, expected,
            "credential commitment golden vector mismatch"
        );
    }

    #[test]
    fn test_p3seq_matches_sequential_p2() {
        let env = env();
        let a = scalar_from_u64(42);
        let b = scalar_from_u64(99);
        let c = scalar_from_u64(17);
        let sequential = {
            let inner = p2(&env, &a, &b);
            p2(&env, &inner, &c)
        };
        let composed = p3seq(&env, &a, &b, &c);
        assert_eq!(
            sequential, composed,
            "P3seq should equal sequential P2 calls"
        );
    }

    #[test]
    fn test_p2_different_inputs_different_outputs() {
        let env = env();
        let r1 = p2(&env, &scalar_from_u64(1), &scalar_from_u64(2));
        let r2 = p2(&env, &scalar_from_u64(1), &scalar_from_u64(3));
        assert_ne!(r1, r2);
    }

    // ── Ledger §13 canonical scope vectors (exact bytes, counter, message length) ──

    #[test]
    fn test_ledger_scope_vector_a() {
        let env = env();
        let network = b"Test SDF Network ; September 2015";
        let contract_id = [0x11u8; 32];
        let election_id = [0x22u8; 32];

        let msg_len = scope_message_len(network);
        assert_eq!(msg_len, 140, "ledger §13: vector A message length must be 140");

        let (scope, counter) =
            derive_election_scope_with_counter(&env, network, &contract_id, &election_id).unwrap();

        assert_eq!(counter, 0, "ledger §13: vector A counter must be 0");
        let expected: [u8; 32] = hex_literal::hex!("0b667e4a71d35199a50ec46d35ad8112c97537ed9cba84eebbc51080106130a8");
        assert_eq!(scope.to_array(), expected, "ledger §13: vector A exact scope mismatch");
    }

    #[test]
    fn test_ledger_scope_vector_b() {
        let env = env();
        let network = b"Public Global Stellar Network ; September 2015";
        let contract_id = [0xAAu8; 32];
        let election_id = [0xBBu8; 32];

        let (scope, counter) =
            derive_election_scope_with_counter(&env, network, &contract_id, &election_id).unwrap();

        assert_eq!(counter, 1, "ledger §13: vector B counter must be 1");
        let expected: [u8; 32] = hex_literal::hex!("1a2d555082335dcf53d47a6e31cbdb1076a1c1f41d5ceca38421a55b01f4abb2");
        assert_eq!(scope.to_array(), expected, "ledger §13: vector B exact scope mismatch");
    }

    #[test]
    fn test_ledger_scope_vector_c() {
        let env = env();
        let network = b"Test SDF Network ; September 2015";
        let contract_id = [0x01u8; 32];
        let election_id = [0xFFu8; 32];

        let (scope, counter) =
            derive_election_scope_with_counter(&env, network, &contract_id, &election_id).unwrap();

        assert_eq!(counter, 3, "ledger §13: vector C counter must be 3");
        let expected: [u8; 32] = hex_literal::hex!("3042d22d781a4aa3b7cc9cd7d903ccf84d0de242657dbe616b181b6d09a4382c");
        assert_eq!(scope.to_array(), expected, "ledger §13: vector C exact scope mismatch");
    }

    // ── Backward-compatible API & general properties ──

    #[test]
    fn test_election_scope_derivation() {
        let env = env();
        let network = b"Test SDF Network ; September 2015";
        let contract_id = [0xABu8; 32];
        let election_id = [0x42u8; 32];

        let scope = derive_election_scope(&env, network, &contract_id, &election_id).unwrap();
        assert_eq!(scope.to_array().len(), 32);
        assert!(!slice_is_zero(&scope.to_array()));

        let scope2 = derive_election_scope(&env, network, &contract_id, &election_id).unwrap();
        assert_eq!(scope, scope2, "electionScope must be deterministic");
    }

    #[test]
    fn test_election_scope_different_network() {
        let env = env();
        let contract_id = [0xABu8; 32];
        let election_id = [0x42u8; 32];

        let scope1 = derive_election_scope(&env, b"Network A", &contract_id, &election_id).unwrap();
        let scope2 = derive_election_scope(&env, b"Network B", &contract_id, &election_id).unwrap();
        assert_ne!(scope1, scope2);
    }

    #[test]
    fn test_election_scope_different_election() {
        let env = env();
        let network = b"Test SDF Network ; September 2015";
        let contract_id = [0xABu8; 32];

        let scope1 = derive_election_scope(&env, network, &contract_id, &[0x01u8; 32]).unwrap();
        let scope2 = derive_election_scope(&env, network, &contract_id, &[0x02u8; 32]).unwrap();
        assert_ne!(scope1, scope2);
    }

    #[test]
    fn test_derive_election_scope_with_counter_consistency() {
        let env = env();
        let network = b"Test SDF Network ; September 2015";
        let contract_id = [0xCDu8; 32];
        let election_id = [0xEFu8; 32];

        let (scope_with_counter, _counter) =
            derive_election_scope_with_counter(&env, network, &contract_id, &election_id).unwrap();
        let scope = derive_election_scope(&env, network, &contract_id, &election_id).unwrap();
        assert_eq!(scope_with_counter, scope, "backward-compat: derive_election_scope must match derive_election_scope_with_counter");
    }

    #[test]
    fn test_nullifier_scope_binding() {
        let env = env();
        let secret = scalar_from_u64(999);

        let scope1 = derive_election_scope(&env, b"Testnet", &[0x01u8; 32], &[0x01u8; 32]).unwrap();
        let scope2 = derive_election_scope(&env, b"Testnet", &[0x01u8; 32], &[0x02u8; 32]).unwrap();

        let scope1_scalar = scope_to_scalar(&env, &scope1);
        let scope2_scalar = scope_to_scalar(&env, &scope2);

        let n1 = compute_nullifier_hash(&env, &secret, &scope1_scalar);
        let n2 = compute_nullifier_hash(&env, &secret, &scope2_scalar);
        assert_ne!(
            n1, n2,
            "Different scopes should produce different nullifiers"
        );
    }

    #[test]
    fn test_ballot_commitment_structure() {
        let env = env();
        let vote = scalar_from_u64(3);
        let salt = scalar_from_u64(1234567890);
        let scope_bytes =
            derive_election_scope(&env, b"Testnet", &[0x01u8; 32], &[0x01u8; 32]).unwrap();
        let scope = scope_to_scalar(&env, &scope_bytes);

        let commitment = compute_ballot_commitment(&env, &vote, &salt, &scope);

        let expected = {
            let inner = p2(&env, &vote, &salt);
            p2(&env, &inner, &scope)
        };
        assert_eq!(commitment, expected);
    }

    // ── Non-ASCII UTF-8 parity vector ──

    #[test]
    fn test_election_scope_non_ascii_utf8() {
        // Verifies scope derivation handles multi-byte UTF-8 characters correctly.
        // The network passphrase contains: é (U+00E9, 2 bytes), — (U+2014, 3 bytes),
        // and CJK characters (3 bytes each).
        let env = env();
        let network: &[u8] = "Stellar r\u{00E9}seau de test \u{2014} \u{6D4B}\u{8BD5}\u{7F51}\u{7EDC}".as_bytes();
        let contract_id = [0xCDu8; 32];
        let election_id = [0xEFu8; 32];

        // Char count ≠ byte count: 35 chars, byte length > 35
        let byte_len = network.len();
        let char_count = std::str::from_utf8(network).unwrap().chars().count();
        assert!(
            byte_len > char_count,
            "Non-ASCII network: byte length ({}) must exceed char count ({})",
            byte_len, char_count
        );

        let msg_len = scope_message_len(network);
        // Verify message length accounts for byte length, not char count
        let domain_tag = ELECTION_SCOPE_DOMAIN_TAG;
        let expected_msg_len = 4 + domain_tag.len() + 4 + byte_len + 4 + 32 + 4 + 32;
        assert_eq!(msg_len, expected_msg_len, "scope_message_len must use byte length");

        // Derivation must succeed (not crash, not produce zero)
        let scope = derive_election_scope(&env, network, &contract_id, &election_id).unwrap();
        assert!(!slice_is_zero(&scope.to_array()));
        assert_eq!(scope.to_array().len(), 32);

        // Determinism check
        let scope2 = derive_election_scope(&env, network, &contract_id, &election_id).unwrap();
        assert_eq!(scope, scope2, "Non-ASCII scope must be deterministic");
    }

    // ── nullifierSecret=0 trust boundary documentation ──

    /// Trust boundary: nullifierSecret=0 is NOT constrained in the circuit.
    ///
    /// If nullifierSecret=0, the nullifier hash becomes `P2(0, electionScope)`,
    /// which is deterministic per election scope and collides across different
    /// credentials that share this secret value.
    ///
    /// This is a documented residual risk under the **issuer trust assumption**:
    /// the issuer is trusted to generate credentials with CSPRNG secrets and
    /// to emit only one credential per identity. A malicious issuer could issue
    /// credentials with nullifierSecret=0, causing nullifier collisons and
    /// denial of service (nullifier already used), but not fraudulent vote
    /// attribution (different credentials have different commitments).
    ///
    /// The soundness model assumes issuer honesty for credential issuance.
    /// Adding a circuit constraint `nullifierSecret != 0` is feasible but not
    /// required by the plan §6.1 and does not strengthen the model beyond the
    /// issuer trust boundary already assumed for credential uniqueness.
    #[test]
    fn test_nullifier_secret_zero_collision_documented() {
        let env = env();
        let secret = scalar_from_u64(0);

        let scope_bytes =
            derive_election_scope(&env, b"Testnet", &[0x01u8; 32], &[0x01u8; 32]).unwrap();
        let scope = scope_to_scalar(&env, &scope_bytes);

        // Two different credentials with nullifierSecret=0 produce the same nullifier
        let label_a = scalar_from_u64(111);
        let label_b = scalar_from_u64(222);
        let trapdoor_a = scalar_from_u64(333);
        let trapdoor_b = scalar_from_u64(444);

        let cred_a = compute_credential_commitment(&env, &label_a, &secret, &trapdoor_a);
        let cred_b = compute_credential_commitment(&env, &label_b, &secret, &trapdoor_b);

        // Credential commitments differ (different labels & trapdoors)
        assert_ne!(cred_a, cred_b, "Different credentials must have different commitments");

        // But nullifier hashes collide (same nullifierSecret=0, same scope)
        let n_a = compute_nullifier_hash(&env, &secret, &scope);
        let n_b = compute_nullifier_hash(&env, &secret, &scope);
        assert_eq!(n_a, n_b, "nullifierSecret=0 produces nullifier collision — documented risk");

        // sanity: non-zero secrets produce different nullifiers (with same scope)
        let s1 = scalar_from_u64(1);
        let s2 = scalar_from_u64(2);
        let n1 = compute_nullifier_hash(&env, &s1, &scope);
        let n2 = compute_nullifier_hash(&env, &s2, &scope);
        assert_ne!(n1, n2, "Different secrets MUST produce different nullifiers");
    }
}
