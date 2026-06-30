#![no_std]
// `too_many_arguments` cannot be scoped to individual methods because the
// `#[contractimpl]` / `#[contractargs]` proc macros generate functions
// whose clippy attributes are not reachable from the method-level allow.
// The 10-param `open_election` and 7-param constructor are frozen by the
// architecture (§7.1 of the execution plan). Event emission helpers in
// `events.rs` carry their own scoped allows.
#![allow(clippy::too_many_arguments)]

mod errors;
mod events;
mod storage;
mod test;
mod types;

pub use errors::*;
pub use types::*;

use soroban_poseidon::poseidon_hash;
use soroban_sdk::{
    contract, contractimpl, crypto::bls12_381::Fr, Address, Bytes, BytesN, Env, Vec, U256,
};
use zk::{Proof, PublicSignals, BLS12_381_FR_MODULUS};

use storage::Storage;

/// Import the groth16-verifier contract interface at compile time.
/// The verifier contract must be built first so the WASM file exists.
mod verifier_client {
    soroban_sdk::contractimport!(
        file = "../groth16-verifier/target/wasm32v1-none/release/groth16_verifier.wasm"
    );
}

fn sha256_bytes(env: &Env, data: &Bytes) -> BytesN<32> {
    let hash = env.crypto().sha256(data);
    BytesN::from_array(env, &hash.to_bytes().to_array())
}

fn fr_to_bytesn32(env: &Env, fr: &Fr) -> Result<BytesN<32>, Error> {
    let u256 = fr.to_u256();
    let bytes = u256.to_be_bytes();
    let mut arr = [0u8; 32];
    bytes.copy_into_slice(&mut arr);
    // Reject canonical zero for nullifier and scope fields
    // (caller decides which signals to check)
    Ok(BytesN::from_array(env, &arr))
}

/// Convert Fr to u32 with strict canonical bounds.
/// Rejects values >= 2^32 or >= BLS12-381 scalar modulus.
fn fr_to_u32(env: &Env, fr: &Fr) -> Result<u32, Error> {
    let u256: U256 = fr.to_u256();
    // Check value fits in u32
    let max_u32 = U256::from_u32(env, u32::MAX);
    if u256 > max_u32 {
        return Err(Error::InvalidOptionCount);
    }
    // U256::to_u128 returns low 128 bits; we already know value <= u32::MAX
    let u128_val: u128 = u256.to_u128().ok_or(Error::CanonicalSignalCheckFailed)?;
    let lo = (u128_val & 0xFFFF_FFFF) as u32;
    Ok(lo)
}

fn bytesn32_to_u256(env: &Env, bytes: &BytesN<32>) -> U256 {
    let mut arr = [0u8; 32];
    bytes.copy_into_slice(&mut arr);
    let b = Bytes::from_slice(env, &arr);
    U256::from_be_bytes(env, &b)
}

/// Validate that a 32-byte value is canonical (strictly less than BLS12-381 Fr modulus).
fn validate_canonical_fr(env: &Env, bytes: &BytesN<32>) -> bool {
    let val = bytesn32_to_u256(env, bytes);
    let modulus = U256::from_be_bytes(env, &Bytes::from_slice(env, &BLS12_381_FR_MODULUS));
    val < modulus
}

/// Validate that a 32-byte value is canonical and non-zero.
fn validate_canonical_nonzero_fr(env: &Env, bytes: &BytesN<32>) -> bool {
    let mut arr = [0u8; 32];
    bytes.copy_into_slice(&mut arr);
    if arr == [0u8; 32] {
        return false;
    }
    validate_canonical_fr(env, bytes)
}

struct R0PublicSignals {
    nullifier_hash: BytesN<32>,
    vote: u32,
    option_count: u32,
    state_root: BytesN<32>,
    association_root: BytesN<32>,
    election_scope: BytesN<32>,
}

