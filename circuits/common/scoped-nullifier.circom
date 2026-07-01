// SPDX-License-Identifier: MIT
// Scoped nullifier: nullifierHash = P2(nullifierSecret, electionScope)
// Matches plan §6.1: anti-replay via election-scoped nullifier
//
// TRUST BOUNDARY: nullifierSecret=0 is NOT constrained here.
// If nullifierSecret=0, the nullifier collides across credentials that share
// the same (electionScope). The issuer is trusted to generate CSPRNG secrets.
// Adding a nonzero constraint is feasible but does not strengthen the model
// beyond the issuer trust boundary already assumed for credential issuance.

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
