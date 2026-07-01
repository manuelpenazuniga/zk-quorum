#!/usr/bin/env node
// ZK-Quorum C0 — reproducible asset fetch with integrity verification.
//
// Downloads/verifies non-versioned setup artifacts from an immutable release URL
// or a local directory override. Never regenerates setup.
//
// Default URL:
//   https://github.com/manuelpenazuniga/zk-quorum/releases/download/c0-setup-v1/<file>
// Override:
//   ZKQ_SETUP_BASE_URL=file:///path/to/assets  node scripts/fetch-setup-assets.js
//   ZKQ_SETUP_BASE_URL=http://localhost:8080   node scripts/fetch-setup-assets.js
//
// Atomic install: write to .part, rename only after SHA-256 + size pass.
// Idempotent: skip download if existing file matches expected SHA-256.
// Fail-closed: any mismatch aborts with non-zero exit.
//
// Usage: node scripts/fetch-setup-assets.js
// Exit 0 if all assets present and verified; non-zero on failure.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_DIR = path.join(ROOT, 'circuits', 'artifacts', 'manifests');
const SETUP_DIR = path.join(ROOT, 'tmp', 'setup');
const DEFAULT_BASE_URL = 'https://github.com/manuelpenazuniga/zk-quorum/releases/download/c0-setup-v1';
const BASE_URL = process.env.ZKQ_SETUP_BASE_URL || DEFAULT_BASE_URL;

const SNARKJS = path.join(ROOT, 'node_modules', '.bin', 'snarkjs');

let passed = 0;
let failed = 0;

function ok(msg) { console.log(`  [OK] ${msg}`); passed++; }
function fail(msg) { console.error(`  [FAIL] ${msg}`); failed++; process.exitCode = 1; }

function sha256File(fp) {
    const buf = fs.readFileSync(fp);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function isLocalUrl(url) {
    return url.startsWith('file://');
}

function isHttpUrl(url) {
    return url.startsWith('http://') || url.startsWith('https://');
}

function fetchLocal(baseUri, fileName) {
    const srcDir = baseUri.replace(/^file:\/\//, '');
    const srcPath = path.join(srcDir, fileName);
    if (!fs.existsSync(srcPath)) {
        return null;
    }
    return { filePath: srcPath, readFile: () => fs.readFileSync(srcPath) };
}

function fetchHttp(baseUrl, fileName) {
    const url = `${baseUrl}/${fileName}`;
    try {
        const opts = { stdio: 'pipe', timeout: 120000, maxBuffer: 100 * 1024 * 1024 };
        const result = execSync(`curl -fL --silent --show-error '${url}'`, { encoding: null, ...opts });
        return { filePath: url, readFile: () => result };
    } catch (e) {
        console.error(`  Download failed: ${e.message.slice(0, 200)}`);
        return null;
    }
}

function fetchFile(baseUrl, fileName) {
    if (isLocalUrl(baseUrl)) {
        return fetchLocal(baseUrl, fileName);
    }
    if (isHttpUrl(baseUrl)) {
        return fetchHttp(baseUrl, fileName);
    }
    fail(`Unsupported URL scheme: ${baseUrl}`);
    return null;
}

function verifyAndInstall(fileName, expectedSha, expectedBytes, sourceBaseUrl) {
    const destPath = path.join(SETUP_DIR, fileName);
    const partPath = destPath + '.part';

    if (fs.existsSync(destPath)) {
        const actualSha = sha256File(destPath);
        const actualBytes = fs.statSync(destPath).size;
        if (actualSha === expectedSha && actualBytes === expectedBytes) {
            ok(`${fileName} already present with correct SHA-256`);
            return true;
        }
        console.log(`  Hash mismatch for ${fileName}, re-fetching...`);
    }

    const fetched = fetchFile(sourceBaseUrl, fileName);
    if (!fetched) {
        fail(`${fileName}: could not fetch from ${sourceBaseUrl}`);
        return false;
    }

    const data = fetched.readFile();
    if (!data) {
        fail(`${fileName}: empty response`);
        return false;
    }

    const actualSha = crypto.createHash('sha256').update(data).digest('hex');
    const actualBytes = data.length;

    if (actualBytes !== expectedBytes) {
        fail(`${fileName}: size mismatch — got ${actualBytes}, expected ${expectedBytes}`);
        return false;
    }
    if (actualSha !== expectedSha) {
        fail(`${fileName}: SHA-256 mismatch — got ${actualSha}, expected ${expectedSha}`);
        return false;
    }

    fs.mkdirSync(SETUP_DIR, { recursive: true });
    fs.writeFileSync(partPath, data);
    fs.renameSync(partPath, destPath);
    ok(`${fileName} downloaded and verified (${actualBytes} bytes)`);
    return true;
}

function main() {
    console.log('ZK-Quorum C0 — Fetch & Verify Setup Assets');
    console.log(`Source: ${BASE_URL}\n`);

    fs.mkdirSync(SETUP_DIR, { recursive: true });

    const r0Manifest = JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, 'public-vote-r0.json'), 'utf8'));
    const r1Manifest = JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, 'commit-vote-r1.json'), 'utf8'));

    const assets = [
        {
            fileName: 'pot14_final.ptau',
            expectedSha: r0Manifest.setup.ptau.sha256,
            expectedBytes: r0Manifest.setup.ptau.bytes,
        },
        {
            fileName: 'r0_final.zkey',
            expectedSha: r0Manifest.setup.zkey.sha256,
            expectedBytes: r0Manifest.setup.zkey.bytes,
        },
        {
            fileName: 'r1_final.zkey',
            expectedSha: r1Manifest.setup.zkey.sha256,
            expectedBytes: r1Manifest.setup.zkey.bytes,
        },
    ];

    let allOk = true;
    for (const asset of assets) {
        if (!verifyAndInstall(asset.fileName, asset.expectedSha, asset.expectedBytes, BASE_URL)) {
            allOk = false;
        }
    }

    if (!allOk) {
        console.log('\nSome assets could not be verified. Aborting.');
        process.exit(1);
    }

    // Verify ptau integrity via snarkjs
    const ptauPath = path.join(SETUP_DIR, 'pot14_final.ptau');
    try {
        const ptvOut = execSync(`"${SNARKJS}" ptv ${ptauPath}`, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 30000 });
        if (ptvOut.includes('Powers of Tau Ok')) {
            ok('Ptau powersoftau verify passed');
        } else {
            fail('Ptau powersoftau verify did not report success');
        }
    } catch (e) {
        fail(`Ptau powersoftau verify failed: ${e.message.slice(0, 200)}`);
    }

    console.log(`\n========================================`);
    console.log(`Setup assets: ${passed} verified, ${failed} failed`);
    if (failed > 0) {
        process.exit(1);
    } else {
        console.log('All setup assets verified successfully.');
    }
}

main();