fn parse_r0_public_signals(
    env: &Env,
    pub_signals: &PublicSignals,
) -> Result<R0PublicSignals, Error> {
    if pub_signals.pub_signals.len() != PUBLIC_SIGNALS_R0_LEN {
        return Err(Error::MalformedPublicSignals);
    }

    let nullifier_fr = pub_signals
        .pub_signals
        .get(PUBLIC_SIGNALS_R0_NULLIFIER)
        .ok_or(Error::MalformedPublicSignals)?;
    let vote_fr = pub_signals
        .pub_signals
        .get(PUBLIC_SIGNALS_R0_VOTE)
        .ok_or(Error::MalformedPublicSignals)?;
    let option_count_fr = pub_signals
        .pub_signals
        .get(PUBLIC_SIGNALS_R0_OPTION_COUNT)
        .ok_or(Error::MalformedPublicSignals)?;
    let state_root_fr = pub_signals
        .pub_signals
        .get(PUBLIC_SIGNALS_R0_STATE_ROOT)
        .ok_or(Error::MalformedPublicSignals)?;
    let assoc_root_fr = pub_signals
        .pub_signals
        .get(PUBLIC_SIGNALS_R0_ASSOCIATION_ROOT)
        .ok_or(Error::MalformedPublicSignals)?;
    let scope_fr = pub_signals
        .pub_signals
        .get(PUBLIC_SIGNALS_R0_ELECTION_SCOPE)
        .ok_or(Error::MalformedPublicSignals)?;

    let nullifier_hash = fr_to_bytesn32(env, &nullifier_fr)?;
    let vote = fr_to_u32(env, &vote_fr)?;
    let option_count = fr_to_u32(env, &option_count_fr)?;
    let state_root = fr_to_bytesn32(env, &state_root_fr)?;
    let association_root = fr_to_bytesn32(env, &assoc_root_fr)?;
    let election_scope = fr_to_bytesn32(env, &scope_fr)?;

    Ok(R0PublicSignals {
        nullifier_hash,
        vote,
        option_count,
        state_root,
        association_root,
        election_scope,
    })
}

struct R1PublicSignals {
    nullifier_hash: BytesN<32>,
    ballot_commitment: BytesN<32>,
    option_count: u32,
    state_root: BytesN<32>,
    association_root: BytesN<32>,
    election_scope: BytesN<32>,
}

fn parse_r1_public_signals(
    env: &Env,
    pub_signals: &PublicSignals,
) -> Result<R1PublicSignals, Error> {
    if pub_signals.pub_signals.len() != PUBLIC_SIGNALS_R1_LEN {
        return Err(Error::MalformedPublicSignals);
    }

    let nullifier_fr = pub_signals
        .pub_signals
        .get(PUBLIC_SIGNALS_R1_NULLIFIER)
        .ok_or(Error::MalformedPublicSignals)?;
    let commitment_fr = pub_signals
        .pub_signals
        .get(PUBLIC_SIGNALS_R1_COMMITMENT)
        .ok_or(Error::MalformedPublicSignals)?;
    let option_count_fr = pub_signals
        .pub_signals
        .get(PUBLIC_SIGNALS_R1_OPTION_COUNT)
        .ok_or(Error::MalformedPublicSignals)?;
    let state_root_fr = pub_signals
        .pub_signals
        .get(PUBLIC_SIGNALS_R1_STATE_ROOT)
        .ok_or(Error::MalformedPublicSignals)?;
    let assoc_root_fr = pub_signals
        .pub_signals
        .get(PUBLIC_SIGNALS_R1_ASSOCIATION_ROOT)
        .ok_or(Error::MalformedPublicSignals)?;
    let scope_fr = pub_signals
        .pub_signals
        .get(PUBLIC_SIGNALS_R1_ELECTION_SCOPE)
        .ok_or(Error::MalformedPublicSignals)?;

    let nullifier_hash = fr_to_bytesn32(env, &nullifier_fr)?;
    let ballot_commitment = fr_to_bytesn32(env, &commitment_fr)?;
    let option_count = fr_to_u32(env, &option_count_fr)?;
    let state_root = fr_to_bytesn32(env, &state_root_fr)?;
    let association_root = fr_to_bytesn32(env, &assoc_root_fr)?;
    let election_scope = fr_to_bytesn32(env, &scope_fr)?;

    Ok(R1PublicSignals {
        nullifier_hash,
        ballot_commitment,
        option_count,
        state_root,
        association_root,
        election_scope,
    })
}

