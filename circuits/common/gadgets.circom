// SPDX-License-Identifier: MIT
// Local gadgets: Num2Bits, IsZero, MultiMux1
// No circomlib dependency — self-contained

pragma circom 2.0.0;

template Num2Bits(n) {
    signal input in;
    signal output out[n];

    var lc1 = 0;
    for (var i = 0; i < n; i++) {
        out[i] <-- (in >> i) & 1;
        out[i] * (out[i] - 1) === 0;
        lc1 += out[i] * (2 ** i);
    }
    lc1 === in;
}

template IsZero() {
    signal input in;
    signal output out;

    signal inv;
    inv <-- in != 0 ? 1 / in : 0;
    out <== -in * inv + 1;
    in * out === 0;
}

template MultiMux1() {
    signal input c[2][2];
    signal input s;
    signal output out[2];

    s * (s - 1) === 0;

    for (var j = 0; j < 2; j++) {
        out[j] <== c[0][j] + s * (c[1][j] - c[0][j]);
    }
}
