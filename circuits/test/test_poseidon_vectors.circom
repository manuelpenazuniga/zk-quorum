// SPDX-License-Identifier: MIT
// Golden vector test for P2(a,b) and P3seq(a,b,c) = P2(P2(a,b),c)

pragma circom 2.0.0;

include "../common/poseidon255.circom";

template TestPoseidonVectors() {
    signal input a;
    signal input b;
    signal input c;

    signal output p2;
    signal output p3seq;
    signal output p2_identity;      // P2(0,0)
    signal output p2_large;

    component hasher_p2 = Poseidon255(2);
    hasher_p2.in[0] <== a;
    hasher_p2.in[1] <== b;
    p2 <== hasher_p2.out;

    component hasher_inner = Poseidon255(2);
    hasher_inner.in[0] <== a;
    hasher_inner.in[1] <== b;

    component hasher_outer = Poseidon255(2);
    hasher_outer.in[0] <== hasher_inner.out;
    hasher_outer.in[1] <== c;
    p3seq <== hasher_outer.out;

    component hasher_p2_zero = Poseidon255(2);
    hasher_p2_zero.in[0] <== 0;
    hasher_p2_zero.in[1] <== 0;
    p2_identity <== hasher_p2_zero.out;

    component hasher_p2_large = Poseidon255(2);
    hasher_p2_large.in[0] <== 1234567890;
    hasher_p2_large.in[1] <== 9876543210;
    p2_large <== hasher_p2_large.out;
}

component main {public [a, b, c]} = TestPoseidonVectors();