/// Recompute the ballot commitment from vote, salt, and election scope
/// using Poseidon P2(P2(vote, salt), electionScope).
///
/// Validates salt and scope are canonical (< Fr modulus) before hashing
/// to prevent panics in the underlying Fr conversion.
/// Returns `Err(ZeroSaltNotAllowed)` if salt is all zeros.
/// Returns `Err(CannotRecomputeCommitment)` if any input is non-canonical
/// or the recomputed result is zero.
pub(crate) fn recompute_ballot_commitment(
    env: &Env,
    vote: u32,
    salt: &BytesN<32>,
    election_scope: &BytesN<32>,
) -> Result<BytesN<32>, Error> {
    // Reject zero salt
    let mut salt_arr = [0u8; 32];
    salt.copy_into_slice(&mut salt_arr);
    if salt_arr == [0u8; 32] {
        return Err(Error::ZeroSaltNotAllowed);
    }

    // Validate salt is canonical: 0 < salt < r
    if !validate_canonical_nonzero_fr(env, salt) {
        return Err(Error::CannotRecomputeCommitment);
    }

    // Validate scope is canonical: 0 < scope < r
    if !validate_canonical_nonzero_fr(env, election_scope) {
        return Err(Error::CannotRecomputeCommitment);
    }

    let vote_u256 = U256::from_u32(env, vote);
    let salt_u256 = bytesn32_to_u256(env, salt);
    let scope_u256 = bytesn32_to_u256(env, election_scope);

    let inputs_inner = Vec::from_array(env, [vote_u256, salt_u256]);
    let inner_u256 = poseidon_hash::<3, Fr>(env, &inputs_inner);

    let inputs_outer = Vec::from_array(env, [inner_u256, scope_u256]);
    let computed_u256 = poseidon_hash::<3, Fr>(env, &inputs_outer);

    let computed_bytes = computed_u256.to_be_bytes();
    let mut arr = [0u8; 32];
    computed_bytes.copy_into_slice(&mut arr);

    if arr == [0u8; 32] {
        return Err(Error::CannotRecomputeCommitment);
    }

    Ok(BytesN::from_array(env, &arr))
}

/// Call the external verifier contract via cross-contract call.
fn call_verifier(
    env: &Env,
    vk_bytes: &Bytes,
    proof: &Proof,
    pub_signals: &PublicSignals,
) -> Result<bool, Error> {
    let verifier_addr = Storage::get_verifier(env)?;
    let client = verifier_client::Client::new(env, &verifier_addr);

    let proof_bytes = proof.to_bytes(env);
    let signals_bytes = pub_signals.to_bytes(env);

    client
        .try_verify_proof(vk_bytes, &proof_bytes, &signals_bytes)
        .map_err(|_| Error::VerifierCallFailed)?
        .map_err(|_| Error::ProofVerificationFailed)
}

/// Verify the VK hash binding: recompute SHA-256 of stored VK bytes and
/// compare against the stored VK hash.
fn verify_vk_hash(env: &Env, mode: &ElectionMode) -> Result<(), Error> {
    let (vk_bytes, expected_hash) = Storage::get_vk_with_hash(env, mode)?;
    let actual_hash = sha256_bytes(env, &vk_bytes);
    if actual_hash != expected_hash {
        return Err(Error::VkHashMismatch);
    }
    Ok(())
}

#[contract]
pub struct ZkQuorumContract;

#[contractimpl]
impl ZkQuorumContract {
    /// Constructor: sets admin, verifier address, VK bytes and VK hashes.
    /// VKs are fixed at deploy time and never updatable.
    pub fn __constructor(
        env: Env,
        admin: Address,
        verifier: Address,
        vk_r0: Bytes,
        vk_r1: Bytes,
        vk_r0_hash: BytesN<32>,
        vk_r1_hash: BytesN<32>,
    ) -> Result<(), Error> {
        Storage::init(
            &env,
            &admin,
            &verifier,
            &vk_r0,
            &vk_r1,
            &vk_r0_hash,
            &vk_r1_hash,
        )
    }

