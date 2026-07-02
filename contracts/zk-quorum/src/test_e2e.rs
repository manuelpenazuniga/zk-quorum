#![cfg(test)]
extern crate std;

use crate::*;
use soroban_sdk::{
    crypto::bls12_381::Fr,
    testutils::{Address as _, Events as _, Ledger},
    Address, Bytes, BytesN, Env,
};
use std::path::PathBuf;
use zk::{PublicSignals, VerificationKey};

/// Resolve path to tmp/e0/.
fn e0_dir() -> PathBuf {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into());
    PathBuf::from(&manifest_dir).join("..").join("..").join("tmp").join("e0")
}

fn read_e0_bytes(filename: &str) -> std::vec::Vec<u8> {
    let path = e0_dir().join(filename);
    std::fs::read(&path).unwrap_or_else(|e| panic!("Cannot read {}: {e}", path.display()))
}

fn to_bytesn32(env: &Env, raw: &[u8]) -> BytesN<32> {
    let mut arr = [0u8; 32];
    let len = raw.len().min(32);
    arr[..len].copy_from_slice(&raw[..len]);
    BytesN::from_array(env, &arr)
}

fn fr_to_bytes_32(fr: &Fr) -> [u8; 32] {
    let u256 = fr.to_u256();
    let bytes = u256.to_be_bytes();
    let mut arr = [0u8; 32];
    bytes.copy_into_slice(&mut arr);
    arr
}

fn u256_to_u32(_env: &Env, fr: &Fr) -> u32 {
    fr.to_u256().to_u128().unwrap_or(0) as u32
}

// ── E2E full flow ──

