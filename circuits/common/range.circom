// SPDX-License-Identifier: MIT
// Range check using boolean decomposition of optionCount-1, vote, and delta=optionCount-vote-1
// No circomlib dependency
// bitCount = ceil(log2(MAX_OPTIONS)) = 4 for MAX_OPTIONS=16

pragma circom 2.0.0;

include "./gadgets.circom";

template VoteRangeCheck(bitCount) {
    signal input vote;
    signal input optionCount;

    signal optionMinusOne <== optionCount - 1;
    signal delta <== optionMinusOne - vote;

    component voteBits = Num2Bits(bitCount);
    voteBits.in <== vote;

    component optMinusOneBits = Num2Bits(bitCount);
    optMinusOneBits.in <== optionMinusOne;

    component deltaBits = Num2Bits(bitCount);
    deltaBits.in <== delta;
}
