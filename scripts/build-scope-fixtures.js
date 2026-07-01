#!/usr/bin/env node
// Build scope-specific test fixtures matching the three canonical scope vectors
// from execution ledger §13, plus one derived-scope fixture.
//
// Usage: node scripts/build-scope-fixtures.js
// Auto-compiles test_poseidon_vectors.circom when the WASM is missing.

const fs = require('fs');
const { execSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CIRCOM = path.join(ROOT, '.bootstrap', 'bin', 'circom');
const CIRCOM_BUILD = path.join(ROOT, 'circuits', 'build');
const FIXTURES = path.join(ROOT, 'circuits', 'artifacts', 'fixtures');

function toStr(v) { return typeof v === 'bigint' ? v.toString() : v; }
function stringify(obj) { return JSON.stringify(obj, (k, v) => toStr(v), 2); }

function ensureTestVectorsCompiled() {
    const wasmPath = path.join(CIRCOM_BUILD, 'test_vectors', 'test_poseidon_vectors_js', 'test_poseidon_vectors.wasm');
    if (fs.existsSync(wasmPath)) return;

    const outDir = path.join(CIRCOM_BUILD, 'test_vectors');
    fs.mkdirSync(outDir, { recursive: true });
    const circomFile = path.join(ROOT, 'circuits', 'test', 'test_poseidon_vectors.circom');
    const cmd = `${CIRCOM} --prime bls12381 --r1cs --sym --wasm --output ${outDir} ${circomFile}`;
    console.log('Compiling test_poseidon_vectors.circom...');
    execSync(cmd, { stdio: 'pipe', cwd: ROOT });
}

// Canonical election scope derivation (plan §5.1, ledger §13)
// Uses Buffer.byteLength for UTF-8 to correctly handle multi-byte characters.
function deriveElectionScope(networkPassphrase, contractIdHex, electionIdHex, maxAttempts = 255) {
    const domainTag = 'zk-quorum:election-scope:v1';
    const contractId = Buffer.from(contractIdHex, 'hex');
    const electionId = Buffer.from(electionIdHex, 'hex');

    const domainTagBuf = Buffer.from(domainTag, 'utf8');
    const networkBuf = Buffer.from(networkPassphrase, 'utf8');

    const message = Buffer.concat([
        uint32BE(domainTagBuf.length),
        domainTagBuf,
        uint32BE(networkBuf.length),
        networkBuf,
        uint32BE(32),
        contractId,
        uint32BE(32),
        electionId,
    ]);

    for (let counter = 0; counter <= maxAttempts; counter++) {
        const input = Buffer.concat([message, Buffer.from([counter])]);
        const digest = crypto.createHash('sha256').update(input).digest();

        const candidate = BigInt('0x' + digest.toString('hex'));
        const modulus = BigInt('0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001');

        if (candidate > 0n && candidate < modulus) {
            return { scope: digest.toString('hex'), counter };
        }
    }
    throw new Error('Rejection sampling exhausted');
}

function uint32BE(n) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(n);
    return buf;
}

// Three canonical scope vectors (ledger §13)
const SCOPE_VECTORS = [
    {
        name: 'scope-a',
        network: 'Test SDF Network ; September 2015',
        contractHex: '11'.repeat(32),
        electionHex: '22'.repeat(32),
        expectedScope: '0b667e4a71d35199a50ec46d35ad8112c97537ed9cba84eebbc51080106130a8',
        expectedCounter: 0,
    },
    {
        name: 'scope-b',
        network: 'Public Global Stellar Network ; September 2015',
        contractHex: 'aa'.repeat(32),
        electionHex: 'bb'.repeat(32),
        expectedScope: '1a2d555082335dcf53d47a6e31cbdb1076a1c1f41d5ceca38421a55b01f4abb2',
        expectedCounter: 1,
    },
    {
        name: 'scope-c',
        network: 'Test SDF Network ; September 2015',
        contractHex: '01'.repeat(32),
        electionHex: 'ff'.repeat(32),
        expectedScope: '3042d22d781a4aa3b7cc9cd7d903ccf84d0de242657dbe616b181b6d09a4382c',
        expectedCounter: 3,
    },
];