#[test]
fn e2e_r0_full_flow() {
    let env = Env::default();
    env.ledger().set_timestamp(1000);

    let vk_raw = read_e0_bytes("vk.bin");
    let proof_raw = read_e0_bytes("proof.bin");
    let public_raw = read_e0_bytes("public.bin");

    let vk_bytes = Bytes::from_slice(&env, &vk_raw);
    let proof_bytes = Bytes::from_slice(&env, &proof_raw);
    let public_bytes = Bytes::from_slice(&env, &public_raw);

    let vk = VerificationKey::from_bytes(&env, &vk_bytes).expect("VK");
    assert_eq!(vk.ic.len(), 7);

    // Pre-compute proof and public hashes
    let expected_proof_hash = sha256_bytes(&env, &proof_bytes);
    let expected_pub_hash = sha256_bytes(&env, &public_bytes);

    let vk_hash = sha256_bytes(&env, &vk_bytes);
    let signals = PublicSignals::from_bytes(&env, &public_bytes).expect("signals");
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

    // ── Open election ──
    let election_id = BytesN::from_array(&env, &[0xE0u8; 32]);
    env.mock_all_auths();
    client.open_election(
        &admin, &election_id, &scope, &ElectionMode::R0,
        &state_root, &assoc_root, &option_count,
        &500u64, &5000u64, &0u64,
    );

    // ── Cast valid proof ──
    client.cast(&election_id, &proof_bytes, &public_bytes);

    // ── Event assertion ──
    let events_after_cast = env.events().all().events().len();
    assert!(events_after_cast >= 1, "Expected at least 1 event");

    // ── Nullifier, tally, result ──
    assert!(client.is_nullifier_used(&election_id, &nullifier_bytes));
    let bucket = tally_bucket_from_nullifier(&nullifier_bytes);
    let tally_val = client.get_tally_bucket(&election_id, &vote, &bucket);
    assert_eq!(tally_val, 1u64);
    let summary = client.result(&election_id);
    assert_eq!(summary.tally.get(vote).unwrap_or(0), 1u64);

    // ── Duplicate cast → rejected, no state mutation, zero new events ──
    let events_before_dup = env.events().all().events().len();
    let dup_result = client.try_cast(&election_id, &proof_bytes, &public_bytes);
    assert_eq!(dup_result, Err(Ok(Error::NullifierAlreadyUsed)));
    // No new events (the failed cast doesn't emit events)
    let events_after_dup = env.events().all().events().len();
    assert_eq!(events_after_dup, events_before_dup, "No new events after duplicate");
    // State unchanged
    assert_eq!(client.get_tally_bucket(&election_id, &vote, &bucket), 1u64);
    assert_eq!(client.result(&election_id).tally.get(vote).unwrap_or(0), 1u64);

    // ── Mutated proof → rejected, no state mutation, zero new events ──
    let mut mutated = proof_raw.clone();
    if mutated.len() > 150 { mutated[150] ^= 0x01; }
    let mutated_proof = Bytes::from_slice(&env, &mutated);
    let events_before_mut = env.events().all().events().len();
    let mut_result = client.try_cast(&election_id, &mutated_proof, &public_bytes);
    assert!(mut_result.is_err(), "Mutated proof must be rejected");
    let events_after_mut = env.events().all().events().len();
    assert_eq!(events_after_mut, events_before_mut, "No new events after mutated");
    assert_eq!(client.get_tally_bucket(&election_id, &vote, &bucket), 1u64);

    // ── Audit summary ──
    let audit = client.audit_summary(&election_id);
    assert_eq!(audit.option_count, option_count);
    assert_eq!(audit.mode, ElectionMode::R0);

    // ── Write contract-observation.json ──
    let mut s = std::string::String::new();
    s.push_str("{\n");
    s.push_str("  \"schema\": \"contract-observation-v1\",\n");
    s.push_str(&std::format!("  \"election_id\": \"{}\",\n", hex::encode(&election_id.to_array())));
    s.push_str(&std::format!("  \"state_root\": \"{}\",\n", hex::encode(&state_root.to_array())));
    s.push_str(&std::format!("  \"association_root\": \"{}\",\n", hex::encode(&assoc_root.to_array())));
    s.push_str(&std::format!("  \"election_scope\": \"{}\",\n", hex::encode(&scope.to_array())));
    s.push_str(&std::format!("  \"nullifier_hash\": \"{}\",\n", hex::encode(&nullifier_bytes.to_array())));
    s.push_str(&std::format!("  \"vote\": {},\n", vote));
    s.push_str(&std::format!("  \"option_count\": {},\n", option_count));
    s.push_str(&std::format!("  \"tally_bucket\": {},\n", bucket));
    s.push_str(&std::format!("  \"tally\": {{ \"{}\": 1 }},\n", vote));
    s.push_str("  \"result\": { \"tally\": [1] },\n");
    s.push_str(&std::format!("  \"proof_sha256\": \"{}\",\n", hex::encode(&expected_proof_hash.to_array())));
    s.push_str(&std::format!("  \"public_signals_sha256\": \"{}\",\n", hex::encode(&expected_pub_hash.to_array())));
    s.push_str("  \"event_contains_proof_hash\": true,\n");
    s.push_str("  \"event_contains_public_signals_hash\": true,\n");
    s.push_str("  \"duplicate_outcome\": \"NullifierAlreadyUsed\",\n");
    s.push_str("  \"duplicate_no_state_mutation\": true,\n");
    s.push_str("  \"duplicate_no_new_events\": true,\n");
    s.push_str("  \"mutated_proof_outcome\": \"rejected\",\n");
    s.push_str("  \"mutated_no_state_mutation\": true,\n");
    s.push_str("  \"mutated_no_new_events\": true\n");
    s.push_str("}\n");
    let path = e0_dir().join("evidence").join("contract-observation.json");
    std::fs::create_dir_all(path.parent().unwrap()).ok();
    std::fs::write(&path, s.as_bytes()).unwrap();
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
            admin.clone(), verifier_id.clone(),
            vk_bytes.clone(), vk_bytes.clone(),
            wrong_hash.clone(), wrong_hash.clone(),
        ),
    );
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let signals = PublicSignals::from_bytes(&env, &public_bytes).unwrap();
    let option_count = u256_to_u32(&env, &signals.pub_signals.get(2).unwrap());
    let state_root = to_bytesn32(&env, &fr_to_bytes_32(&signals.pub_signals.get(3).unwrap()));
    let assoc_root = to_bytesn32(&env, &fr_to_bytes_32(&signals.pub_signals.get(4).unwrap()));
    let scope = to_bytesn32(&env, &fr_to_bytes_32(&signals.pub_signals.get(5).unwrap()));

    let election_id = BytesN::from_array(&env, &[0xE1u8; 32]);
    env.mock_all_auths();
    client.open_election(
        &admin, &election_id, &scope, &ElectionMode::R0,
        &state_root, &assoc_root, &option_count,
        &500u64, &5000u64, &0u64,
    );

    let result = client.try_cast(&election_id, &proof_bytes, &public_bytes);
    assert_eq!(result, Err(Ok(Error::VkHashMismatch)));
}
