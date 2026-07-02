#!/usr/bin/env node
// ZK-Quorum E0 — standalone fail-closed replay verifier.
//
// Strict validation of tmp/e0/evidence/:
//   1. manifest.json: exact keys, types, artifacts list, public_signals deep-equal
//   2. vk/proof/public.bin SHA-256 matches manifest AND observation
//   3. Fr decimal→hex32 canonical: public[0..5] match observation hex fields
//   4. vote/option_count exact match
//   5. result.tally: array length=option_count, sum=1, vote-index=1, rest=0
//   6. flags: event_matches_expected===true, four no-mutation/no-events===true
//   7. outcomes: duplicate_outcome, mutated_proof_outcome exact strings
//   8. snarkjs groth16 verify via execFileSync
//
// Self-test mode (--self-test): mutates evidence copies and asserts exit != 0.
//
// Usage: node scripts/replay-e0.js [evidence_dir] [--self-test]
//   Exit 0 = PASS, exit 1 = FAIL

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SNARKJS = path.join(ROOT, 'node_modules', '.bin', 'snarkjs');
const VK_JSON = path.join(ROOT, 'circuits', 'artifacts', 'manifests', 'r0_vk.json');

// BLS12-381 Fr modulus (decimal)
const FR_MODULUS = 52435875175126190479447740508185965837690552500527637822603658699938581184513n;

let passed = 0;
let failed = 0;

function ok(msg) { passed++; console.log(`  [OK] ${msg}`); }
function fail(msg) { failed++; console.error(`  [FAIL] ${msg}`); process.exitCode = 1; }

function sha256File(fp) {
    if (!fs.existsSync(fp)) { fail(`Missing file: ${fp}`); return null; }
    return crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
}

// Convert decimal Fr string to canonical 64-char hex (32 bytes)
function frDecimalToHex32(decStr) {
    if (typeof decStr !== 'string' || !/^[0-9]+$/.test(decStr)) {
        throw new Error(`Invalid Fr decimal: ${decStr}`);
    }
    if (decStr.length > 1 && decStr[0] === '0') {
        throw new Error(`Leading zeros not allowed: ${decStr}`);
    }
    const bi = BigInt(decStr);
    if (bi < 0n) throw new Error(`Negative Fr: ${decStr}`);
    if (bi >= FR_MODULUS) throw new Error(`Fr >= modulus: ${decStr}`);
    let hex = bi.toString(16);
    hex = hex.padStart(64, '0');
    if (hex.length !== 64) throw new Error(`Fr hex length mismatch: ${hex.length}`);
    return hex;
}

// Validate manifest.json with exact key set and types
function validateManifest(manifest) {
    const requiredStringKeys = ['gate', 'circuit', 'schema', 'vk_sha256', 'proof_sha256', 'public_sha256', 'timestamp'];
    const requiredNumberKeys = ['depth', 'max_options'];
    const requiredArrayKeys = ['public_signals', 'artifacts'];
    const allKnownKeys = new Set([...requiredStringKeys, ...requiredNumberKeys, ...requiredArrayKeys]);

    for (const k of Object.keys(manifest)) {
        if (!allKnownKeys.has(k)) {
            fail(`Unknown key in manifest.json: ${k}`);
        }
    }
    for (const k of requiredStringKeys) {
        if (!(k in manifest)) { fail(`Missing key in manifest.json: ${k}`); continue; }
        if (typeof manifest[k] !== 'string') fail(`manifest.${k} must be string, got ${typeof manifest[k]}`);
    }
    for (const k of requiredNumberKeys) {
        if (!(k in manifest)) { fail(`Missing key in manifest.json: ${k}`); continue; }
        if (typeof manifest[k] !== 'number') fail(`manifest.${k} must be number, got ${typeof manifest[k]}`);
    }
    for (const k of requiredArrayKeys) {
        if (!(k in manifest)) { fail(`Missing key in manifest.json: ${k}`); continue; }
        if (!Array.isArray(manifest[k])) fail(`manifest.${k} must be array, got ${typeof manifest[k]}`);
    }

    // Validate public_signals: exactly 6 decimal strings
    if (Array.isArray(manifest.public_signals)) {
        if (manifest.public_signals.length !== 6) {
            fail(`manifest.public_signals must have 6 elements, got ${manifest.public_signals.length}`);
        }
        for (let i = 0; i < manifest.public_signals.length; i++) {
            if (typeof manifest.public_signals[i] !== 'string') {
                fail(`manifest.public_signals[${i}] must be string`);
            }
        }
    }

    // Validate artifacts exact list
    const expectedArtifacts = ['proof.json', 'public.json', 'vk.bin', 'proof.bin', 'public.bin', 'contract-observation.json'];
    if (Array.isArray(manifest.artifacts)) {
        if (manifest.artifacts.length !== expectedArtifacts.length ||
            !expectedArtifacts.every((a, i) => manifest.artifacts[i] === a)) {
            fail(`manifest.artifacts must be exactly ${JSON.stringify(expectedArtifacts)}`);
        }
    }

    if (manifest.schema !== 'PUBLIC_SCHEMA_V1_R0') fail(`manifest.schema must be PUBLIC_SCHEMA_V1_R0`);
    if (manifest.gate !== 'E0-LOCAL-R0') fail(`manifest.gate must be E0-LOCAL-R0`);
    if (manifest.circuit !== 'PublicVoteR0') fail(`manifest.circuit must be PublicVoteR0`);
}

