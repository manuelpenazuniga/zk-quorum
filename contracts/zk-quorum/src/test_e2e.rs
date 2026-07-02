#![cfg(test)]
extern crate std;

use crate::*;
use soroban_sdk::{
    crypto::bls12_381::Fr,
    testutils::{Address as _, Events as _, Ledger},
    Address, Bytes, BytesN, Env,
};
use std::path::PathBuf;
use zk::{Proof, PublicSignals, VerificationKey};

/// Resolve the path to tmp/e0/ evidence directory.
fn e0_dir() -> PathBuf {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into());
    PathBuf::from(&manifest_dir)
        .join("..")
        .join("..")
        .join("tmp")
        .join("e0")
}

fn read_e0_bytes(filename: &str) -> std::vec::Vec<u8> {
    let path = e0_dir().join(filename);
    std::fs::read(&path).unwrap_or_else(|e| panic!("Cannot read {}: {e}", path.display()))
}

/// Convert a 32-byte slice to BytesN<32>.
fn to_bytesn32(env: &Env, raw: &[u8]) -> BytesN<32> {
    let mut arr = [0u8; 32];
    let len = raw.len().min(32);
    arr[..len].copy_from_slice(&raw[..len]);
    BytesN::from_array(env, &arr)
}

/// Extract a 32-byte value from an Fr field element and return as [u8; 32].
fn fr_to_bytes_32(fr: &Fr) -> [u8; 32] {
    let u256 = fr.to_u256();
    let bytes = u256.to_be_bytes();
    let mut arr = [0u8; 32];
    bytes.copy_into_slice(&mut arr);
    arr
}

/// Convert U256 to u32 safely (for signals that are known to fit in u32).
fn u256_to_u32(_env: &Env, fr: &Fr) -> u32 {
    let u256_val = fr.to_u256();
    u256_val.to_u128().unwrap_or(0) as u32
}

// ── E2E positive: full flow with real proof ──

#[test]
fn e2e_r0_full_flow() {
    let env = Env::default();
    env.ledger().set_timestamp(1000);

    // ── Load real VK, proof, public signals ──
    let vk_raw = read_e0_bytes("vk.bin");
    let proof_raw = read_e0_bytes("proof.bin");
    let public_raw = read_e0_bytes("public.bin");

    let vk_bytes = Bytes::from_slice(&env, &vk_raw);
    let proof_bytes = Bytes::from_slice(&env, &proof_raw);
    let public_bytes = Bytes::from_slice(&env, &public_raw);

    // Verify round-trip deserialization
    let vk = VerificationKey::from_bytes(&env, &vk_bytes).expect("VK deserialization");
    assert_eq!(
        vk.ic.len(),
        7,
        "IC length should be 7 (1 base + 6 public inputs)"
    );

    let _proof = Proof::from_bytes(&env, &proof_bytes).expect("Proof deserialization");
    let signals =
        PublicSignals::from_bytes(&env, &public_bytes).expect("Public signals deserialization");

    // Compute VK hash
    let vk_hash = sha256_bytes(&env, &vk_bytes);

    // ── Register contracts ──
    let verifier_id = env.register(crate::verifier_client::WASM, ());
    let admin = Address::generate(&env);

    let contract_id = env.register(
        ZkQuorumContract,
        (
            admin.clone(),
            verifier_id.clone(),
            vk_bytes.clone(),
            vk_bytes.clone(),
            vk_hash.clone(),
            vk_hash.clone(),
        ),
    );
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    // ── Extract election parameters from public signals ──
    assert_eq!(signals.pub_signals.len(), PUBLIC_SIGNALS_R0_LEN as u32);

    let nullifier_fr = signals.pub_signals.get(0).unwrap();
    let vote_fr = signals.pub_signals.get(1).unwrap();
    let option_count_fr = signals.pub_signals.get(2).unwrap();
    let state_root_fr = signals.pub_signals.get(3).unwrap();
    let assoc_root_fr = signals.pub_signals.get(4).unwrap();
    let scope_fr = signals.pub_signals.get(5).unwrap();

    let vote = u256_to_u32(&env, &vote_fr);
    let option_count = u256_to_u32(&env, &option_count_fr);

    let nullifier_bytes = to_bytesn32(&env, &fr_to_bytes_32(&nullifier_fr));
    let state_root = to_bytesn32(&env, &fr_to_bytes_32(&state_root_fr));
    let assoc_root = to_bytesn32(&env, &fr_to_bytes_32(&assoc_root_fr));
    let scope = to_bytesn32(&env, &fr_to_bytes_32(&scope_fr));

    // ── Open election ──
    let election_id = BytesN::from_array(&env, &[0xE0u8; 32]);
    let opens_at: u64 = 500;
    let closes_at: u64 = 5000;

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &scope,
        &ElectionMode::R0,
        &state_root,
        &assoc_root,
        &option_count,
        &opens_at,
        &closes_at,
        &0u64,
    );

    let election = client.get_election(&election_id);
    assert_eq!(election.mode, ElectionMode::R0);
    assert_eq!(election.option_count, option_count);

    // ── Cast valid proof ──
    client.cast(&election_id, &proof_bytes, &public_bytes);

    // ── Event emitted (capture FIRST before other host calls) ──
    let all_events = env.events().all();
    let event_count = all_events.events().len();
    assert!(
        event_count > 0,
        "VoteCastV1 event should be emitted, got {} events",
        event_count
    );

    // ── Nullifier marked ──
    assert!(client.is_nullifier_used(&election_id, &nullifier_bytes));

    // ── Tally correct ──
    let bucket = tally_bucket_from_nullifier(&nullifier_bytes);
    let tally_val = client.get_tally_bucket(&election_id, &vote, &bucket);
    assert_eq!(tally_val, 1u64);

    // ── Result correct ──
    let summary = client.result(&election_id);
    assert_eq!(summary.tally.get(vote).unwrap_or(0), 1u64);

    // ── Duplicate cast rejected ──
    let dup_result = client.try_cast(&election_id, &proof_bytes, &public_bytes);
    assert_eq!(dup_result, Err(Ok(Error::NullifierAlreadyUsed)));

    // ── Tally unchanged after duplicate ──
    let tally_val2 = client.get_tally_bucket(&election_id, &vote, &bucket);
    assert_eq!(tally_val2, 1u64);

    // ── Mutated proof rejected, no state change ──
    let mut mutated = proof_raw.clone();
    if mutated.len() > 150 {
        mutated[150] ^= 0x01;
    }
    let mutated_proof = Bytes::from_slice(&env, &mutated);
    let mut_result = client.try_cast(&election_id, &mutated_proof, &public_bytes);
    assert!(mut_result.is_err(), "Mutated proof should be rejected");

    // Tally still 1
    let tally_val3 = client.get_tally_bucket(&election_id, &vote, &bucket);
    assert_eq!(tally_val3, 1u64);

    // ── Verify audit summary ──
    let audit = client.audit_summary(&election_id);
    assert_eq!(audit.option_count, option_count);
    assert_eq!(audit.mode, ElectionMode::R0);
}

