// Deterministic Poseidon255 Merkle tree builder for ZK-Quorum witness tests.
// Uses the circom-compiled witness calculator for exact poseidon255.circom consistency.
//
// Usage: node scripts/build-test-fixtures.js
// Produces: circuits/artifacts/fixtures/*.json
// Auto-compiles test_poseidon_vectors.circom when the WASM is missing.

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CIRCOM = path.join(ROOT, '.bootstrap', 'bin', 'circom');
const CIRCOM_BUILD = path.join(ROOT, 'circuits', 'build');
const FIXTURES = path.join(ROOT, 'circuits', 'artifacts', 'fixtures');

// JSON replacer that converts BigInt to string
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

async function main() {
    ensureTestVectorsCompiled();

    // Load poseidon witness calculator
    const wc = require(CIRCOM_BUILD + '/test_vectors/test_poseidon_vectors_js/witness_calculator.js');
    const buffer = fs.readFileSync(CIRCOM_BUILD + '/test_vectors/test_poseidon_vectors_js/test_poseidon_vectors.wasm');
    const calc = await wc(buffer);

    // P2(a,b) = Poseidon255(2) - returns BigInt
    async function p2(a, b) {
        const w = await calc.calculateWitness({a: String(a), b: String(b), c: "0"}, 1);
        return w[1]; // P2 output at index 1 per .sym
    }

    // P3seq(a,b,c) = P2(P2(a,b), c)
    async function p3seq(a, b, c) {
        const inner = await p2(a, b);
        return p2(inner, c);
    }

    const DEPTH = 10;
    const SIZE = 1 << DEPTH;

    // Build Merkle tree from an array of leaves (zero-padded to SIZE).
    // Returns { root, leafSiblings: [[sib0..sib9] per leaf index] }
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

    console.log("Computing hashes...");

    // Credential: label=111, nullifierSecret=222, trapdoor=333
    const label = "111";
    const ns = "222";
    const td = "333";
    const preC = await p2(ns, td);
    const credC = await p2(label, preC);
    console.log("precommitment:", String(preC));
    console.log("credentialCommitment:", String(credC));
    // Expected golden: 33380155885179640208912473019492003279421010499170178573196933234221612903872

    // Build state tree: credC at position 0
    const stateTree = await buildTree([credC]);
    console.log("stateRoot:", stateTree.root);

    // Build association tree: label at position 0
    const assocTree = await buildTree([label]);
    console.log("associationRoot:", assocTree.root);

    const electionScope = "1234567890123456789012345678901234567890123456789012345678901234";

    // ===== R0 Positive: vote=0, optionCount=5 =====
    const r0Pos = {
        vote: "0", optionCount: "5",
        stateRoot: stateTree.root, associationRoot: assocTree.root,
        electionScope: electionScope,
        label, nullifierSecret: ns, trapdoor: td,
        stateIndex: "0", stateSiblings: stateTree.leafSiblings[0],
        associationIndex: "0", associationSiblings: assocTree.leafSiblings[0]
    };
    fs.writeFileSync(FIXTURES + '/r0-vote-0.json', stringify(r0Pos));
    console.log("Wrote r0-vote-0.json");

    // ===== R0 Negative: vote >= optionCount =====
    fs.writeFileSync(FIXTURES + '/r0-vote-out-of-range.json',
        stringify({...r0Pos, vote: "5", optionCount: "5"}));
    console.log("Wrote r0-vote-out-of-range.json");

    // ===== R0 Negative: wrong root =====
    fs.writeFileSync(FIXTURES + '/r0-wrong-root.json',
        stringify({...r0Pos, stateRoot: "9999999999999999999999999999999999999999999999999999999999999999"}));
    console.log("Wrote r0-wrong-root.json");

    // ===== R0 Negative: zero ASP (bypass attempt) =====
    fs.writeFileSync(FIXTURES + '/r0-zero-asp.json',
        stringify({...r0Pos, associationRoot: "0"}));
    console.log("Wrote r0-zero-asp.json");

    // ===== R0 Negative: optionCount=0 =====
    fs.writeFileSync(FIXTURES + '/r0-zero-options.json',
        stringify({...r0Pos, vote: "0", optionCount: "0"}));
    console.log("Wrote r0-zero-options.json");

    // ===== R1 Positive =====
    const r1Vote = "3", r1Salt = "42", r1Options = "5";
    const voteSaltHash = await p2(r1Vote, r1Salt);
    const ballotC = await p2(voteSaltHash, electionScope);
    console.log("voteSaltHash:", String(voteSaltHash));
    console.log("ballotCommitment:", String(ballotC));

    const r1Pos = {
        optionCount: r1Options,
        stateRoot: stateTree.root, associationRoot: assocTree.root,
        electionScope: electionScope,
        label, nullifierSecret: ns, trapdoor: td,
        vote: r1Vote, salt: r1Salt,
        stateIndex: "0", stateSiblings: stateTree.leafSiblings[0],
        associationIndex: "0", associationSiblings: assocTree.leafSiblings[0]
    };
    fs.writeFileSync(FIXTURES + '/r1-vote-3-salt-42.json', stringify(r1Pos));
    console.log("Wrote r1-vote-3-salt-42.json");

    // ===== R1 Reveal =====
    fs.writeFileSync(FIXTURES + '/r1-reveal.json', stringify({
        vote: r1Vote, salt: r1Salt,
        ballotCommitment: String(ballotC),
        electionScope, voteSaltHash: String(voteSaltHash)
    }));
    console.log("Wrote r1-reveal.json");

    // ===== R1 Negative: zero salt =====
    fs.writeFileSync(FIXTURES + '/r1-zero-salt.json',
        stringify({...r1Pos, salt: "0"}));
    console.log("Wrote r1-zero-salt.json");

    // ===== R1 Negative: out-of-range vote =====
    fs.writeFileSync(FIXTURES + '/r1-vote-out-of-range.json',
        stringify({...r1Pos, vote: "7", optionCount: "5"}));
    console.log("Wrote r1-vote-out-of-range.json");

    // ===== R1 Negative: vote=0, optionCount=0 =====
    fs.writeFileSync(FIXTURES + '/r1-zero-options.json',
        stringify({...r1Pos, vote: "0", optionCount: "0"}));
    console.log("Wrote r1-zero-options.json");

    console.log("\nDone. All fixtures written to", FIXTURES);
}

main().catch(e => { console.error(e); process.exit(1); });
