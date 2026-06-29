// SPDX-License-Identifier: MIT
// Credential commitment: P2(label, P2(nullifierSecret, trapdoor))
// Matches plan §6.1 with P2 sequential hashing only

pragma circom 2.0.0;

include "./poseidon255.circom";

template CredentialHasher() {
    signal input label;
    signal input nullifierSecret;
    signal input trapdoor;

    signal output credentialCommitment;

    component precommitHasher = Poseidon255(2);
    precommitHasher.in[0] <== nullifierSecret;
    precommitHasher.in[1] <== trapdoor;

    component credHasher = Poseidon255(2);
    credHasher.in[0] <== label;
    credHasher.in[1] <== precommitHasher.out;

    credentialCommitment <== credHasher.out;
}
