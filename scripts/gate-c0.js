#!/usr/bin/env node
// ZK-Quorum Gate C0 — Groth16 proof verification and mutation harness.
//
// Verifies:
//   1. Artifact hashes/provenance against committed manifests.
//   2. Generate positive proofs for R0/R1 and run snarkjs verify.
//   3. Mutated proofs/public signals fail for the expected reason/class.
//   4. Fr canonical parsing/serialization round-trip (gate before contract).
//
// Usage: node scripts/gate-c0.js
// Exit code: non-zero on any failure.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SNARKJS = path.join(ROOT, 'node_modules', '.bin', 'snarkjs');

let passed = 0;
let failed = 0;

function ok(name) { console.log(`  [PASS] ${name}`); passed++; }
function fail(name, reason) {
    console.log(`  [FAIL] ${name}: ${reason}`);
    failed++;
}

function sha256File(filePath) {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function snarkjsCmd(args, opts) {
    try {
        return execFileSync(SNARKJS, args, {
            cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
            timeout: opts?.timeout || 300000, maxBuffer: opts?.maxBuffer || 50 * 1024 * 1024
        });
    } catch (e) {
        return { error: true, stdout: e.stdout || '', stderr: e.stderr || '', message: e.message, code: e.code || null, status: e.status, signal: e.signal || null };
    }
}

function isExpectedRejection(errObj, phase) {
    if (errObj.code === 'ENOENT') return false;
    if (errObj.signal) return false;
    const combined = ((errObj.stderr || '') + (errObj.stdout || '')).toLowerCase();
    if (!combined) return false;
    if (/enoent|no such file|cannot find module|cannot open|not found|spawn/i.test(combined)) return false;
    if (phase === 'witness' || phase === 'constraint') {
        return /\[error\]|constraint|assert\b|error:/i.test(combined);
    }
    if (phase === 'proof_verify' || phase === 'mutation') {
        return /invalid|\[error\]|error:/i.test(combined);
    }
    return false;
}

function checkRejection(errObj, phase, testName) {
    if (!isExpectedRejection(errObj, phase)) {
        const reason = errObj.code === 'ENOENT' ? 'snarkjs not found (ENOENT)'
            : errObj.signal ? `killed by signal ${errObj.signal}`
            : 'unrecognized/unexpected error output';
        fail(testName, `negative test: ${reason} — gate must fail`);
        return false;
    }
    return true;
}

// ── JSON helpers ─────────────────────────────────────────────────────────────

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function saveJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj)); }

// ── Fr helpers (BLS12-381 scalar) ────────────────────────────────────────────

const FR_MOD_HEX = '73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001';
const FR_MOD = BigInt('0x' + FR_MOD_HEX);

function frIsCanonical(decStr) {
    // A canonical Fr decimal: non-negative, < modulus, no leading zeros except for "0"
    if (!/^(0|[1-9][0-9]*)$/.test(decStr)) return false;
    const v = BigInt(decStr);
    if (v < 0n || v >= FR_MOD) return false;
    return true;
}

function frFromHex(hex) {
    const v = BigInt('0x' + hex);
    if (v >= FR_MOD) return null;
    return v;
}

function frToDec(v) { return v.toString(); }

// ── Test helpers ─────────────────────────────────────────────────────────────

