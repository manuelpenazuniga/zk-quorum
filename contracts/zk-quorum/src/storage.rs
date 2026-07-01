use soroban_sdk::{Address, Bytes, BytesN, Env};

use crate::errors::Error;
use crate::types::*;

const CONTRACT_VERSION: u32 = 1;

const TTL_THRESHOLD: u32 = 120;
const TTL_EXTEND_TO: u32 = 535_680;

fn threshold() -> u32 {
    TTL_THRESHOLD
}

fn extend_to() -> u32 {
    TTL_EXTEND_TO
}

pub struct Storage;

impl Storage {
    // --- Initialization ---

    pub fn init(
        env: &Env,
        admin: &Address,
        verifier: &Address,
        vk_r0: &Bytes,
        vk_r1: &Bytes,
        vk_r0_hash: &BytesN<32>,
        vk_r1_hash: &BytesN<32>,
    ) -> Result<(), Error> {
        if env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::ContractVersion)
            .is_some()
        {
            return Err(Error::AlreadyInitialized);
        }

        env.storage()
            .persistent()
            .set(&DataKey::ContractVersion, &CONTRACT_VERSION);
        env.storage().persistent().set(&DataKey::Admin, admin);
        env.storage().persistent().set(&DataKey::Verifier, verifier);
        env.storage().persistent().set(&DataKey::VkR0, vk_r0);
        env.storage().persistent().set(&DataKey::VkR1, vk_r1);
        env.storage()
            .persistent()
            .set(&DataKey::VkR0Hash, vk_r0_hash);
        env.storage()
            .persistent()
            .set(&DataKey::VkR1Hash, vk_r1_hash);