    /// Open a new election. All parameters are frozen after this call.
    /// electionScope, stateRoot, and associationRoot must be non-zero
    /// and canonical (< BLS12-381 Fr modulus).
    pub fn open_election(
        env: Env,
        admin: Address,
        election_id: BytesN<32>,
        election_scope: BytesN<32>,
        mode: ElectionMode,
        state_root: BytesN<32>,
        association_root: BytesN<32>,
        option_count: u32,
        opens_at: u64,
        closes_at: u64,
        reveal_closes_at: u64,
    ) -> Result<(), Error> {
        admin.require_auth();
        Storage::assert_admin(&env, &admin)?;

        if !(1..=MAX_OPTIONS).contains(&option_count) {
            return Err(Error::InvalidOptionCount);
        }
        if opens_at >= closes_at {
            return Err(Error::InvalidTimestamp);
        }
        if mode == ElectionMode::R1 && closes_at >= reveal_closes_at {
            return Err(Error::InvalidRevealWindow);
        }

        let now = env.ledger().timestamp();
        // Must not already be past closes_at
        if now >= closes_at {
            return Err(Error::InvalidTimestamp);
        }

        // Validate electionScope is non-zero and canonical
        if !validate_canonical_nonzero_fr(&env, &election_scope) {
            return Err(Error::InvalidElectionScope);
        }
        // Validate stateRoot is non-zero and canonical
        if !validate_canonical_nonzero_fr(&env, &state_root) {
            return Err(Error::InvalidStateRoot);
        }
        // Validate associationRoot is non-zero and canonical
        if !validate_canonical_nonzero_fr(&env, &association_root) {
            return Err(Error::InvalidAssociationRoot);
        }

        let config = ElectionConfig {
            election_scope,
            mode,
            state_root,
            association_root,
            option_count,
            opens_at,
            closes_at,
            reveal_closes_at,
        };

        Storage::set_election(&env, &election_id, &config)
    }

    pub fn cast(
        env: Env,
        election_id: BytesN<32>,
        proof_bytes: Bytes,
        public_signals_bytes: Bytes,
    ) -> Result<(), Error> {
        let proof = Proof::from_bytes(&env, &proof_bytes).map_err(|_| Error::MalformedProof)?;
        let pub_signals = PublicSignals::from_bytes(&env, &public_signals_bytes)
            .map_err(|_| Error::MalformedPublicSignals)?;

        let election = Storage::get_election(&env, &election_id)?;

        let now = env.ledger().timestamp();
        let status = election.compute_status(now);
        if matches!(status, ElectionStatus::Pending) {
            return Err(Error::ElectionNotStarted);
        }
        if !matches!(status, ElectionStatus::Open) {
            return Err(Error::ElectionClosed);
        }

        match election.mode {
            ElectionMode::R0 => Self::cast_r0(&env, &election_id, &election, &proof, &pub_signals),
            ElectionMode::R1 => Self::cast_r1(&env, &election_id, &election, &proof, &pub_signals),
        }
    }

    fn cast_r0(
        env: &Env,
        election_id: &BytesN<32>,
        election: &ElectionConfig,
        proof: &Proof,
        pub_signals: &PublicSignals,
    ) -> Result<(), Error> {
        let signals = parse_r0_public_signals(env, pub_signals)?;

        if signals.option_count != election.option_count {
            return Err(Error::InvalidOptionCount);
        }
        if signals.state_root != election.state_root {
            return Err(Error::RootMismatch);
        }
        if signals.association_root != election.association_root {
            return Err(Error::RootMismatch);
        }
        if signals.election_scope != election.election_scope {
            return Err(Error::ScopeMismatch);
        }

        if signals.vote >= election.option_count {
            return Err(Error::VoteOutOfRange);
        }

        if Storage::is_nullifier_used(env, election_id, &signals.nullifier_hash) {
            return Err(Error::NullifierAlreadyUsed);
        }

        // VK hash binding: ensure stored VK matches its expected hash
        verify_vk_hash(env, &ElectionMode::R0)?;

        let vk_bytes = Storage::get_vk_bytes(env, &ElectionMode::R0)?;

        // Cross-contract call to verifier
        let verified = call_verifier(env, &vk_bytes, proof, pub_signals)?;
        if !verified {
            return Err(Error::ProofVerificationFailed);
        }

        let proof_hash = sha256_bytes(env, &proof.to_bytes(env));
        let pub_hash = sha256_bytes(env, &pub_signals.to_bytes(env));

        Storage::mark_nullifier(env, election_id, &signals.nullifier_hash);
        let bucket = tally_bucket_from_nullifier(&signals.nullifier_hash);
        Storage::increment_tally(env, election_id, signals.vote, bucket)?;
        Storage::extend_election_keys(env, election_id);

        events::emit_vote_cast_v1(
            env,
            election_id,
            &signals.nullifier_hash,
            signals.vote,
            bucket,
            PUBLIC_SCHEMA_V1_R0,
            &proof_hash,
            &pub_hash,
        );

        Ok(())
    }

