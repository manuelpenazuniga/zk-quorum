use soroban_sdk::{contracttype, BytesN, Vec};

pub const MAX_OPTIONS: u32 = 16;
pub const TALLY_BUCKETS: u32 = 16;

pub const PUBLIC_SCHEMA_V1_R0: u32 = 1;
pub const PUBLIC_SCHEMA_V1_R1: u32 = 2;

pub const PUBLIC_SIGNALS_R0_LEN: u32 = 6;
pub const PUBLIC_SIGNALS_R1_LEN: u32 = 6;

pub const PUBLIC_SIGNALS_R0_NULLIFIER: u32 = 0;
pub const PUBLIC_SIGNALS_R0_VOTE: u32 = 1;
pub const PUBLIC_SIGNALS_R0_OPTION_COUNT: u32 = 2;
pub const PUBLIC_SIGNALS_R0_STATE_ROOT: u32 = 3;
pub const PUBLIC_SIGNALS_R0_ASSOCIATION_ROOT: u32 = 4;
pub const PUBLIC_SIGNALS_R0_ELECTION_SCOPE: u32 = 5;

pub const PUBLIC_SIGNALS_R1_NULLIFIER: u32 = 0;
pub const PUBLIC_SIGNALS_R1_COMMITMENT: u32 = 1;
pub const PUBLIC_SIGNALS_R1_OPTION_COUNT: u32 = 2;
pub const PUBLIC_SIGNALS_R1_STATE_ROOT: u32 = 3;
pub const PUBLIC_SIGNALS_R1_ASSOCIATION_ROOT: u32 = 4;
pub const PUBLIC_SIGNALS_R1_ELECTION_SCOPE: u32 = 5;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ElectionMode {
    R0 = 0,
    R1 = 1,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ElectionStatus {
    Pending = 0,
    Open = 1,
    Closed = 2,
    RevealOpen = 3,
    RevealClosed = 4,
}

/// Election configuration stored in persistent storage.
/// Status is NOT stored; it is computed dynamically from timestamps.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ElectionConfig {
    pub election_scope: BytesN<32>,
    pub mode: ElectionMode,
    pub state_root: BytesN<32>,
    pub association_root: BytesN<32>,
    pub option_count: u32,
    pub opens_at: u64,
    pub closes_at: u64,
    pub reveal_closes_at: u64,
}

impl ElectionConfig {
    pub fn compute_status(&self, now: u64) -> ElectionStatus {
        if now < self.opens_at {
            ElectionStatus::Pending
        } else if now < self.closes_at {
            ElectionStatus::Open
        } else if self.mode == ElectionMode::R1 && now < self.reveal_closes_at {
            ElectionStatus::RevealOpen
        } else if self.mode == ElectionMode::R1 {
            ElectionStatus::RevealClosed
        } else {
            ElectionStatus::Closed
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ElectionSummary {
    pub commit_count: u32,
    pub reveal_count: u32,
    pub non_reveal_count: u32,
    pub tally: Vec<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuditSummary {
    pub commit_count: u32,
    pub reveal_count: u32,
    pub non_reveal_count: u32,
    pub tally: Vec<u64>,
    pub option_count: u32,
    pub mode: ElectionMode,
    pub state_root: BytesN<32>,
    pub association_root: BytesN<32>,
    pub election_scope: BytesN<32>,
    pub status: ElectionStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingCommitment {
    pub bucket: u32,
    pub revealed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Verifier,
    VkR0,
    VkR1,
    VkR0Hash,
    VkR1Hash,
    ContractVersion,
    Election(BytesN<32>),
    Nullifier(BytesN<32>, BytesN<32>),
    TallyBucket(BytesN<32>, u32, u32),
    PendingCommitment(BytesN<32>, BytesN<32>),
    CommitCount(BytesN<32>),
    RevealCount(BytesN<32>),
}

impl DataKey {
    pub fn election_key(election_id: &BytesN<32>) -> Self {
        DataKey::Election(election_id.clone())
    }

    pub fn nullifier_key(election_id: &BytesN<32>, nullifier_hash: &BytesN<32>) -> Self {
        DataKey::Nullifier(election_id.clone(), nullifier_hash.clone())
    }

    pub fn tally_bucket_key(election_id: &BytesN<32>, option: u32, bucket: u32) -> Self {
        DataKey::TallyBucket(election_id.clone(), option, bucket)
    }

    pub fn pending_commitment_key(
        election_id: &BytesN<32>,
        ballot_commitment: &BytesN<32>,
    ) -> Self {
        DataKey::PendingCommitment(election_id.clone(), ballot_commitment.clone())
    }

    pub fn commit_count_key(election_id: &BytesN<32>) -> Self {
        DataKey::CommitCount(election_id.clone())
    }

    pub fn reveal_count_key(election_id: &BytesN<32>) -> Self {
        DataKey::RevealCount(election_id.clone())
    }
}

pub fn tally_bucket_from_nullifier(nullifier_hash: &BytesN<32>) -> u32 {
    let last_byte = nullifier_hash.get(31).unwrap_or(0);
    (last_byte & 0x0F) as u32
}
