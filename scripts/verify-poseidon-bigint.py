#!/usr/bin/env python3
"""Independent Poseidon255 verification engine using pure Python big integers.

Verifies golden vectors against Circom poseidon255.circom output WITHOUT using
Circom, snarkjs, or soroban-poseidon. Uses only Python's built-in pow() and
big integer arithmetic on the BLS12-381 scalar field.

This is the third independent engine required by Gate C0.
"""
import json
import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)


def load_constants():
    path = os.path.join(ROOT, 'circuits', 'artifacts', 'fixtures', 'poseidon_constants_t3.json')
    with open(path) as f:
        return json.load(f)


def load_golden_vectors():
    path = os.path.join(ROOT, 'circuits', 'artifacts', 'fixtures', 'golden_vectors.json')
    with open(path) as f:
        return json.load(f)


def poseidon255_p2(a_int, b_int, modulus, round_constants, mds_matrix):
    """Compute P2(a, b) = Poseidon255 of two inputs over BLS12-381 Fr.

    Implements the Poseidon255 permutation exactly as poseidon255.circom:
    - State size t = 3 (nInputs=2, rate=2, capacity=1)
    - N_F = 8 full rounds (4 before, 4 after)
    - N_P = 56 partial rounds
    - S-box: x^5 applied to all elements in full rounds, only element 0 in partial rounds
    - ARK: add round constants
    - MDS: matrix multiplication with 3x3 matrix
    """
    t = 3
    n_full_half = 4
    n_partial = 56
    total_rounds = n_full_half + n_partial + n_full_half  # 64

    # Initialize state: [capacity=0, in[0]=a, in[1]=b]
    state = [0, a_int, b_int]

    # Helper: modular multiplication
    def mul(x, y):
        return (x * y) % modulus

    def add(x, y):
        return (x + y) % modulus

    def sbox(x):
        return pow(x, 5, modulus)

    for r in range(total_rounds):
        # ARK: add round constants
        for j in range(t):
            rc = int(round_constants[r * t + j], 16)
            state[j] = add(state[j], rc)

        # S-box (applied BEFORE MDS in Circom poseidon255.circom)
        if r < n_full_half or r >= n_full_half + n_partial:
            # Full round: apply x^5 to all elements
            for j in range(t):
                state[j] = sbox(state[j])
        else:
            # Partial round: apply x^5 only to element 0
            state[0] = sbox(state[0])

        # MDS: matrix multiplication state = M * state
        new_state = [0, 0, 0]
        for i in range(t):
            for j in range(t):
                m_ij = int(mds_matrix[i][j], 16)
                new_state[i] = add(new_state[i], mul(m_ij, state[j]))
        state = new_state

    return state[0]


def main():
    constants = load_constants()
    golden = load_golden_vectors()

    modulus = int(constants['bls12_381_scalar_modulus'], 16)
    rc = constants['roundConstants']
    mds = constants['mdsMatrix']

    def p2(a, b):
        return poseidon255_p2(a, b, modulus, rc, mds)

    def p3seq(a, b, c):
        return p2(p2(a, b), c)

    passed = 0
    failed = 0

    vectors = [
        ('p2(1,2)', p2(1, 2), golden['vectors']['p2(1,2)']),
        ('p3seq(1,2,3)', p3seq(1, 2, 3), golden['vectors']['p3seq(1,2,3)']),
        ('p2(0,0)', p2(0, 0), golden['vectors']['p2(0,0)']),
        ('p2(1234567890,9876543210)', p2(1234567890, 9876543210), golden['vectors']['p2(1234567890,9876543210)']),
        (
            'credentialCommitment(111,222,333)',
            p2(111, p2(222, 333)),
            golden['vectors']['credentialCommitment(label=111,nullifierSecret=222,trapdoor=333)']
        ),
    ]

    print('Independent BigInt Poseidon255 Verification (Python)')
    print('==================================================')
    print(f'Modulus: BLS12-381 Fr')
    print(f'Engine: pure Python big-integer arithmetic')
    print()

    for name, computed, expected_str in vectors:
        expected = int(expected_str)
        status = 'PASS' if computed == expected else 'FAIL'
        if computed == expected:
            passed += 1
        else:
            failed += 1
        print(f'  [{status}] {name}')
        if computed != expected:
            print(f'         computed: {computed}')
            print(f'         expected: {expected}')

    print()
    print(f'Results: {passed} passed, {failed} failed')

    if failed > 0:
        print('\nINDEPENDENT VERIFICATION FAILED')
        sys.exit(1)
    else:
        print('All golden vectors verified by independent engine.')
        sys.exit(0)


if __name__ == '__main__':
    main()
