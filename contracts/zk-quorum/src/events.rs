use soroban_sdk::{contractevent, BytesN, Env};

#[contractevent]
pub struct VoteCastV1 {
    pub election_id: BytesN<32>,
    pub nullifier_hash: BytesN<32>,
    pub vote: u32,
    pub tally_bucket: u32,
    pub public_schema_version: u32,
    pub proof_hash: BytesN<32>,
    pub public_signals_hash: BytesN<32>,
}

#[contractevent]
pub struct VoteCommittedV1 {
    pub election_id: BytesN<32>,
    pub nullifier_hash: BytesN<32>,
    pub ballot_commitment: BytesN<32>,
    pub tally_bucket: u32,
    pub public_schema_version: u32,
    pub proof_hash: BytesN<32>,
    pub public_signals_hash: BytesN<32>,
}

#[contractevent]
pub struct VoteRevealedV1 {
    pub election_id: BytesN<32>,
    pub ballot_commitment: BytesN<32>,
    pub vote: u32,
}

#[allow(clippy::too_many_arguments)]
pub fn emit_vote_cast_v1(
    env: &Env,
    election_id: &BytesN<32>,
    nullifier_hash: &BytesN<32>,
    vote: u32,
    tally_bucket: u32,
    public_schema_version: u32,
    proof_hash: &BytesN<32>,
    public_signals_hash: &BytesN<32>,
) {
    env.events().publish_event(&VoteCastV1 {
        election_id: election_id.clone(),
        nullifier_hash: nullifier_hash.clone(),
        vote,
        tally_bucket,
        public_schema_version,
        proof_hash: proof_hash.clone(),
        public_signals_hash: public_signals_hash.clone(),
    });
}

#[allow(clippy::too_many_arguments)]
pub fn emit_vote_committed_v1(
    env: &Env,
    election_id: &BytesN<32>,
    nullifier_hash: &BytesN<32>,
    ballot_commitment: &BytesN<32>,
    tally_bucket: u32,
    public_schema_version: u32,
    proof_hash: &BytesN<32>,
    public_signals_hash: &BytesN<32>,
) {
    env.events().publish_event(&VoteCommittedV1 {
        election_id: election_id.clone(),
        nullifier_hash: nullifier_hash.clone(),
        ballot_commitment: ballot_commitment.clone(),
        tally_bucket,
        public_schema_version,
        proof_hash: proof_hash.clone(),
        public_signals_hash: public_signals_hash.clone(),
    });
}

pub fn emit_vote_revealed_v1(
    env: &Env,
    election_id: &BytesN<32>,
    ballot_commitment: &BytesN<32>,
    vote: u32,
) {
    env.events().publish_event(&VoteRevealedV1 {
        election_id: election_id.clone(),
        ballot_commitment: ballot_commitment.clone(),
        vote,
    });
}