function proveAndVerify(testName, circuitName, fixtureFile, zkeyFile, vkCommitPath, expectPass) {
    const fixturePath = path.join(ROOT, 'circuits', 'artifacts', 'fixtures', fixtureFile);
    if (!fs.existsSync(fixturePath)) {
        fail(testName, `fixture not found: ${fixtureFile}`);
        return;
    }

    const raw = loadJson(fixturePath);
    delete raw._meta;
    const input = raw;

    const tmpDir = path.join(ROOT, 'tmp', 'gate');
    fs.mkdirSync(tmpDir, { recursive: true });
    const baseName = testName.replace(/[^a-z0-9]/gi, '_');
    const inputJson = path.join(tmpDir, `${baseName}_input.json`);
    const wtnsFile = path.join(tmpDir, `${baseName}.wtns`);
    const proofJson = path.join(tmpDir, `${baseName}_proof.json`);
    const publicJson = path.join(tmpDir, `${baseName}_public.json`);

    saveJson(inputJson, input);

    const wasmFile = path.join(ROOT, `circuits/build/${circuitName}/main_js/main.wasm`);
    const r1csFile = path.join(ROOT, `circuits/build/${circuitName}/main.r1cs`);
    const zkey = path.join(ROOT, zkeyFile);
    const vk = path.join(ROOT, 'circuits', 'artifacts', 'manifests', vkCommitPath);

    // Generate witness
    const wcRes = snarkjsCmd(['wc', wasmFile, inputJson, wtnsFile]);
    if (wcRes.error) {
        if (!expectPass && checkRejection(wcRes, 'witness', testName)) {
            ok(testName + ' [correctly rejected at witness gen]');
        } else if (expectPass) {
            fail(testName, `witness gen failed: ${wcRes.stderr || wcRes.message}`);
        }
        return;
    }

    const chkRes = snarkjsCmd(['wchk', r1csFile, wtnsFile]);
    if (chkRes.error) {
        if (!expectPass && checkRejection(chkRes, 'constraint', testName)) {
            ok(testName + ' [correctly rejected at constraint check]');
        } else if (expectPass) {
            fail(testName, `constraint check failed: ${chkRes.stderr || chkRes.message}`);
        }
        return;
    }

    if (!expectPass) {
        fail(testName, 'negative test: witness passed constraints (should have failed)');
        return;
    }

    // Generate proof
    const proveRes = snarkjsCmd(['g16p', zkey, wtnsFile, proofJson, publicJson]);
    if (proveRes.error) {
        fail(testName, `proof gen failed: ${proveRes.stderr || proveRes.message}`);
        return;
    }

    // Verify proof
    const verifyRes = snarkjsCmd(['g16v', vk, publicJson, proofJson]);
    if (verifyRes.error) {
        fail(testName, `verification failed: ${verifyRes.stderr || verifyRes.message}`);
        return;
    }

    ok(testName);
    return { proofJson, publicJson, vk, zkey };
}

// ── Proof mutation test: tampered proof coordinate/byte ──────────────────────

function mutateProofAndVerify(testName, circuitName, zkeyFile, vkCommitPath, fixtureFile, mutateFn) {
    const tmpDir = path.join(ROOT, 'tmp', 'gate');
    fs.mkdirSync(tmpDir, { recursive: true });
    const baseName = testName.replace(/[^a-z0-9]/gi, '_');

    const raw = loadJson(path.join(ROOT, 'circuits', 'artifacts', 'fixtures', fixtureFile));
    delete raw._meta;
    const input = raw;

    const inputJson = path.join(tmpDir, `${baseName}_input.json`);
    const wtnsFile = path.join(tmpDir, `${baseName}.wtns`);
    const proofJson = path.join(tmpDir, `${baseName}_proof.json`);
    const publicJson = path.join(tmpDir, `${baseName}_public.json`);
    const mutatedProofJson = path.join(tmpDir, `${baseName}_mutated_proof.json`);

    const wasmFile = path.join(ROOT, `circuits/build/${circuitName}/main_js/main.wasm`);
    const zkey = path.join(ROOT, zkeyFile);
    const vk = path.join(ROOT, 'circuits', 'artifacts', 'manifests', vkCommitPath);

    saveJson(inputJson, input);

    const wcRes = snarkjsCmd(['wc', wasmFile, inputJson, wtnsFile]);
    if (wcRes.error) { fail(testName, `witness failed: ${wcRes.stderr || wcRes.message}`); return; }

    const proveRes = snarkjsCmd(['g16p', zkey, wtnsFile, proofJson, publicJson]);
    if (proveRes.error) { fail(testName, `prove failed: ${proveRes.stderr || proveRes.message}`); return; }

    const proof = loadJson(proofJson);
    const mutatedProof = mutateFn(JSON.parse(JSON.stringify(proof)));
    saveJson(mutatedProofJson, mutatedProof);

    const verifyRes = snarkjsCmd(['g16v', vk, publicJson, mutatedProofJson]);
    if (verifyRes.error) {
        if (checkRejection(verifyRes, 'mutation', testName)) {
            ok(testName);
        }
    } else {
        fail(testName, 'mutated proof verified (should have failed)');
    }
}

// ── Mutation test: tampered public signal ────────────────────────────────────

