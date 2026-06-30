#!/usr/bin/env node
// Extract Poseidon255 round constants and MDS matrix for t=3 from Circom source.
// Outputs JSON for consumption by the independent BigInt verification engine.
// Usage: node scripts/extract-poseidon-constants.js > circuits/artifacts/fixtures/poseidon_constants_t3.json

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
    path.join(__dirname, '..', 'circuits', 'common', 'poseidon255_constants.circom'),
    'utf8'
);

function parseHexArray(str) {
    const hexes = [];
    const re = /0x([0-9a-fA-F]+)/g;
    let m;
    while ((m = re.exec(str)) !== null) {
        hexes.push('0x' + m[1]);
    }
    return hexes;
}

// Extract CONSTANTS for t=3: find the block between "else if (t == 3)" and "} else if (t == 4)"
const constantsMatch = src.match(/else if \(t == 3\) \{\s*return (\[[\s\S]*?\]);/);
if (!constantsMatch) throw new Error('Failed to extract CONSTANTS(t=3)');
const constants = parseHexArray(constantsMatch[1]);

// Extract MATRIX for t=3
const matrixMatch = src.match(/else if \(t == 3\) \{[\s\S]*?return\s*(\[[\s\S]*?\])\s*;/);
// The first "else if (t == 3)" in the file is CONSTANTS, the second is MATRIX
// Find the second occurrence
const secondT3 = src.indexOf('else if (t == 3)', src.indexOf('MATRIX'));
const matrixSection = src.slice(secondT3);
const matrixArrMatch = matrixSection.match(/return\s*(\[[\s\S]*?\])\s*;/);
if (!matrixArrMatch) throw new Error('Failed to extract MATRIX(t=3)');

// Parse the matrix: it's [ [a,b,c], [d,e,f], [g,h,i] ]
const matrixText = matrixArrMatch[1];
const rowHexes = matrixText.split('],').map(part => parseHexArray(part));

const output = {
    description: 'Poseidon255 constants for t=3 (rate=2) over BLS12-381 Fr. Extracted from poseidon255_constants.circom.',
    bls12_381_scalar_modulus: '0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001',
    t: 3,
    nInputs: 2,
    nFullRounds: 8,
    nPartialRounds: 56,
    fullRoundsFirst: 4,
    fullRoundsLast: 4,
    totalRounds: 64,
    roundConstants: constants,
    mdsMatrix: rowHexes
};

console.log(JSON.stringify(output, null, 2));