// Validate observation schema with exact key set and types
const OBS_REQUIRED_STR = ['schema', 'election_id', 'state_root', 'association_root', 'election_scope',
    'nullifier_hash', 'proof_sha256', 'public_signals_sha256', 'vk_sha256',
    'duplicate_outcome', 'mutated_proof_outcome'];
const OBS_REQUIRED_NUM = ['vote', 'option_count', 'tally_bucket'];
const OBS_REQUIRED_BOOL = ['event_matches_expected', 'duplicate_no_state_mutation', 'duplicate_no_new_events',
    'mutated_no_state_mutation', 'mutated_no_new_events'];
const OBS_OBJECTS = ['tally', 'result'];

function validateObservation(obs) {
    const allKnown = new Set([...OBS_REQUIRED_STR, ...OBS_REQUIRED_NUM, ...OBS_REQUIRED_BOOL, ...OBS_OBJECTS]);
    for (const k of Object.keys(obs)) {
        if (!allKnown.has(k)) { fail(`Unknown key in observation: ${k}`); }
    }
    for (const k of OBS_REQUIRED_STR) {
        if (!(k in obs)) { fail(`Missing observation key: ${k}`); continue; }
        if (typeof obs[k] !== 'string') fail(`observation.${k} must be string`);
    }
    for (const k of OBS_REQUIRED_NUM) {
        if (!(k in obs)) { fail(`Missing observation key: ${k}`); continue; }
        if (typeof obs[k] !== 'number') fail(`observation.${k} must be number, got ${typeof obs[k]}`);
    }
    for (const k of OBS_REQUIRED_BOOL) {
        if (!(k in obs)) { fail(`Missing observation key: ${k}`); continue; }
        if (typeof obs[k] !== 'boolean') fail(`observation.${k} must be boolean, got ${typeof obs[k]}`);
    }
    for (const k of OBS_OBJECTS) {
        if (!(k in obs)) { fail(`Missing observation key: ${k}`); }
    }
    if (obs.schema !== 'contract-observation-v1') fail(`observation.schema must be contract-observation-v1`);
}