function mutateAndVerify(testName, circuitName, zkeyFile, vkCommitPath, fixtureFile, mutateSignalIdx, mutateFn) {
    const tmpDir = path.join(ROOT, 'tmp', 'gate');
    fs.mkdirSync(tmpDir, { recursive: true });
    const baseName = testName.replace(/[^a-z0-9]/gi, '_');

    const raw = loadJson(path.join(ROOT, 'circuits', 'artifacts', 'fixtures', fixtureFile));
    delete raw._meta;
    const input = raw;

    const inputJson = path.join(tmpDir, `${baseName}_input.json`);
    const wtnsFile = path.join(tmpDir, `${baseName}.wtns`);
    const proofJson = path.join(tmpDir, `${baseName}_proof.json`);
    const publicJson = path.join(tmpDir, `${baseName}_public.json`);
    const mutatedPublicJson = path.join(tmpDir, `${baseName}_mutated_public.json`);

    const wasmFile = path.join(ROOT, `circuits/build/${circuitName}/main_js/main.wasm`);
    const zkey = path.join(ROOT, zkeyFile);
    const vk = path.join(ROOT, 'circuits', 'artifacts', 'manifests', vkCommitPath);

    saveJson(inputJson, input);

    const wcRes = snarkjsCmd(['wc', wasmFile, inputJson, wtnsFile]);
    if (wcRes.error) { fail(testName, `witness failed: ${wcRes.stderr || wcRes.message}`); return; }

    const proveRes = snarkjsCmd(['g16p', zkey, wtnsFile, proofJson, publicJson]);
    if (proveRes.error) { fail(testName, `prove failed: ${proveRes.stderr || proveRes.message}`); return; }

    // Mutate public signal
    const publicSignals = loadJson(publicJson);
    const original = publicSignals[mutateSignalIdx];
    publicSignals[mutateSignalIdx] = mutateFn(original);
    saveJson(mutatedPublicJson, publicSignals);

    // Verify mutated — must fail
    const verifyRes = snarkjsCmd(['g16v', vk, mutatedPublicJson, proofJson]);
    if (verifyRes.error) {
        if (checkRejection(verifyRes, 'mutation', testName)) {
            ok(testName);
        }
    } else {
        fail(testName, 'mutated public signal verified (should have failed)');
    }
}

// ── Fr round-trip tests ──────────────────────────────────────────────────────

