// SPDX-License-Identifier: MIT
// Copyright (c) 2024
// Adapted from stellar/soroban-examples privacy-pools (MIT licensed)
// commit: 7b168174ae1268dab91a0190d80a94ab7ff41b59
// Modified: local Num2Bits and MultiMux1 (no circomlib)

pragma circom 2.0.0;

include "./poseidon255.circom";
include "./gadgets.circom";

template MerkleProof(depth) {
    signal input leaf;
    signal input leafIndex;
    signal input siblings[depth];

    signal output out;

    signal nodes[depth + 1];
    signal indices[depth];

    component hashInCorrectOrder[depth];
    component hashes[depth];

    component indexToPath = Num2Bits(depth);
    indexToPath.in <== leafIndex;
    indices <== indexToPath.out;

    nodes[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        var childrenToSort[2][2] = [ [nodes[i], siblings[i]], [siblings[i], nodes[i]] ];
        hashInCorrectOrder[i] = MultiMux1();
        hashInCorrectOrder[i].c <== childrenToSort;
        hashInCorrectOrder[i].s <== indices[i];

        hashes[i] = Poseidon255(2);
        hashes[i].in <== hashInCorrectOrder[i].out;

        nodes[i + 1] <== hashes[i].out;
    }

    out <== nodes[depth];
}
