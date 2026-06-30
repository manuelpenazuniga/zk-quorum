#!/usr/bin/env node
// Deterministic R0/R1 witness test script for ZK-Quorum.
// Uses .bootstrap/bin/circom for compilation and node_modules/.bin/snarkjs for witness.
//
// Positive tests: witness must pass R1CS constraint check.
// Negative tests: witness generation or constraint check must fail.
//
// Usage: node scripts/test-witness.js

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CIRCOM = path.join(ROOT, '.bootstrap/bin/circom');
const SNARKJS = path.join(ROOT, 'node_modules/.bin/snarkjs');
const BUILD = path.join(ROOT, 'circuits/build');
const FIXTURES = path.join(ROOT, 'circuits/artifacts/fixtures');

let passed = 0;
let failed = 0;
const failures = [];

function log(msg) { console.log(`  ${msg}`); }
function ok(name) { console.log(`  ✓ ${name}`); passed++; }
function fail(name, reason) {
    console.log(`  ✗ ${name}: ${reason}`);
    failed++;
    failures.push({name, reason});
}

// Compile circuit if not already compiled
function compileCircuit(name, circomFile) {
    const outDir = path.join(BUILD, name);
    const r1cs = path.join(outDir, 'main.r1cs');
    if (fs.existsSync(r1cs)) {
        log(`${name}: using cached compilation`);
        return;
    }
    fs.mkdirSync(outDir, { recursive: true });
    const cmd = `${CIRCOM} --prime bls12381 --r1cs --sym --wasm --output ${outDir} ${circomFile}`;
    log(`${name}: compiling...`);
    execSync(cmd, { stdio: 'pipe', cwd: ROOT });
}

// Run snarkjs witness calculation and check
function runWitnessCheck(testName, circuitName, fixtureFile, expectPass) {
    const fixturePath = path.join(FIXTURES, fixtureFile);
    if (!fs.existsSync(fixturePath)) {
        fail(testName, `fixture not found: ${fixtureFile}`);
        return;
    }

    const rawInput = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    delete rawInput._meta;
    const input = rawInput;
    const circuitDir = path.join(BUILD, circuitName);
    const wasmFile = path.join(circuitDir, 'main_js/main.wasm');
    const r1csFile = path.join(circuitDir, 'main.r1cs');
    const symFile = path.join(circuitDir, 'main.sym');
    const tmpDir = path.join(ROOT, 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });

    const inputJson = path.join(tmpDir, `witness_input_${testName.replace(/[^a-zA-Z0-9]/g,'_')}.json`);
    const wtnsFile = path.join(tmpDir, `witness_${testName.replace(/[^a-zA-Z0-9]/g,'_')}.wtns`);

    fs.writeFileSync(inputJson, JSON.stringify(input));

    try {
        // Generate witness
        const wcCmd = `${SNARKJS} wc ${wasmFile} ${inputJson} ${wtnsFile}`;
        execSync(wcCmd, { stdio: 'pipe', cwd: ROOT, timeout: 30000 });

        if (!expectPass) {
            // If we expected failure but witness generation succeeded, check constraints manually
            try {
                const checkCmd = `${SNARKJS} wchk ${r1csFile} ${wtnsFile}`;
                execSync(checkCmd, { stdio: 'pipe', cwd: ROOT, timeout: 30000 });
                fail(testName, 'negative test: witness generated and passed constraints (should have failed)');
            } catch (e2) {
                ok(testName + ' [correctly rejected]');
            }
        } else {
            // Positive test: check constraints
            const checkCmd = `${SNARKJS} wchk ${r1csFile} ${wtnsFile}`;
            execSync(checkCmd, { stdio: 'pipe', cwd: ROOT, timeout: 30000 });
            ok(testName);
        }
    } catch (e) {
        if (expectPass) {
            fail(testName, `positive test failed: ${e.stderr ? e.stderr.toString().slice(0,200) : e.message}`);
        } else {
            ok(testName + ' [correctly rejected]');
        }
    }
}

console.log('ZK-Quorum Deterministic Witness Tests');
console.log('====================================\n');

// Compile circuits
console.log('Compilation:');
compileCircuit('public-vote', path.join(ROOT, 'circuits/public-vote/main.circom'));
compileCircuit('commit-vote', path.join(ROOT, 'circuits/commit-vote/main.circom'));
console.log('');

// ========= R0 Tests =========
console.log('R0 Public Vote Tests:');
runWitnessCheck('r0-positive-vote-0', 'public-vote', 'r0-vote-0.json', true);
runWitnessCheck('r0-negative-vote-5-of-5', 'public-vote', 'r0-vote-out-of-range.json', false);
runWitnessCheck('r0-negative-wrong-root', 'public-vote', 'r0-wrong-root.json', false);
runWitnessCheck('r0-negative-zero-asp', 'public-vote', 'r0-zero-asp.json', false);
runWitnessCheck('r0-negative-zero-options', 'public-vote', 'r0-zero-options.json', false);
console.log('');

// ========= R0 Scope Vector Tests (ledger §13) =========
console.log('R0 Scope Vector Tests:');
runWitnessCheck('r0-scope-a', 'public-vote', 'r0-scope-a.json', true);
runWitnessCheck('r0-scope-b', 'public-vote', 'r0-scope-b.json', true);
runWitnessCheck('r0-scope-c', 'public-vote', 'r0-scope-c.json', true);
runWitnessCheck('r0-derived-scope', 'public-vote', 'r0-derived-scope.json', true);
console.log('');

// ========= R1 Tests =========
console.log('R1 Commit/Reveal Tests:');
runWitnessCheck('r1-positive-vote-3', 'commit-vote', 'r1-vote-3-salt-42.json', true);
runWitnessCheck('r1-negative-zero-salt', 'commit-vote', 'r1-zero-salt.json', false);
runWitnessCheck('r1-negative-vote-out-of-range', 'commit-vote', 'r1-vote-out-of-range.json', false);
runWitnessCheck('r1-negative-zero-options', 'commit-vote', 'r1-zero-options.json', false);
runWitnessCheck('r1-derived-scope', 'commit-vote', 'r1-derived-scope.json', true);
console.log('');

// Cleanup tmp
fs.rmSync(path.join(ROOT, 'tmp'), { recursive: true, force: true });

// Summary
console.log('====================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f.name}: ${f.reason}`));
    process.exit(1);
} else {
    console.log('All witness tests passed.');
}
