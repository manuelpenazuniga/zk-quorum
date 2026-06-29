// SPDX-License-Identifier: MIT
// Rung 1: Commit/reveal vote with hidden identity
// ballotCommitment = P2(P2(vote, salt), electionScope)
// Public schema V1_R1: nullifierHash, ballotCommitment, optionCount, stateRoot, associationRoot, electionScope
// Depth: 10, MAX_OPTIONS: 16
// salt != 0 enforced

pragma circom 2.0.0;

include "../common/credential.circom";
include "../common/membership.circom";
include "../common/scoped-nullifier.circom";
include "../common/range.circom";
include "../common/poseidon255.circom";
include "../common/gadgets.circom";

template CommitVoteR1(depth) {
    signal output nullifierHash;
    signal output ballotCommitment;

    signal input optionCount;
    signal input stateRoot;
    signal input associationRoot;
    signal input electionScope;

    signal input label;
    signal input nullifierSecret;
    signal input trapdoor;
    signal input vote;
    signal input salt;
    signal input stateSiblings[depth];
    signal input stateIndex;
    signal input associationSiblings[depth];
    signal input associationIndex;

    component credHasher = CredentialHasher();
    credHasher.label <== label;
    credHasher.nullifierSecret <== nullifierSecret;
    credHasher.trapdoor <== trapdoor;

    component membership = MembershipProof(depth);
    membership.credentialCommitment <== credHasher.credentialCommitment;
    membership.label <== label;
    membership.stateIndex <== stateIndex;
    membership.stateSiblings <== stateSiblings;
    membership.associationIndex <== associationIndex;
    membership.associationSiblings <== associationSiblings;
    membership.stateRoot <== stateRoot;
    membership.associationRoot <== associationRoot;

    component nullifier = ScopedNullifier();
    nullifier.nullifierSecret <== nullifierSecret;
    nullifier.electionScope <== electionScope;
    nullifierHash <== nullifier.nullifierHash;

    component rangeCheck = VoteRangeCheck(4);
    rangeCheck.vote <== vote;
    rangeCheck.optionCount <== optionCount;

    component saltNonZero = IsZero();
    saltNonZero.in <== salt;
    saltNonZero.out === 0;

    component innerHasher = Poseidon255(2);
    innerHasher.in[0] <== vote;
    innerHasher.in[1] <== salt;

    component outerHasher = Poseidon255(2);
    outerHasher.in[0] <== innerHasher.out;
    outerHasher.in[1] <== electionScope;
    ballotCommitment <== outerHasher.out;
}

component main {public [optionCount, stateRoot, associationRoot, electionScope]} = CommitVoteR1(10);