function testFrRoundTrip() {
    console.log('\nFr Canonical Parsing/Serialization Round-Trip');
    // modulus - 1 (max valid Fr value) as decimal
    const modulusMinusOne = (BigInt('0x' + FR_MOD_HEX) - 1n).toString();
    const testVals = [
        '0',
        '1',
        '1234567890123456789012345678901234567890123456789012345678901234',
        modulusMinusOne,
    ];

    for (const val of testVals) {
        // decimal → BigInt → hex → decimal
        if (!frIsCanonical(val)) {
            fail(`Fr round-trip "${val.slice(0,40)}..."`, 'not canonical decimal');
            continue;
        }
        const bi = BigInt(val);
        const hex = bi.toString(16).padStart(64, '0');
        const recovered = frFromHex(hex);
        if (recovered === null) {
            fail(`Fr round-trip "${val.slice(0,40)}..."`, 'hex out of range');
            continue;
        }
        const recoveredDec = frToDec(recovered);
        if (recoveredDec !== val) {
            fail(`Fr round-trip "${val.slice(0,40)}..."`, `mismatch: ${recoveredDec}`);
            continue;
        }
        ok(`Fr round-trip: ${val === '0' ? '0' : val.slice(0, 20) + '...'}`);
    }

    // Negative: out of range hex
    const modulusHex = FR_MOD_HEX; // the modulus itself is NOT in the field
    const outOfRange = frFromHex(modulusHex);
    if (outOfRange === null) {
        ok('Fr fromHex(modulus) correctly returns null');
    } else {
        fail('Fr fromHex(modulus)', `returned ${outOfRange} instead of null`);
    }

    // Negative: non-canonical decimal
    if (!frIsCanonical('01')) {
        ok('Fr "01" correctly rejected (leading zero)');
    } else {
        fail('Fr "01"', 'should reject leading zero');
    }
    if (!frIsCanonical('-1')) {
        ok('Fr "-1" correctly rejected (negative)');
    } else {
        fail('Fr "-1"', 'should reject negative');
    }

    // Public signal order test
    console.log('\nPublic Signal Order Match');
    // Generate proofs on-the-fly to avoid depending on tmp/setup/*.json
    const r0Fixture = path.join(ROOT, 'circuits', 'artifacts', 'fixtures', 'r0-vote-0.json');
    const r1Fixture = path.join(ROOT, 'circuits', 'artifacts', 'fixtures', 'r1-vote-3-salt-42.json');

    function quickProve(fixturePath, circuitName, zkeyFile, vkCommitPath, outDir, label) {
        const raw = loadJson(fixturePath);
        delete raw._meta;
        const inputJson = path.join(outDir, `fr_input.json`);
        const wtnsFile = path.join(outDir, `fr.wtns`);
        const proofJson = path.join(outDir, `fr_proof.json`);
        const publicJson = path.join(outDir, `fr_public.json`);
        saveJson(inputJson, raw);

        const wasmFile = path.join(ROOT, `circuits/build/${circuitName}/main_js/main.wasm`);
        const r1csFile = path.join(ROOT, `circuits/build/${circuitName}/main.r1cs`);
        const zkey = path.join(ROOT, zkeyFile);
        const vk = path.join(ROOT, 'circuits', 'artifacts', 'manifests', vkCommitPath);

        const wcRes = snarkjsCmd(['wc', wasmFile, inputJson, wtnsFile]);
        if (wcRes.error) {
            fail(`Fr ${label} witness`, wcRes.stderr || wcRes.message);
            return null;
        }
        const proveRes = snarkjsCmd(['g16p', zkey, wtnsFile, proofJson, publicJson]);
        if (proveRes.error) {
            fail(`Fr ${label} prove`, proveRes.stderr || proveRes.message);
            return null;
        }
        return publicJson;
    }

    const r0PublicJson = quickProve(r0Fixture, 'public-vote',
        'tmp/setup/r0_final.zkey', 'r0_vk.json',
        path.join(ROOT, 'tmp', 'gate'), 'R0');
    const r1PublicJson = quickProve(r1Fixture, 'commit-vote',
        'tmp/setup/r1_final.zkey', 'r1_vk.json',
        path.join(ROOT, 'tmp', 'gate'), 'R1');

    if (r0PublicJson) {
        const r0Public = loadJson(r0PublicJson);
        const r0Manifest = loadJson(path.join(ROOT, 'circuits', 'artifacts', 'manifests', 'public-vote-r0.json'));
        const r0Schema = r0Manifest.public_schema;
        if (r0Public.length === r0Schema.total) {
            ok(`R0 public.json has ${r0Public.length} signals (schema says ${r0Schema.total})`);
        } else {
            fail('R0 public.json count', `got ${r0Public.length}, expected ${r0Schema.total}`);
        }
        for (const sig of r0Schema.signals) {
            const val = r0Public[sig.index];
            if (frIsCanonical(val)) {
                ok(`  R0[${sig.index}] ${sig.name} canonical decimal`);
            } else {
                fail(`  R0[${sig.index}] ${sig.name}`, `non-canonical: ${val}`);
            }
        }
    }

    if (r1PublicJson) {
        const r1Public = loadJson(r1PublicJson);
        const r1Manifest = loadJson(path.join(ROOT, 'circuits', 'artifacts', 'manifests', 'commit-vote-r1.json'));
        const r1Schema = r1Manifest.public_schema;
        if (r1Public.length === r1Schema.total) {
            ok(`R1 public.json has ${r1Public.length} signals (schema says ${r1Schema.total})`);
        } else {
            fail('R1 public.json count', `got ${r1Public.length}, expected ${r1Schema.total}`);
        }
        for (const sig of r1Schema.signals) {
            const val = r1Public[sig.index];
            if (frIsCanonical(val)) {
                ok(`  R1[${sig.index}] ${sig.name} canonical decimal`);
            } else {
                fail(`  R1[${sig.index}] ${sig.name}`, `non-canonical: ${val}`);
            }
        }
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('ZK-Quorum Gate C0 — Groth16 Proof Verification & Mutation Harness');
console.log('===================================================================\n');

const r0Manifest = loadJson(path.join(ROOT, 'circuits', 'artifacts', 'manifests', 'public-vote-r0.json'));
const r1Manifest = loadJson(path.join(ROOT, 'circuits', 'artifacts', 'manifests', 'commit-vote-r1.json'));

// ── 1. Verify artifact checksums against manifests ───────────────────────────
console.log('1. Artifact Provenance Checks');
for (const [label, manifest, files] of [
    ['R0 R1CS', r0Manifest.r1cs, [path.join(ROOT, 'circuits/build/public-vote/main.r1cs')]],
    ['R1 R1CS', r1Manifest.r1cs, [path.join(ROOT, 'circuits/build/commit-vote/main.r1cs')]],
    ['R0 VK  ', r0Manifest.setup.verification_key, [path.join(ROOT, 'circuits/artifacts/manifests/r0_vk.json')]],
    ['R1 VK  ', r1Manifest.setup.verification_key, [path.join(ROOT, 'circuits/artifacts/manifests/r1_vk.json')]],
]) {
    const fp = files[0];
    if (!fs.existsSync(fp)) {
        fail(label, `file not found: ${fp}`);
        continue;
    }
    const actualSha = sha256File(fp);
    const expectedSha = manifest.sha256;
    const actualBytes = fs.statSync(fp).size;
    const expectedBytes = manifest.bytes;

    if (actualSha === expectedSha) {
        ok(`${label} SHA256 matches manifest`);
    } else {
        fail(`${label} SHA256`, `got ${actualSha}, expected ${expectedSha}`);
    }
    if (actualBytes === expectedBytes) {
        ok(`${label} bytes match manifest (${actualBytes})`);
    } else {
        fail(`${label} bytes`, `got ${actualBytes}, expected ${expectedBytes}`);
    }
}

// Check ptau if present
const ptauPath = path.join(ROOT, 'tmp', 'setup', 'pot14_final.ptau');
if (fs.existsSync(ptauPath)) {
    const ptauSha = sha256File(ptauPath);
    if (ptauSha === r0Manifest.setup.ptau.sha256) {
        ok('Ptau SHA256 matches manifest');
    } else {
        fail('Ptau SHA256', `got ${ptauSha}, expected ${r0Manifest.setup.ptau.sha256}`);
    }
    // Verify ptau integrity via snarkjs
    const ptvRes = snarkjsCmd(['ptv', ptauPath]);
    if (!ptvRes.error) {
        ok('Ptau powersoftau verify passed');
    } else {
        fail('Ptau verify', ptvRes.stderr || 'verification failed');
    }
} else {
    console.log('  [INFO] Ptau not present in tmp/setup/ — skipping checksum check');
}

// Check zkey checksums if present
for (const [label, manifest, zkeyPath] of [
    ['R0 zkey', r0Manifest.setup.zkey, path.join(ROOT, 'tmp', 'setup', 'r0_final.zkey')],
    ['R1 zkey', r1Manifest.setup.zkey, path.join(ROOT, 'tmp', 'setup', 'r1_final.zkey')],
]) {
    if (fs.existsSync(zkeyPath)) {
        const sha = sha256File(zkeyPath);
        if (sha === manifest.sha256) {
            ok(`${label} SHA256 matches manifest`);
        } else {
            fail(`${label} SHA256`, `got ${sha}, expected ${manifest.sha256}`);
        }
    }
}

// ── 2. Positive proof verification ───────────────────────────────────────────
console.log('\n2. Positive Proof Verification');
proveAndVerify(
    'R0 positive proof (vote=0)', 'public-vote', 'r0-vote-0.json',
    'tmp/setup/r0_final.zkey', 'r0_vk.json', true
);
proveAndVerify(
    'R0 scope-a proof', 'public-vote', 'r0-scope-a.json',
    'tmp/setup/r0_final.zkey', 'r0_vk.json', true
);
proveAndVerify(
    'R0 derived-scope proof', 'public-vote', 'r0-derived-scope.json',
    'tmp/setup/r0_final.zkey', 'r0_vk.json', true
);
proveAndVerify(
    'R0 scope-b proof', 'public-vote', 'r0-scope-b.json',
    'tmp/setup/r0_final.zkey', 'r0_vk.json', true
);
proveAndVerify(
    'R0 scope-c proof', 'public-vote', 'r0-scope-c.json',
    'tmp/setup/r0_final.zkey', 'r0_vk.json', true
);
proveAndVerify(
    'R1 positive proof (vote=3)', 'commit-vote', 'r1-vote-3-salt-42.json',
    'tmp/setup/r1_final.zkey', 'r1_vk.json', true
);
proveAndVerify(
    'R1 derived-scope proof', 'commit-vote', 'r1-derived-scope.json',
    'tmp/setup/r1_final.zkey', 'r1_vk.json', true
);

// ── 3. Mutation tests — public signal tampering ──────────────────────────────
console.log('\n3. Mutation Tests — Public Signal Tampering');
mutateAndVerify(
    'R0 mutate vote (0→1)', 'public-vote',
    'tmp/setup/r0_final.zkey', 'r0_vk.json',
    'r0-vote-0.json', 1,
    (orig) => {
        const v = BigInt(orig);
        return (v + 1n).toString(); // Change vote from 0 to 1
    }
);
mutateAndVerify(
    'R0 mutate optionCount (5→4)', 'public-vote',
    'tmp/setup/r0_final.zkey', 'r0_vk.json',
    'r0-vote-0.json', 2,
    () => '4'
);
mutateAndVerify(
    'R0 mutate stateRoot', 'public-vote',
    'tmp/setup/r0_final.zkey', 'r0_vk.json',
    'r0-vote-0.json', 3,
    () => '9999999999999999999999999999999999999999999999999999999999999999'
);
mutateAndVerify(
    'R0 mutate electionScope', 'public-vote',
    'tmp/setup/r0_final.zkey', 'r0_vk.json',
    'r0-vote-0.json', 5,
    () => '8888888888888888888888888888888888888888888888888888888888888888'
);
mutateAndVerify(
    'R1 mutate ballotCommitment', 'commit-vote',
    'tmp/setup/r1_final.zkey', 'r1_vk.json',
    'r1-vote-3-salt-42.json', 1,
    () => '9999999999999999999999999999999999999999999999999999999999999999'
);
mutateAndVerify(
    'R1 mutate electionScope', 'commit-vote',
    'tmp/setup/r1_final.zkey', 'r1_vk.json',
    'r1-vote-3-salt-42.json', 5,
    () => '8888888888888888888888888888888888888888888888888888888888888888'
);

// ── 4. Proof mutation tests (coordinate tampering) ───────────────────────────
console.log('\n4. Proof Mutation Tests — Groth16 Coordinate Tampering');

// R0 proof mutations
mutateProofAndVerify(
    'R0 mutate pi_a[0] + 1', 'public-vote',
    'tmp/setup/r0_final.zkey', 'r0_vk.json',
    'r0-vote-0.json',
    (proof) => {
        const v = BigInt(proof.pi_a[0]);
        proof.pi_a[0] = (v + 1n).toString();
        return proof;
    }
);
mutateProofAndVerify(
    'R0 mutate pi_a[1] + 1', 'public-vote',
    'tmp/setup/r0_final.zkey', 'r0_vk.json',
    'r0-vote-0.json',
    (proof) => {
        const v = BigInt(proof.pi_a[1]);
        proof.pi_a[1] = (v + 1n).toString();
        return proof;
    }
);
mutateProofAndVerify(
    'R0 mutate pi_c[0] + 1', 'public-vote',
    'tmp/setup/r0_final.zkey', 'r0_vk.json',
    'r0-vote-0.json',
    (proof) => {
        const v = BigInt(proof.pi_c[0]);
        proof.pi_c[0] = (v + 1n).toString();
        return proof;
    }
);
mutateProofAndVerify(
    'R0 mutate pi_b[0][0] + 1', 'public-vote',
    'tmp/setup/r0_final.zkey', 'r0_vk.json',
    'r0-vote-0.json',
    (proof) => {
        const v = BigInt(proof.pi_b[0][0]);
        proof.pi_b[0][0] = (v + 1n).toString();
        return proof;
    }
);

// R1 proof mutations
mutateProofAndVerify(
    'R1 mutate pi_a[0] + 1', 'commit-vote',
    'tmp/setup/r1_final.zkey', 'r1_vk.json',
    'r1-vote-3-salt-42.json',
    (proof) => {
        const v = BigInt(proof.pi_a[0]);
        proof.pi_a[0] = (v + 1n).toString();
        return proof;
    }
);
mutateProofAndVerify(
    'R1 mutate pi_c[0] + 1', 'commit-vote',
    'tmp/setup/r1_final.zkey', 'r1_vk.json',
    'r1-vote-3-salt-42.json',
    (proof) => {
        const v = BigInt(proof.pi_c[0]);
        proof.pi_c[0] = (v + 1n).toString();
        return proof;
    }
);

// ── 5. Negative witness tests ────────────────────────────────────────────────
console.log('\n5. Negative Witness Tests');
proveAndVerify(
    'R0 wrong state path', 'public-vote', 'r0-wrong-root.json',
    'tmp/setup/r0_final.zkey', 'r0_vk.json', false
);
proveAndVerify(
    'R0 vote=5/optionCount=5', 'public-vote', 'r0-vote-out-of-range.json',
    'tmp/setup/r0_final.zkey', 'r0_vk.json', false
);
proveAndVerify(
    'R0 optionCount=0', 'public-vote', 'r0-zero-options.json',
    'tmp/setup/r0_final.zkey', 'r0_vk.json', false
);
proveAndVerify(
    'R0 associationRoot=0', 'public-vote', 'r0-zero-asp.json',
    'tmp/setup/r0_final.zkey', 'r0_vk.json', false
);
proveAndVerify(
    'R0 label=zero', 'public-vote', 'r0-label-zero.json',
    'tmp/setup/r0_final.zkey', 'r0_vk.json', false
);
proveAndVerify(
    'R1 salt=0', 'commit-vote', 'r1-zero-salt.json',
    'tmp/setup/r1_final.zkey', 'r1_vk.json', false
);
proveAndVerify(
    'R1 vote out of range', 'commit-vote', 'r1-vote-out-of-range.json',
    'tmp/setup/r1_final.zkey', 'r1_vk.json', false
);
proveAndVerify(
    'R1 zero options', 'commit-vote', 'r1-zero-options.json',
    'tmp/setup/r1_final.zkey', 'r1_vk.json', false
);
proveAndVerify(
    'R1 label zero', 'commit-vote', 'r1-label-zero.json',
    'tmp/setup/r1_final.zkey', 'r1_vk.json', false
);
proveAndVerify(
    'R0 nullifierSecret=0', 'public-vote', 'r0-nullifier-zero.json',
    'tmp/setup/r0_final.zkey', 'r0_vk.json', false
);
proveAndVerify(
    'R1 nullifierSecret=0', 'commit-vote', 'r1-nullifier-zero.json',
    'tmp/setup/r1_final.zkey', 'r1_vk.json', false
);

// ── 6. Fr round-trip and public signal order ─────────────────────────────────
testFrRoundTrip();

// ── 7. Error-classification regression auto-tests ─────────────────────────────
console.log('\n7. Error Classification Regression Tests');
{
    // Test that a missing zkey (ENOENT) on negative test produces FAIL
    const fakeErr = { error: true, code: 'ENOENT', stderr: '', stdout: '', message: 'spawn ENOENT', signal: null };
    function testRegr(name, errObj, phase, expect) {
        const result = isExpectedRejection(errObj, phase);
        if (result === expect) {
            ok(`regr: ${name}`);
        } else {
            fail(`regr: ${name}`, `isExpectedRejection returned ${result}, expected ${expect}`);
        }
    }
    testRegr('ENOENT fails negative witness',    { error: true, code: 'ENOENT', stderr: '', stdout: '', message: 'spawn', signal: null }, 'witness', false);
    testRegr('empty stderr fails negative',       { error: true, stderr: '', stdout: '', signal: null, status: 1 }, 'witness', false);
    testRegr('signal kill fails negative',        { error: true, stderr: 'blah', stdout: '', signal: 'SIGKILL' }, 'witness', false);
    testRegr('unknown text fails negative',       { error: true, stderr: 'some random text', stdout: '', signal: null, status: 1 }, 'witness', false);
    testRegr('missing file fails negative',       { error: true, stderr: 'ENOENT: no such file', stdout: '', signal: null, status: 1 }, 'witness', false);
    testRegr('witness assert passes negative',    { error: true, stderr: 'Error: assert error', stdout: '', signal: null, status: 1 }, 'witness', true);
    testRegr('constraint tag passes negative',    { error: true, stderr: '[ERROR] Constraint', stdout: '', signal: null, status: 1 }, 'constraint', true);
    testRegr('invalid proof passes mutation',     { error: true, stderr: '[ERROR] SNARKJS: Invalid Proof', stdout: '', signal: null, status: 1 }, 'mutation', true);
    testRegr('proof error passes mutation',       { error: true, stderr: 'Error: verification failed', stdout: '', signal: null, status: 1 }, 'mutation', true);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n====================================`);
console.log(`Gate C0 Complete: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.log('Gate C0 FAILED');
    process.exit(1);
} else {
    console.log('Gate C0 PASSED');
}
