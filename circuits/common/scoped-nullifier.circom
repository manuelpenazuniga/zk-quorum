// SPDX-License-Identifier: MIT
// Scoped nullifier: nullifierHash = P2(nullifierSecret, electionScope)
// Matches plan §6.1: anti-replay via election-scoped nullifier.
// nullifierSecret != 0 is enforced; a zero secret would produce a
// collision-prone nullifier across credentials sharing the same scope.

pragma circom 2.0.0;

include "./poseidon255.circom";
include "./gadgets.circom";

template ScopedNullifier() {
    signal input nullifierSecret;
    signal input electionScope;

    signal output nullifierHash;

    component nsNonZero = IsZero();
    nsNonZero.in <== nullifierSecret;
    nsNonZero.out === 0;

    component hasher = Poseidon255(2);
    hasher.in[0] <== nullifierSecret;
    hasher.in[1] <== electionScope;

    nullifierHash <== hasher.out;
}