    fn cast_r1(
        env: &Env,
        election_id: &BytesN<32>,
        election: &ElectionConfig,
        proof: &Proof,
        pub_signals: &PublicSignals,
    ) -> Result<(), Error> {
        let signals = parse_r1_public_signals(env, pub_signals)?;

        if signals.option_count != election.option_count {
            return Err(Error::InvalidOptionCount);
        }
        if signals.state_root != election.state_root {
            return Err(Error::RootMismatch);
        }
        if signals.association_root != election.association_root {
            return Err(Error::RootMismatch);
        }
        if signals.election_scope != election.election_scope {
            return Err(Error::ScopeMismatch);
        }

        if Storage::is_nullifier_used(env, election_id, &signals.nullifier_hash) {
            return Err(Error::NullifierAlreadyUsed);
        }

        // Check duplicate ballot commitment before verifying proof
        if Storage::commitment_exists(env, election_id, &signals.ballot_commitment) {
            return Err(Error::CommitmentAlreadyExists);
        }

        // VK hash binding
        verify_vk_hash(env, &ElectionMode::R1)?;

        let vk_bytes = Storage::get_vk_bytes(env, &ElectionMode::R1)?;

        // Cross-contract call to verifier
        let verified = call_verifier(env, &vk_bytes, proof, pub_signals)?;
        if !verified {
            return Err(Error::ProofVerificationFailed);
        }

        let proof_hash = sha256_bytes(env, &proof.to_bytes(env));
        let pub_hash = sha256_bytes(env, &pub_signals.to_bytes(env));

        Storage::mark_nullifier(env, election_id, &signals.nullifier_hash);
        let bucket = tally_bucket_from_nullifier(&signals.nullifier_hash);

        let pending = PendingCommitment {
            bucket,
            revealed: false,
        };
        Storage::set_pending_commitment(env, election_id, &signals.ballot_commitment, &pending)?;
        Storage::increment_commit_count(env, election_id)?;
        Storage::extend_election_keys(env, election_id);

        events::emit_vote_committed_v1(
            env,
            election_id,
            &signals.nullifier_hash,
            &signals.ballot_commitment,
            bucket,
            PUBLIC_SCHEMA_V1_R1,
            &proof_hash,
            &pub_hash,
        );

        Ok(())
    }

    pub fn reveal(
        env: Env,
        election_id: BytesN<32>,
        vote: u32,
        salt: BytesN<32>,
        ballot_commitment: BytesN<32>,
    ) -> Result<(), Error> {
        let election = Storage::get_election(&env, &election_id)?;

        if election.mode != ElectionMode::R1 {
            return Err(Error::InvalidMode);
        }

        let now = env.ledger().timestamp();
        let status = election.compute_status(now);
        if !matches!(status, ElectionStatus::RevealOpen) {
            if matches!(status, ElectionStatus::Open) || matches!(status, ElectionStatus::Pending) {
                return Err(Error::RevealNotOpen);
            }
            return Err(Error::RevealWindowClosed);
        }

        let pending = Storage::get_pending_commitment(&env, &election_id, &ballot_commitment)
            .ok_or(Error::CommitmentNotFound)?;

        if pending.revealed {
            return Err(Error::AlreadyRevealed);
        }

        if vote >= election.option_count {
            return Err(Error::VoteOutOfRange);
        }

        let computed = recompute_ballot_commitment(&env, vote, &salt, &election.election_scope)?;
        if computed != ballot_commitment {
            return Err(Error::WrongSalt);
        }

        let updated = PendingCommitment {
            bucket: pending.bucket,
            revealed: true,
        };
        Storage::update_pending_commitment(&env, &election_id, &ballot_commitment, &updated);

        Storage::increment_tally(&env, &election_id, vote, pending.bucket)?;
        Storage::increment_reveal_count(&env, &election_id)?;
        Storage::extend_election_keys(&env, &election_id);

        events::emit_vote_revealed_v1(&env, &election_id, &ballot_commitment, vote);

        Ok(())
    }

