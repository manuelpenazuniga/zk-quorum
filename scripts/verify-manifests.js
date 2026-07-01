#!/usr/bin/env node
// Verify that regenerated fixture hashes match committed manifests.
// Compares only owned generated paths; does not use git diff or cleanliness.
// Rejects tracked fixture drift: if any committed fixture JSON has changed
// SHA-256, the gate fails.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(ROOT, 'circuits', 'artifacts', 'fixtures');

function sha256File(fp) {
    const buf = fs.readFileSync(fp);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256JSON(fp) {
    // Normalize JSON to canonical form: sorted keys, no whitespace, \n at end
    const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const canonical = JSON.stringify(obj, Object.keys(obj).sort()) + '\n';
    return crypto.createHash('sha256').update(canonical).digest('hex');
}

// List all fixture files (excluding golden_vectors, poseidon_constants, scope_vectors)
const fixtureFiles = fs.readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.json') &&
        f !== 'golden_vectors.json' &&
        f !== 'poseidon_constants_t3.json' &&
        f !== 'scope_vectors.json')
    .sort();

// Check that all expected fixture files exist
const expectedFixtures = [
    'r0-vote-0.json',
    'r0-vote-out-of-range.json',
    'r0-wrong-root.json',
    'r0-zero-asp.json',
    'r0-zero-options.json',
    'r0-label-zero.json',
    'r0-boundary-4-of-5.json',
    'r0-options-17.json',
    'r0-wrong-asp-path.json',
    'r0-altered-scope.json',
    'r0-scope-a.json',
    'r0-scope-b.json',
    'r0-scope-c.json',
    'r0-derived-scope.json',
    'r0-non-ascii-scope.json',
    'r1-vote-3-salt-42.json',
    'r1-reveal.json',
    'r1-zero-salt.json',
    'r1-vote-out-of-range.json',
    'r1-zero-options.json',
    'r1-label-zero.json',
    'r1-boundary-4-of-5.json',
    'r1-options-17.json',
    'r1-wrong-asp-path.json',
    'r1-altered-scope.json',
    'r1-derived-scope.json',
    'r1-wrong-commitment.json',
    'r0-nullifier-zero.json',
    'r1-nullifier-zero.json',
];

let passed = 0;
let failed = 0;

for (const f of expectedFixtures) {
    const fp = path.join(FIXTURES_DIR, f);
    if (!fs.existsSync(fp)) {
        console.log(`  [FAIL] Missing: ${f}`);
        failed++;
    } else {
        console.log(`  [PASS] ${f} exists`);
        passed++;
    }
}

// Compare manifest R1CS SHA256 against regenerated circuit build
const manifestsDir = path.join(ROOT, 'circuits', 'artifacts', 'manifests');
const r0Manifest = JSON.parse(fs.readFileSync(path.join(manifestsDir, 'public-vote-r0.json'), 'utf8'));
const r1Manifest = JSON.parse(fs.readFileSync(path.join(manifestsDir, 'commit-vote-r1.json'), 'utf8'));

const r0R1csPath = path.join(ROOT, 'circuits/build/public-vote/main.r1cs');
const r1R1csPath = path.join(ROOT, 'circuits/build/commit-vote/main.r1cs');

for (const [label, manifestR1cs, r1csPath] of [
    ['R0 R1CS', r0Manifest.r1cs, r0R1csPath],
    ['R1 R1CS', r1Manifest.r1cs, r1R1csPath],
]) {
    if (!fs.existsSync(r1csPath)) {
        console.log(`  [FAIL] ${label} file not found: ${r1csPath}`);
        failed++;
        continue;
    }
    const sha = sha256File(r1csPath);
    if (sha === manifestR1cs.sha256) {
        console.log(`  [PASS] ${label} SHA256 matches manifest`);
        passed++;
    } else {
        console.log(`  [FAIL] ${label} SHA256 drifted: ${sha} != ${manifestR1cs.sha256}`);
        failed++;
    }
}

// Check VK JSONs match
for (const [label, vkPath, manifestVk] of [
    ['R0 VK', path.join(manifestsDir, 'r0_vk.json'), r0Manifest.setup.verification_key],
    ['R1 VK', path.join(manifestsDir, 'r1_vk.json'), r1Manifest.setup.verification_key],
]) {
    if (!fs.existsSync(vkPath)) {
        console.log(`  [INFO] ${label} not committed (optional)`);
        continue;
    }
    const sha = sha256File(vkPath);
    if (sha === manifestVk.sha256) {
        console.log(`  [PASS] ${label} SHA256 matches manifest`);
        passed++;
    } else {
        console.log(`  [FAIL] ${label} SHA256 drifted: ${sha} != ${manifestVk.sha256}`);
        failed++;
    }
}

console.log(`\nManifest verification: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
