// SPDX-License-Identifier: MIT
// Scoped nullifier: nullifierHash = P2(nullifierSecret, electionScope)
// Matches plan §6.1: anti-replay via election-scoped nullifier

pragma circom 2.0.0;

include "./poseidon255.circom";

template ScopedNullifier() {
    signal input nullifierSecret;
    signal input electionScope;

    signal output nullifierHash;

    component hasher = Poseidon255(2);
    hasher.in[0] <== nullifierSecret;
    hasher.in[1] <== electionScope;

    nullifierHash <== hasher.out;
}