    pub fn result(env: Env, election_id: BytesN<32>) -> Result<ElectionSummary, Error> {
        let election = Storage::get_election(&env, &election_id)?;

        let commit_count = Storage::get_commit_count(&env, &election_id);
        let reveal_count = Storage::get_reveal_count(&env, &election_id);
        let non_reveal_count = commit_count
            .checked_sub(reveal_count)
            .ok_or(Error::ArithmeticOverflow)?;

        let tally: [u64; 16] = Storage::sum_tally(&env, &election_id, election.option_count)?;

        let mut tally_vec: Vec<u64> = Vec::new(&env);
        for i in 0..election.option_count {
            tally_vec.push_back(tally[i as usize]);
        }

        let summary = ElectionSummary {
            commit_count,
            reveal_count,
            non_reveal_count,
            tally: tally_vec,
        };

        Ok(summary)
    }

    pub fn audit_summary(env: Env, election_id: BytesN<32>) -> Result<AuditSummary, Error> {
        let election = Storage::get_election(&env, &election_id)?;

        let commit_count = Storage::get_commit_count(&env, &election_id);
        let reveal_count = Storage::get_reveal_count(&env, &election_id);
        let non_reveal_count = commit_count
            .checked_sub(reveal_count)
            .ok_or(Error::ArithmeticOverflow)?;

        let tally: [u64; 16] = Storage::sum_tally(&env, &election_id, election.option_count)?;

        let now = env.ledger().timestamp();
        let status = election.compute_status(now);

        let mut tally_vec: Vec<u64> = Vec::new(&env);
        for i in 0..election.option_count {
            tally_vec.push_back(tally[i as usize]);
        }

        let summary = AuditSummary {
            commit_count,
            reveal_count,
            non_reveal_count,
            tally: tally_vec,
            option_count: election.option_count,
            mode: election.mode,
            state_root: election.state_root.clone(),
            association_root: election.association_root.clone(),
            election_scope: election.election_scope.clone(),
            status,
        };

        Ok(summary)
    }

    pub fn extend_election_ttl(
        env: Env,
        election_id: BytesN<32>,
        threshold: u32,
        extend_to: u32,
    ) -> Result<(), Error> {
        let _election = Storage::get_election(&env, &election_id)?;

        let capped_threshold = core::cmp::min(threshold, 4096);
        let capped_extend = core::cmp::min(extend_to, 535_680);

        let election_key = DataKey::election_key(&election_id);
        env.storage()
            .persistent()
            .extend_ttl(&election_key, capped_threshold, capped_extend);

        let count_key = DataKey::commit_count_key(&election_id);
        if env
            .storage()
            .persistent()
            .get::<DataKey, u32>(&count_key)
            .is_some()
        {
            env.storage()
                .persistent()
                .extend_ttl(&count_key, capped_threshold, capped_extend);
        }

        let reveal_key = DataKey::reveal_count_key(&election_id);
        if env
            .storage()
            .persistent()
            .get::<DataKey, u32>(&reveal_key)
            .is_some()
        {
            env.storage()
                .persistent()
                .extend_ttl(&reveal_key, capped_threshold, capped_extend);
        }

        Ok(())
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        Storage::get_admin(&env)
    }

    pub fn get_verifier(env: Env) -> Result<Address, Error> {
        Storage::get_verifier(&env)
    }

    pub fn get_election(env: Env, election_id: BytesN<32>) -> Result<ElectionConfig, Error> {
        Storage::get_election(&env, &election_id)
    }

    pub fn is_nullifier_used(
        env: Env,
        election_id: BytesN<32>,
        nullifier_hash: BytesN<32>,
    ) -> bool {
        Storage::is_nullifier_used(&env, &election_id, &nullifier_hash)
    }

    pub fn get_tally_bucket(env: Env, election_id: BytesN<32>, option: u32, bucket: u32) -> u64 {
        Storage::get_tally(&env, &election_id, option, bucket)
    }
}