// ── Self-test mode: mutate evidence copies, verify exit != 0 ──
function selfTest(evidenceDir) {
    console.log('\n=== Self-test: negative replay cases ===');
    const os = require('os');
    const tmpBase = path.join(os.tmpdir(), 'zkq-replay-self-test-' + Date.now());
    fs.mkdirSync(tmpBase, { recursive: true });

    // Helper: copy evidence dir to tmp, mutate one file, run replay, expect fail
    function expectFail(label, mutator) {
        const testDir = path.join(tmpBase, label.replace(/[^a-z0-9]/gi, '_'));
        fs.cpSync(evidenceDir, testDir, { recursive: true });
        mutator(testDir);
        try {
            execFileSync(process.execPath, [__filename, testDir], {
                cwd: ROOT, stdio: 'pipe', timeout: 15000
            });
            fail(`Self-test "${label}": expected failure but got exit 0`);
        } catch (e) {
            if (e.status !== 1) {
                fail(`Self-test "${label}": expected exit 1, got ${e.status}`);
            } else {
                ok(`Self-test: ${label}`);
            }
        }
    }

    // Case 1: corrupt manifest — unknown key
    expectFail('manifest-unknown-key', (d) => {
        const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
        m.extra_field = true;
        fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m));
    });

    // Case 2: corrupt manifest — public_signals mismatch
    expectFail('manifest-public-signals-mismatch', (d) => {
        const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
        m.public_signals[0] = '99999999';
        fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m));
    });

    // Case 3: corrupt manifest — vk_sha256 mismatch
    expectFail('manifest-vk-hash-mismatch', (d) => {
        const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
        m.vk_sha256 = '0'.repeat(64);
        fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m));
    });

    // Case 4: corrupt observation — wrong proof_sha256
    expectFail('obs-wrong-proof-hash', (d) => {
        const o = JSON.parse(fs.readFileSync(path.join(d, 'contract-observation.json'), 'utf8'));
        o.proof_sha256 = '0'.repeat(64);
        fs.writeFileSync(path.join(d, 'contract-observation.json'), JSON.stringify(o));
    });

    // Case 5: corrupt observation — wrong vk_sha256
    expectFail('obs-wrong-vk-hash', (d) => {
        const o = JSON.parse(fs.readFileSync(path.join(d, 'contract-observation.json'), 'utf8'));
        o.vk_sha256 = '0'.repeat(64);
        fs.writeFileSync(path.join(d, 'contract-observation.json'), JSON.stringify(o));
    });

    // Case 6: corrupt observation — false flag
    expectFail('obs-false-flag', (d) => {
        const o = JSON.parse(fs.readFileSync(path.join(d, 'contract-observation.json'), 'utf8'));
        o.event_matches_expected = false;
        fs.writeFileSync(path.join(d, 'contract-observation.json'), JSON.stringify(o));
    });

    // Case 7: corrupt observation — wrong state_root
    expectFail('obs-wrong-state-root', (d) => {
        const o = JSON.parse(fs.readFileSync(path.join(d, 'contract-observation.json'), 'utf8'));
        o.state_root = '0'.repeat(64);
        fs.writeFileSync(path.join(d, 'contract-observation.json'), JSON.stringify(o));
    });

    // Case 8: corrupt observation — modified public.bin hash mismatch
    expectFail('public-bin-hash-mismatch', (d) => {
        const o = JSON.parse(fs.readFileSync(path.join(d, 'contract-observation.json'), 'utf8'));
        o.public_signals_sha256 = '0'.repeat(64);
        fs.writeFileSync(path.join(d, 'contract-observation.json'), JSON.stringify(o));
    });

    // Case 9: corrupt tally — wrong length
    expectFail('tally-wrong-length', (d) => {
        const o = JSON.parse(fs.readFileSync(path.join(d, 'contract-observation.json'), 'utf8'));
        o.result.tally = [1, 0]; // too short
        fs.writeFileSync(path.join(d, 'contract-observation.json'), JSON.stringify(o));
    });

    // Case 10: corrupt observation — wrong nullifier_hash
    expectFail('obs-wrong-nullifier', (d) => {
        const o = JSON.parse(fs.readFileSync(path.join(d, 'contract-observation.json'), 'utf8'));
        o.nullifier_hash = '0'.repeat(64);
        fs.writeFileSync(path.join(d, 'contract-observation.json'), JSON.stringify(o));
    });

    // Case 11: corrupt manifest — missing key
    expectFail('manifest-missing-key', (d) => {
        const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
        delete m.vk_sha256;
        fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m));
    });

    // Cleanup
    fs.rmSync(tmpBase, { recursive: true, force: true });
    console.log('');
}

// ── Main ──

const args = process.argv.slice(2);
const evidenceDir = args[0] && args[0] !== '--self-test' ? args[0] : path.join(ROOT, 'tmp', 'e0', 'evidence');
const doSelfTest = args.includes('--self-test');

if (doSelfTest) {
    // Require evidence to already exist for self-test
    if (!fs.existsSync(evidenceDir)) {
        console.error('Evidence dir does not exist. Run pipeline first.');
        process.exit(1);
    }
    selfTest(evidenceDir);
}

console.log('=== Replay E0 ===');
console.log(`Evidence dir: ${evidenceDir}\n`);

