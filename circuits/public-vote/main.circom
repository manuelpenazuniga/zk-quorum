// SPDX-License-Identifier: MIT
// Rung 0: Public vote with hidden identity/credential
// Public schema V1_R0: nullifierHash, vote, optionCount, stateRoot, associationRoot, electionScope
// Depth: 10, MAX_OPTIONS: 16

pragma circom 2.0.0;

include "../common/credential.circom";
include "../common/membership.circom";
include "../common/scoped-nullifier.circom";
include "../common/range.circom";

template PublicVoteR0(depth) {
    signal output nullifierHash;

    signal input vote;
    signal input optionCount;
    signal input stateRoot;
    signal input associationRoot;
    signal input electionScope;

    signal input label;
    signal input nullifierSecret;
    signal input trapdoor;
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
}

component main {public [vote, optionCount, stateRoot, associationRoot, electionScope]} = PublicVoteR0(10);
