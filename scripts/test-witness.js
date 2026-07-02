#!/usr/bin/env node
// Deterministic R0/R1 witness test script for ZK-Quorum.
// Uses .bootstrap/bin/circom for compilation and node_modules/.bin/snarkjs for witness.
//
// Positive tests: witness must pass R1CS constraint check.
// Negative tests: witness generation or constraint check must fail.
//
// Usage: node scripts/test-witness.js

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CIRCOM = resolveCircom(ROOT);
const SNARKJS = path.join(ROOT, 'node_modules/.bin/snarkjs');

function resolveCircom(root) {
    if (process.env.ZKQ_CIRCOM_BIN) {
        const candidate = process.env.ZKQ_CIRCOM_BIN;
        if (!fs.existsSync(candidate) && !fs.existsSync(path.resolve(root, candidate))) {
            console.error(`ERROR: ZKQ_CIRCOM_BIN=${candidate} not found`);
            process.exit(1);
        }
        return path.resolve(root, candidate);
    }
    const canonical = path.join(root, '.bootstrap', 'circom', 'v2.2.3', 'circom');
    if (fs.existsSync(canonical)) return canonical;
    const legacy = path.join(root, '.bootstrap', 'bin', 'circom');
    if (fs.existsSync(legacy)) return legacy;
    console.error('ERROR: circom 2.2.3 not found. Set ZKQ_CIRCOM_BIN or run bootstrap.');
    process.exit(1);
}
const BUILD = path.join(ROOT, 'circuits/build');
const FIXTURES = path.join(ROOT, 'circuits/artifacts/fixtures');

let passed = 0;
let failed = 0;
const failures = [];

function isExpectedRejection(e, phase) {
    if (e.code === 'ENOENT') return false;
    if (e.signal) return false;
    const combined = ((e.stderr || '') + (e.stdout || '')).toLowerCase();
    if (!combined) return false;
    if (/enoent|no such file|cannot find module|cannot open|not found|spawn/i.test(combined)) return false;
    if (phase === 'witness' || phase === 'constraint') {
        return /\[error\]|constraint|assert\b|error:/i.test(combined);
    }
    return false;
}

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