// 1. Validate evidence directory has required files
const requiredFiles = ['proof.json', 'public.json', 'vk.bin', 'proof.bin', 'public.bin',
    'contract-observation.json', 'manifest.json'];
for (const f of requiredFiles) {
    if (!fs.existsSync(path.join(evidenceDir, f))) {
        fail(`Required file missing: ${f}`);
    }
}
if (failed > 0) { console.error('\nMissing required evidence files. Aborting.'); process.exit(1); }

// 2. Parse and validate manifest.json
let manifest;
try {
    manifest = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'manifest.json'), 'utf8'));
} catch (e) { fail(`Cannot parse manifest.json: ${e.message}`); process.exit(1); }
validateManifest(manifest);

// 3. Parse and validate contract-observation.json
let observation;
try {
    observation = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'contract-observation.json'), 'utf8'));
} catch (e) { fail(`Cannot parse contract-observation.json: ${e.message}`); process.exit(1); }
validateObservation(observation);
if (failed > 0) process.exit(1);
ok('Observation schema valid');
ok('Manifest schema valid');

// 4. Recompute file hashes
const vkHash = sha256File(path.join(evidenceDir, 'vk.bin'));
const proofHash = sha256File(path.join(evidenceDir, 'proof.bin'));
const publicHash = sha256File(path.join(evidenceDir, 'public.bin'));

// Cross-validate: manifest hashes match actual files
if (vkHash !== manifest.vk_sha256) fail(`vk.bin SHA-256 mismatch with manifest`);
else ok('vk.bin SHA-256 matches manifest');
if (proofHash !== manifest.proof_sha256) fail(`proof.bin SHA-256 mismatch with manifest`);
else ok('proof.bin SHA-256 matches manifest');
if (publicHash !== manifest.public_sha256) fail(`public.bin SHA-256 mismatch with manifest`);
else ok('public.bin SHA-256 matches manifest');

// Cross-validate: observation hashes match actual files
if (vkHash !== observation.vk_sha256) fail(`vk.bin SHA-256 mismatch with observation`);
else ok('vk.bin SHA-256 matches observation');
if (proofHash !== observation.proof_sha256) fail(`proof.bin SHA-256 mismatch with observation`);
else ok('proof.bin SHA-256 matches observation');
if (publicHash !== observation.public_signals_sha256) fail(`public.bin SHA-256 mismatch with observation`);
else ok('public.bin SHA-256 matches observation');

// 5. Parse public.json and deep-equal with manifest.public_signals
let pubData;
try {
    pubData = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'public.json'), 'utf8'));
} catch (e) { fail(`Cannot parse public.json: ${e.message}`); process.exit(1); }

if (!Array.isArray(pubData) || pubData.length !== 6) {
    fail(`public.json must have exactly 6 elements`);
} else {
    // Deep-equal with manifest
    let deepEqual = true;
    for (let i = 0; i < 6; i++) {
        if (String(pubData[i]) !== String(manifest.public_signals[i])) {
            fail(`public.json[${i}] (${pubData[i]}) != manifest.public_signals[${i}] (${manifest.public_signals[i]})`);
            deepEqual = false;
        }
    }
    if (deepEqual) ok('public.json deep-equal manifest.public_signals');

    const [nullifierDec, voteDec, optionCountDec, stateRootDec, assocRootDec, scopeDec] = pubData.map(String);

    // Convert each Fr decimal to canonical hex32 and compare with observation
    try {
        const nhHex = frDecimalToHex32(nullifierDec);
        if (nhHex !== observation.nullifier_hash) fail(`nullifier_hash mismatch: computed ${nhHex}, observation ${observation.nullifier_hash}`);
        else ok('nullifier_hash matches');

        const srHex = frDecimalToHex32(stateRootDec);
        if (srHex !== observation.state_root) fail(`state_root mismatch: computed ${srHex}, observation ${observation.state_root}`);
        else ok('state_root matches');

        const arHex = frDecimalToHex32(assocRootDec);
        if (arHex !== observation.association_root) fail(`association_root mismatch: computed ${arHex}, observation ${observation.association_root}`);
        else ok('association_root matches');

        const scHex = frDecimalToHex32(scopeDec);
        if (scHex !== observation.election_scope) fail(`election_scope mismatch: computed ${scHex}, observation ${observation.election_scope}`);
        else ok('election_scope matches');
    } catch (e) {
        fail(`Fr decimal→hex32 conversion error: ${e.message}`);
    }

    // Vote and option_count exact match
    const voteVal = parseInt(voteDec, 10);
    const optVal = parseInt(optionCountDec, 10);
    if (isNaN(voteVal)) fail(`vote is not a valid number: ${voteDec}`);
    if (isNaN(optVal)) fail(`optionCount is not a valid number: ${optionCountDec}`);
    if (voteVal !== observation.vote) fail(`vote mismatch: signal=${voteVal}, observation=${observation.vote}`);
    else ok('vote matches');
    if (optVal !== observation.option_count) fail(`option_count mismatch: signal=${optVal}, observation=${observation.option_count}`);
    else ok('option_count matches');
    if (voteVal >= optVal) fail(`vote (${voteVal}) >= option_count (${optVal})`);
    if (optVal < 1 || optVal > 16) fail(`option_count out of range: ${optVal}`);
}

