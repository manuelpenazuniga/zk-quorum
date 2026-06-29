// SPDX-License-Identifier: MIT
// Golden vector for credential commitment

pragma circom 2.0.0;

include "../common/credential.circom";

template TestCredential() {
    signal input label;
    signal input nullifierSecret;
    signal input trapdoor;

    signal output credentialCommitment;

    component hasher = CredentialHasher();
    hasher.label <== label;
    hasher.nullifierSecret <== nullifierSecret;
    hasher.trapdoor <== trapdoor;

    credentialCommitment <== hasher.credentialCommitment;
}

component main {public [label, nullifierSecret, trapdoor]} = TestCredential();