        env.storage()
            .persistent()
            .extend_ttl(&DataKey::ContractVersion, threshold(), extend_to());
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Admin, threshold(), extend_to());
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Verifier, threshold(), extend_to());
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::VkR0, threshold(), extend_to());
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::VkR1, threshold(), extend_to());
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::VkR0Hash, threshold(), extend_to());
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::VkR1Hash, threshold(), extend_to());

        Ok(())
    }

    // --- Admin ---

    pub fn get_admin(env: &Env) -> Result<Address, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(Error::ElectionNotFound)
    }

    #[allow(dead_code)]
    pub fn is_admin(env: &Env, caller: &Address) -> Result<bool, Error> {
        let admin = Self::get_admin(env)?;
        Ok(*caller == admin)
    }

    pub fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin = Self::get_admin(env)?;
        if *caller != admin {
            return Err(Error::NotAdmin);
        }
        Ok(())
    }

    // --- Verifier ---

    pub fn get_verifier(env: &Env) -> Result<Address, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Verifier)
            .ok_or(Error::ElectionNotFound)
    }

    // --- VK ---

    pub fn get_vk_bytes(env: &Env, mode: &ElectionMode) -> Result<Bytes, Error> {
        let key = match mode {
            ElectionMode::R0 => &DataKey::VkR0,
            ElectionMode::R1 => &DataKey::VkR1,
        };
        env.storage()
            .persistent()
            .get(key)
            .ok_or(Error::InvalidMode)
    }

    /// Returns the VK bytes and the expected hash; caller should verify SHA-256
    /// of the bytes matches the stored hash.
    pub fn get_vk_with_hash(env: &Env, mode: &ElectionMode) -> Result<(Bytes, BytesN<32>), Error> {
        let vk_bytes = Self::get_vk_bytes(env, mode)?;
        let hash_key = match mode {
            ElectionMode::R0 => &DataKey::VkR0Hash,
            ElectionMode::R1 => &DataKey::VkR1Hash,
        };
        let expected_hash: BytesN<32> = env
            .storage()
            .persistent()
            .get(hash_key)
            .ok_or(Error::InvalidMode)?;
        Ok((vk_bytes, expected_hash))
    }

    // --- Election ---

    pub fn get_election(env: &Env, election_id: &BytesN<32>) -> Result<ElectionConfig, Error> {
        let key = DataKey::election_key(election_id);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(Error::ElectionNotFound)
    }

    pub fn set_election(
        env: &Env,
        election_id: &BytesN<32>,
        config: &ElectionConfig,
    ) -> Result<(), Error> {
        let key = DataKey::election_key(election_id);
        if env
            .storage()
            .persistent()
            .get::<_, ElectionConfig>(&key)
            .is_some()
        {
            return Err(Error::ElectionAlreadyExists);
        }
        env.storage().persistent().set(&key, config);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold(), extend_to());
        Ok(())
    }

    // --- Nullifier ---

    pub fn is_nullifier_used(
        env: &Env,
        election_id: &BytesN<32>,
        nullifier_hash: &BytesN<32>,
    ) -> bool {
        let key = DataKey::nullifier_key(election_id, nullifier_hash);
        env.storage()
            .persistent()
            .get::<_, bool>(&key)
            .unwrap_or(false)
    }

    pub fn mark_nullifier(env: &Env, election_id: &BytesN<32>, nullifier_hash: &BytesN<32>) {
        let key = DataKey::nullifier_key(election_id, nullifier_hash);
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold(), extend_to());
    }

    // --- Tally ---

    pub fn get_tally(env: &Env, election_id: &BytesN<32>, option: u32, bucket: u32) -> u64 {
        let key = DataKey::tally_bucket_key(election_id, option, bucket);
        env.storage().persistent().get(&key).unwrap_or(0u64)
    }

    pub fn increment_tally(
        env: &Env,
        election_id: &BytesN<32>,
        option: u32,
        bucket: u32,
    ) -> Result<(), Error> {
        let key = DataKey::tally_bucket_key(election_id, option, bucket);
        let current: u64 = env.storage().persistent().get(&key).unwrap_or(0);
        let next = current.checked_add(1).ok_or(Error::TallyOverflow)?;
        env.storage().persistent().set(&key, &next);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold(), extend_to());
        Ok(())
    }

    pub fn sum_tally(
        env: &Env,
        election_id: &BytesN<32>,
        option_count: u32,
    ) -> Result<[u64; 16], Error> {
        let mut tally = [0u64; 16];
        for opt in 0..option_count {
            let mut sum: u64 = 0;
            for bucket in 0..TALLY_BUCKETS {
                sum = sum
                    .checked_add(Self::get_tally(env, election_id, opt, bucket))
                    .ok_or(Error::TallyOverflow)?;
            }
            tally[opt as usize] = sum;
        }
        Ok(tally)
    }

    // --- R1 Commitments ---

    pub fn get_commit_count(env: &Env, election_id: &BytesN<32>) -> u32 {
        let key = DataKey::commit_count_key(election_id);
        env.storage().persistent().get(&key).unwrap_or(0u32)
    }

    pub fn increment_commit_count(env: &Env, election_id: &BytesN<32>) -> Result<u32, Error> {
        let key = DataKey::commit_count_key(election_id);
        let current: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        let next = current.checked_add(1).ok_or(Error::CounterOverflow)?;
        env.storage().persistent().set(&key, &next);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold(), extend_to());
        Ok(next)
    }

    pub fn get_reveal_count(env: &Env, election_id: &BytesN<32>) -> u32 {
        let key = DataKey::reveal_count_key(election_id);
        env.storage().persistent().get(&key).unwrap_or(0u32)
    }

    pub fn increment_reveal_count(env: &Env, election_id: &BytesN<32>) -> Result<u32, Error> {
        let key = DataKey::reveal_count_key(election_id);
        let current: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        let next = current.checked_add(1).ok_or(Error::CounterOverflow)?;
        env.storage().persistent().set(&key, &next);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold(), extend_to());
        Ok(next)
    }

    pub fn get_pending_commitment(
        env: &Env,
        election_id: &BytesN<32>,
        ballot_commitment: &BytesN<32>,
    ) -> Option<PendingCommitment> {
        let key = DataKey::pending_commitment_key(election_id, ballot_commitment);
        env.storage().persistent().get(&key)
    }

    /// Check if a commitment already exists in storage.
    pub fn commitment_exists(
        env: &Env,
        election_id: &BytesN<32>,
        ballot_commitment: &BytesN<32>,
    ) -> bool {
        let key = DataKey::pending_commitment_key(election_id, ballot_commitment);
        env.storage()
            .persistent()
            .get::<_, PendingCommitment>(&key)
            .is_some()
    }

    /// Set a pending commitment. Returns an error if the commitment already
    /// exists (duplicate prevention for R1 casts).
    pub fn set_pending_commitment(
        env: &Env,
        election_id: &BytesN<32>,
        ballot_commitment: &BytesN<32>,
        pending: &PendingCommitment,
    ) -> Result<(), Error> {
        let key = DataKey::pending_commitment_key(election_id, ballot_commitment);
        if env
            .storage()
            .persistent()
            .get::<_, PendingCommitment>(&key)
            .is_some()
        {
            return Err(Error::CommitmentAlreadyExists);
        }
        env.storage().persistent().set(&key, pending);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold(), extend_to());
        Ok(())
    }

    /// Update an existing pending commitment (for reveal).
    pub fn update_pending_commitment(
        env: &Env,
        election_id: &BytesN<32>,
        ballot_commitment: &BytesN<32>,
        pending: &PendingCommitment,
    ) {
        let key = DataKey::pending_commitment_key(election_id, ballot_commitment);
        env.storage().persistent().set(&key, pending);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold(), extend_to());
    }

    // --- TTL ---

    pub fn extend_election_keys(env: &Env, election_id: &BytesN<32>) {
        let election_key = DataKey::election_key(election_id);
        env.storage()
            .persistent()
            .extend_ttl(&election_key, threshold(), extend_to());

        let count_key = DataKey::commit_count_key(election_id);
        if env
            .storage()
            .persistent()
            .get::<_, u32>(&count_key)
            .is_some()
        {
            env.storage()
                .persistent()
                .extend_ttl(&count_key, threshold(), extend_to());
        }

        let reveal_key = DataKey::reveal_count_key(election_id);
        if env
            .storage()
            .persistent()
            .get::<_, u32>(&reveal_key)
            .is_some()
        {
            env.storage()
                .persistent()
                .extend_ttl(&reveal_key, threshold(), extend_to());
        }
    }
}