// expectFailStage: 'witness' = must fail at witness generation, 'constraints' = must pass witness gen but fail constraints, null = expectPass
function runWitnessCheck(testName, circuitName, fixtureFile, expectPass, expectFailStage) {
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
    const tmpDir = path.join(ROOT, 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });

    const inputJson = path.join(tmpDir, `witness_input_${testName.replace(/[^a-zA-Z0-9]/g,'_')}.json`);
    const wtnsFile = path.join(tmpDir, `witness_${testName.replace(/[^a-zA-Z0-9]/g,'_')}.wtns`);

    fs.writeFileSync(inputJson, JSON.stringify(input));

    function runSnarkjs(args, opts) {
        try {
            return execFileSync(SNARKJS, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: opts?.timeout || 30000, maxBuffer: 10 * 1024 * 1024 });
        } catch (e) {
            throw Object.assign(new Error('snarkjs failed'), { stderr: e.stderr || '', stdout: e.stdout || '', code: e.code || null, status: e.status, signal: e.signal || null, message: e.message });
        }
    }

    try {
        runSnarkjs(['wc', wasmFile, inputJson, wtnsFile]);

        if (!expectPass) {
            try {
                runSnarkjs(['wchk', r1csFile, wtnsFile]);
                fail(testName, 'negative test: witness generated and passed constraints (should have failed)');
                return;
            } catch (e2) {
                if (expectFailStage === 'witness') {
                    fail(testName, 'expected failure at witness generation, but witness succeeded and constraints failed');
                    return;
                }
                if (!isExpectedRejection(e2, 'constraint')) {
                    fail(testName, `negative test: unrecognized constraint error — gate must fail: ${(e2.stderr || e2.message).slice(0,200)}`);
                    return;
                }
                ok(testName + ' [correctly rejected at constraints]');
                return;
            }
        }

        runSnarkjs(['wchk', r1csFile, wtnsFile]);
        ok(testName);
    } catch (e) {
        if (expectPass) {
            fail(testName, `positive test failed: ${(e.stderr || e.message).slice(0,200)}`);
            return;
        }
        if (expectFailStage && expectFailStage !== 'witness') {
            fail(testName, `expected constraints-level rejection, but witness gen failed: ${(e.stderr || e.message).slice(0,200)}`);
            return;
        }
        if (!isExpectedRejection(e, 'witness')) {
            fail(testName, `negative test: unrecognized witness error — gate must fail: ${(e.stderr || e.message).slice(0,200)}`);
            return;
        }
        ok(testName + ' [correctly rejected at witness gen]');
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
runWitnessCheck('r0-positive-vote-0', 'public-vote', 'r0-vote-0.json', true, null);
runWitnessCheck('r0-boundary-4-of-5', 'public-vote', 'r0-boundary-4-of-5.json', true, null);
runWitnessCheck('r0-negative-vote-5-of-5', 'public-vote', 'r0-vote-out-of-range.json', false, 'witness');
runWitnessCheck('r0-negative-wrong-root', 'public-vote', 'r0-wrong-root.json', false, 'witness');
runWitnessCheck('r0-negative-zero-asp', 'public-vote', 'r0-zero-asp.json', false, 'witness');
runWitnessCheck('r0-negative-zero-options', 'public-vote', 'r0-zero-options.json', false, 'witness');
runWitnessCheck('r0-negative-label-zero', 'public-vote', 'r0-label-zero.json', false, 'witness');
runWitnessCheck('r0-negative-nullifier-zero', 'public-vote', 'r0-nullifier-zero.json', false, 'witness');
runWitnessCheck('r0-negative-options-17', 'public-vote', 'r0-options-17.json', false, 'witness');
runWitnessCheck('r0-negative-wrong-asp-path', 'public-vote', 'r0-wrong-asp-path.json', false, 'witness');
console.log('');

// ========= R0 Scope Vector Tests (ledger §13) =========
console.log('R0 Scope Vector Tests:');
runWitnessCheck('r0-scope-a', 'public-vote', 'r0-scope-a.json', true, null);
runWitnessCheck('r0-scope-b', 'public-vote', 'r0-scope-b.json', true, null);
runWitnessCheck('r0-scope-c', 'public-vote', 'r0-scope-c.json', true, null);
runWitnessCheck('r0-derived-scope', 'public-vote', 'r0-derived-scope.json', true, null);
runWitnessCheck('r0-non-ascii-scope', 'public-vote', 'r0-non-ascii-scope.json', true, null);
runWitnessCheck('r0-altered-scope-positive', 'public-vote', 'r0-altered-scope.json', true, null);
console.log('');

// ========= R1 Tests =========
console.log('R1 Commit/Reveal Tests:');
runWitnessCheck('r1-positive-vote-3', 'commit-vote', 'r1-vote-3-salt-42.json', true, null);
runWitnessCheck('r1-boundary-4-of-5', 'commit-vote', 'r1-boundary-4-of-5.json', true, null);
runWitnessCheck('r1-negative-zero-salt', 'commit-vote', 'r1-zero-salt.json', false, 'witness');
runWitnessCheck('r1-negative-vote-out-of-range', 'commit-vote', 'r1-vote-out-of-range.json', false, 'witness');
runWitnessCheck('r1-negative-zero-options', 'commit-vote', 'r1-zero-options.json', false, 'witness');
runWitnessCheck('r1-negative-label-zero', 'commit-vote', 'r1-label-zero.json', false, 'witness');
runWitnessCheck('r1-negative-nullifier-zero', 'commit-vote', 'r1-nullifier-zero.json', false, 'witness');
runWitnessCheck('r1-negative-options-17', 'commit-vote', 'r1-options-17.json', false, 'witness');
runWitnessCheck('r1-negative-wrong-asp-path', 'commit-vote', 'r1-wrong-asp-path.json', false, 'witness');
runWitnessCheck('r1-derived-scope', 'commit-vote', 'r1-derived-scope.json', true, null);
runWitnessCheck('r1-altered-scope-positive', 'commit-vote', 'r1-altered-scope.json', true, null);
runWitnessCheck('r1-wrong-commitment-positive', 'commit-vote', 'r1-wrong-commitment.json', true, null);
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
