// SPDX-License-Identifier: MIT
// Membership proofs: credentialCommitment in stateRoot, label in associationRoot
// No zero bypass — ASP mandatory

pragma circom 2.0.0;

include "./merkleProof.circom";
include "./gadgets.circom";

template MembershipProof(depth) {
    signal input credentialCommitment;
    signal input label;
    signal input stateIndex;
    signal input stateSiblings[depth];
    signal input associationIndex;
    signal input associationSiblings[depth];

    signal input stateRoot;
    signal input associationRoot;

    component stateProof = MerkleProof(depth);
    stateProof.leaf <== credentialCommitment;
    stateProof.leafIndex <== stateIndex;
    stateProof.siblings <== stateSiblings;

    stateRoot === stateProof.out;

    component associationProof = MerkleProof(depth);
    associationProof.leaf <== label;
    associationProof.leafIndex <== associationIndex;
    associationProof.siblings <== associationSiblings;

    associationRoot === associationProof.out;

    component labelNonZero = IsZero();
    labelNonZero.in <== label;
    labelNonZero.out === 0;

    component associationRootNonZero = IsZero();
    associationRootNonZero.in <== associationRoot;
    associationRootNonZero.out === 0;
}