// 6. result.tally validation
if (observation.result && Array.isArray(observation.result.tally)) {
    const tally = observation.result.tally;
    const optCount = observation.option_count;
    if (tally.length !== optCount) {
        fail(`result.tally length (${tally.length}) != option_count (${optCount})`);
    } else {
        let sum = 0;
        let voteOk = true;
        for (let i = 0; i < tally.length; i++) {
            if (typeof tally[i] !== 'number') { fail(`result.tally[${i}] is not a number`); voteOk = false; continue; }
            sum += tally[i];
            if (i === observation.vote) {
                if (tally[i] !== 1) { fail(`result.tally[vote=${i}] must be 1, got ${tally[i]}`); voteOk = false; }
            } else {
                if (tally[i] !== 0) { fail(`result.tally[${i}] must be 0, got ${tally[i]}`); voteOk = false; }
            }
        }
        if (sum !== 1) fail(`result.tally sum must be 1, got ${sum}`);
        else if (voteOk) ok('result.tally array valid');
    }
    // tally map must match
    if (observation.tally && typeof observation.tally === 'object') {
        const voteKey = String(observation.vote);
        if (observation.tally[voteKey] !== 1) fail(`tally map key ${voteKey} must be 1`);
        else ok('tally map consistent');
    }
}

// 7. Flag assertions
if (observation.event_matches_expected !== true) fail('event_matches_expected must be true');
else ok('event_matches_expected === true');
if (observation.duplicate_no_state_mutation !== true) fail('duplicate_no_state_mutation must be true');
else ok('duplicate_no_state_mutation === true');
if (observation.duplicate_no_new_events !== true) fail('duplicate_no_new_events must be true');
else ok('duplicate_no_new_events === true');
if (observation.mutated_no_state_mutation !== true) fail('mutated_no_state_mutation must be true');
else ok('mutated_no_state_mutation === true');
if (observation.mutated_no_new_events !== true) fail('mutated_no_new_events must be true');
else ok('mutated_no_new_events === true');

// 8. Outcome assertions
if (observation.duplicate_outcome !== 'NullifierAlreadyUsed') {
    fail(`duplicate_outcome must be NullifierAlreadyUsed, got ${observation.duplicate_outcome}`);
} else ok('duplicate_outcome correct');
if (observation.mutated_proof_outcome !== 'ProofVerificationFailed') {
    fail(`mutated_proof_outcome must be ProofVerificationFailed, got ${observation.mutated_proof_outcome}`);
} else ok('mutated_proof_outcome correct');

// 9. snarkjs groth16 verify via execFileSync
console.log('');
try {
    const result = execFileSync(SNARKJS, ['groth16', 'verify', VK_JSON,
        path.join(evidenceDir, 'public.json'), path.join(evidenceDir, 'proof.json')], {
        cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 30000
    });
    if (result.includes('OK')) {
        ok('snarkjs groth16 verify: PASS');
    } else {
        fail(`snarkjs verify unexpected output: ${result.trim()}`);
    }
} catch (e) {
    fail(`snarkjs verify failed: ${(e.stderr || e.message || '').slice(0, 200)}`);
}

// Summary
console.log(`\n========================================`);
console.log(`Replay: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.error('REPLAY FAILED');
    process.exit(1);
} else {
    console.log('REPLAY PASSED');
    process.exit(0);
}