async function main() {
    ensureTestVectorsCompiled();

    // Load poseidon witness calculator
    const wc = require(CIRCOM_BUILD + '/test_vectors/test_poseidon_vectors_js/witness_calculator.js');
    const buffer = fs.readFileSync(CIRCOM_BUILD + '/test_vectors/test_poseidon_vectors_js/test_poseidon_vectors.wasm');
    const calc = await wc(buffer);

    async function p2(a, b) {
        const w = await calc.calculateWitness({a: String(a), b: String(b), c: "0"}, 1);
        return w[1];
    }

    const DEPTH = 10;
    const SIZE = 1 << DEPTH;

    async function buildTree(leaves) {
        const padded = new Array(SIZE).fill("0");
        for (let i = 0; i < Math.min(leaves.length, SIZE); i++) {
            padded[i] = String(leaves[i]);
        }
        let current = padded;
        const levels = [current];
        for (let d = 0; d < DEPTH; d++) {
            const next = [];
            for (let i = 0; i < current.length; i += 2) {
                next.push(await p2(current[i], current[i + 1]));
            }
            levels.push(next);
            current = next;
        }
        const root = levels[DEPTH][0];
        const leafSiblings = [];
        for (let li = 0; li < SIZE; li++) {
            const sibs = [];
            let idx = li;
            for (let d = 0; d < DEPTH; d++) {
                sibs.push(String(levels[d][idx ^ 1]));
                idx >>= 1;
            }
            leafSiblings.push(sibs);
        }
        return { root: String(root), leafSiblings };
    }

    const label = "111";
    const ns = "222";
    const td = "333";
    const preC = await p2(ns, td);
    const credC = await p2(label, preC);
    const stateTree = await buildTree([credC]);
    const assocTree = await buildTree([label]);

    // Verify canonical scope vectors first
    console.log('Verifying canonical scope vectors:');
    for (const sv of SCOPE_VECTORS) {
        const result = deriveElectionScope(sv.network, sv.contractHex, sv.electionHex);
        const match = result.scope === sv.expectedScope && result.counter === sv.expectedCounter;
        console.log(`  ${match ? 'PASS' : 'FAIL'} ${sv.name}: scope=${result.scope} counter=${result.counter}`);
        if (!match) {
            console.log(`    expected scope=${sv.expectedScope} counter=${sv.expectedCounter}`);
            process.exit(1);
        }
    }

    // Build R0 fixtures for each scope vector
    console.log('\nBuilding scope fixtures:');
    for (const sv of SCOPE_VECTORS) {
        const scopeBigInt = BigInt('0x' + sv.expectedScope);
        const fixture = {
            vote: "0",
            optionCount: "5",
            stateRoot: stateTree.root,
            associationRoot: assocTree.root,
            electionScope: String(scopeBigInt),
            label, nullifierSecret: ns, trapdoor: td,
            stateIndex: "0", stateSiblings: stateTree.leafSiblings[0],
            associationIndex: "0", associationSiblings: assocTree.leafSiblings[0],
            _meta: { scopeVector: sv.name, network: sv.network, scopeHex: sv.expectedScope, counter: sv.expectedCounter }
        };
        fs.writeFileSync(FIXTURES + `/r0-${sv.name}.json`, stringify(fixture));
        console.log(`  Wrote r0-${sv.name}.json`);
    }

    // Build derived-scope fixture (using a fresh derivation)
    const derived = deriveElectionScope(
        'Test SDF Network ; September 2015',
        'ab'.repeat(32),
        '42'.repeat(32)
    );
    const derivedScopeBigInt = BigInt('0x' + derived.scope);
    console.log(`\nDerived scope: ${derived.scope} (counter=${derived.counter})`);

    const derivedFixture = {
        vote: "1",
        optionCount: "5",
        stateRoot: stateTree.root,
        associationRoot: assocTree.root,
        electionScope: String(derivedScopeBigInt),
        label, nullifierSecret: ns, trapdoor: td,
        stateIndex: "0", stateSiblings: stateTree.leafSiblings[0],
        associationIndex: "0", associationSiblings: assocTree.leafSiblings[0],
        _meta: {
            scopeVector: 'derived',
            network: 'Test SDF Network ; September 2015',
            contractHex: 'ab'.repeat(32),
            electionHex: '42'.repeat(32),
            scopeHex: derived.scope,
            counter: derived.counter
        }
    };
    fs.writeFileSync(FIXTURES + '/r0-derived-scope.json', stringify(derivedFixture));
    console.log('  Wrote r0-derived-scope.json');

    // Build derived-scope R1 fixture too
    const r1Vote = "3", r1Salt = "42", r1Options = "5";
    const voteSaltHash = await p2(r1Vote, r1Salt);
    const ballotC = await p2(voteSaltHash, String(derivedScopeBigInt));

    const derivedR1Fixture = {
        optionCount: r1Options,
        stateRoot: stateTree.root, associationRoot: assocTree.root,
        electionScope: String(derivedScopeBigInt),
        label, nullifierSecret: ns, trapdoor: td,
        vote: r1Vote, salt: r1Salt,
        stateIndex: "0", stateSiblings: stateTree.leafSiblings[0],
        associationIndex: "0", associationSiblings: assocTree.leafSiblings[0],
        _meta: {
            scopeVector: 'derived',
            network: 'Test SDF Network ; September 2015',
            contractHex: 'ab'.repeat(32),
            electionHex: '42'.repeat(32),
            scopeHex: derived.scope,
            counter: derived.counter
        }
    };
    fs.writeFileSync(FIXTURES + '/r1-derived-scope.json', stringify(derivedR1Fixture));
    console.log('  Wrote r1-derived-scope.json');

    // ===== Non-ASCII parity vector =====
    const nonAsciiNetwork = 'Stellar r\u00E9seau de test \u2014 \u6D4B\u8BD5\u7F51\u7EDC';
    console.log(`\nNon-ASCII network: "${nonAsciiNetwork}"`);
    console.log(`  char length: ${nonAsciiNetwork.length}, UTF-8 byte length: ${Buffer.from(nonAsciiNetwork, 'utf8').length}`);

    const nonAsciiDerived = deriveElectionScope(
        nonAsciiNetwork,
        'cd'.repeat(32),
        'ef'.repeat(32)
    );
    const nonAsciiScopeBigInt = BigInt('0x' + nonAsciiDerived.scope);
    console.log(`  Derived scope: ${nonAsciiDerived.scope} (counter=${nonAsciiDerived.counter})`);

    const nonAsciiR0Fixture = {
        vote: "2",
        optionCount: "5",
        stateRoot: stateTree.root,
        associationRoot: assocTree.root,
        electionScope: String(nonAsciiScopeBigInt),
        label, nullifierSecret: ns, trapdoor: td,
        stateIndex: "0", stateSiblings: stateTree.leafSiblings[0],
        associationIndex: "0", associationSiblings: assocTree.leafSiblings[0],
        _meta: {
            scopeVector: 'non-ascii-parity',
            network: nonAsciiNetwork,
            networkCharLen: nonAsciiNetwork.length,
            networkByteLen: Buffer.from(nonAsciiNetwork, 'utf8').length,
            contractHex: 'cd'.repeat(32),
            electionHex: 'ef'.repeat(32),
            scopeHex: nonAsciiDerived.scope,
            counter: nonAsciiDerived.counter
        }
    };
    fs.writeFileSync(FIXTURES + '/r0-non-ascii-scope.json', stringify(nonAsciiR0Fixture));
    console.log('  Wrote r0-non-ascii-scope.json');

    // Scope vectors JSON for reference
    fs.writeFileSync(FIXTURES + '/scope_vectors.json', stringify({
        description: 'Canonical election scope vectors (execution ledger §13)',
        domain_tag: 'zk-quorum:election-scope:v1',
        algorithm: 'SHA-256 with rejection sampling to BLS12-381 Fr',
        vectors: SCOPE_VECTORS
    }));
    console.log('  Wrote scope_vectors.json');

    console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