#[test]
fn e2e_r0_vk_hash_binding() {
    let env = Env::default();
    env.ledger().set_timestamp(1000);

    let vk_raw = read_e0_bytes("vk.bin");
    let proof_raw = read_e0_bytes("proof.bin");
    let public_raw = read_e0_bytes("public.bin");

    let vk_bytes = Bytes::from_slice(&env, &vk_raw);
    let proof_bytes = Bytes::from_slice(&env, &proof_raw);
    let public_bytes = Bytes::from_slice(&env, &public_raw);

    let wrong_hash = BytesN::from_array(&env, &[0xFFu8; 32]);

    let verifier_id = env.register(crate::verifier_client::WASM, ());
    let admin = Address::generate(&env);

    let contract_id = env.register(
        ZkQuorumContract,
        (
            admin.clone(),
            verifier_id.clone(),
            vk_bytes.clone(),
            vk_bytes.clone(),
            wrong_hash.clone(),
            wrong_hash.clone(),
        ),
    );
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let signals = PublicSignals::from_bytes(&env, &public_bytes).unwrap();
    let option_count_fr = signals.pub_signals.get(2).unwrap();
    let state_root_fr = signals.pub_signals.get(3).unwrap();
    let assoc_root_fr = signals.pub_signals.get(4).unwrap();
    let scope_fr = signals.pub_signals.get(5).unwrap();

    let option_count = u256_to_u32(&env, &option_count_fr);
    let state_root = to_bytesn32(&env, &fr_to_bytes_32(&state_root_fr));
    let assoc_root = to_bytesn32(&env, &fr_to_bytes_32(&assoc_root_fr));
    let scope = to_bytesn32(&env, &fr_to_bytes_32(&scope_fr));

    let election_id = BytesN::from_array(&env, &[0xE1u8; 32]);
    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &scope,
        &ElectionMode::R0,
        &state_root,
        &assoc_root,
        &option_count,
        &500u64,
        &5000u64,
        &0u64,
    );

    let result = client.try_cast(&election_id, &proof_bytes, &public_bytes);
    assert_eq!(result, Err(Ok(Error::VkHashMismatch)));
}
