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
const ROOT = path.resolve(__dirname, '..');
const CIRCOM = resolveCircom(ROOT);

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

    // ===== R0 Positive: boundary vote=4, optionCount=5 =====
    fs.writeFileSync(FIXTURES + '/r0-boundary-4-of-5.json',
        stringify({...r0Pos, vote: "4", optionCount: "5"}));
    console.log("Wrote r0-boundary-4-of-5.json");

    // ===== R0 Negative: optionCount=17 (exceeds MAX_OPTIONS=16) =====
    fs.writeFileSync(FIXTURES + '/r0-options-17.json',
        stringify({...r0Pos, vote: "0", optionCount: "17"}));
    console.log("Wrote r0-options-17.json");

    // ===== R0 Negative: wrong association path (correct root, wrong leaf) =====
    fs.writeFileSync(FIXTURES + '/r0-wrong-asp-path.json',
        stringify({...r0Pos, associationIndex: "1"}));
    console.log("Wrote r0-wrong-asp-path.json");

    // ===== R0 Negative: altered scope (different from input) =====
    // The circuit uses the public input electionScope for nullifier,
    // but the fixture has a different one. The matching proof won't work
    // because the credential commitment depends on the scope.
    // Instead: use a fixture where the scope has been altered.
    const alteredScope = "9999999999999999999999999999999999999999999999999999999999999999";
    fs.writeFileSync(FIXTURES + '/r0-altered-scope.json',
        stringify({...r0Pos, electionScope: alteredScope}));
    console.log("Wrote r0-altered-scope.json");

    // ===== R1 Negative: wrong commitment (vote=4 instead of 3) =====
    const r1WrongVote = "4";
    const r1WrongSalt = "42";
    const r1WrongVoteSaltHash = await p2(r1WrongVote, r1WrongSalt);
    const r1WrongBallotC = await p2(r1WrongVoteSaltHash, electionScope);
    fs.writeFileSync(FIXTURES + '/r1-wrong-commitment.json', stringify({
        ...r1Pos,
        vote: r1WrongVote,
        _meta: { description: 'Vote=4 but original fixture had vote=3. ballotCommitment will differ from circuit output.' }
    }));
    console.log("Wrote r1-wrong-commitment.json");

    // ===== R1 Positive: boundary vote=4, optionCount=5 =====
    fs.writeFileSync(FIXTURES + '/r1-boundary-4-of-5.json',
        stringify({...r1Pos, vote: "4", optionCount: "5"}));
    console.log("Wrote r1-boundary-4-of-5.json");

    // ===== R1 Negative: optionCount=17 (exceeds MAX_OPTIONS=16) =====
    fs.writeFileSync(FIXTURES + '/r1-options-17.json',
        stringify({...r1Pos, vote: "0", optionCount: "17"}));
    console.log("Wrote r1-options-17.json");

    // ===== R1 Negative: wrong association path =====
    fs.writeFileSync(FIXTURES + '/r1-wrong-asp-path.json',
        stringify({...r1Pos, associationIndex: "1"}));
    console.log("Wrote r1-wrong-asp-path.json");

    // ===== R1 Negative: altered scope =====
    fs.writeFileSync(FIXTURES + '/r1-altered-scope.json',
        stringify({...r1Pos, electionScope: alteredScope}));
    console.log("Wrote r1-altered-scope.json");

    // ===== Adversarial label=0 bypass fixtures =====
    // C0 soundness fix (commit 827de58+3c0755e): label=0 is an association-tree
    // padding leaf when the eligible tree has only label=111 at index 0.
    // credentialCommitment(0, 222, 333) = P2(0, P2(222, 333)) in state tree
    // at index 0; association proof for index 1 proves the zero-padding leaf.
    //
    // State tree: credentialCommitment(label=0, ns=222, td=333) at index 0
    console.log("\nBuilding label-zero adversarial fixtures:");
    const labelZero = "0";
    const preCZero = await p2(ns, td);
    const credCZero = await p2(labelZero, preCZero);
    console.log("credentialCommitment(0, 222, 333):", String(credCZero));
    const stateTreeZero = await buildTree([credCZero]);
    console.log("stateRoot (label=0 cred):", stateTreeZero.root);

    // Association tree: label=111 at index 0 (same as positive), zero-padded.
    // Index 1 is a zero leaf — the Merkle proof proves label=0 ∈ tree.
    console.log("associationRoot (label=111 at idx0):", assocTree.root);
    console.log("association leaf at idx1 (zero padding): 0");
    console.log("association index 1 siblings:", JSON.stringify(assocTree.leafSiblings[1]));

    // ===== R0 Negative: label=0 with padded-zero association path =====
    const r0LabelZero = {
        vote: "0", optionCount: "5",
        stateRoot: stateTreeZero.root, associationRoot: assocTree.root,
        electionScope: electionScope,
        label: labelZero, nullifierSecret: ns, trapdoor: td,
        stateIndex: "0", stateSiblings: stateTreeZero.leafSiblings[0],
        associationIndex: "1", associationSiblings: assocTree.leafSiblings[1],
        _meta: {
            description: "Adversarial label=0 bypass — uses zero-padded association leaf at index 1",
            expected: "MUST FAIL after C0 fix (label != 0 constraint)"
        }
    };
    fs.writeFileSync(FIXTURES + '/r0-label-zero.json', stringify(r0LabelZero));
    console.log("Wrote r0-label-zero.json");

    // ===== R1 Negative: label=0 with padded-zero association path =====
    const r1VoteZero = "3", r1SaltZero = "42", r1OptionsZero = "5";
    const voteSaltHashZero = await p2(r1VoteZero, r1SaltZero);
    const ballotCZero = await p2(voteSaltHashZero, electionScope);
    const r1LabelZero = {
        optionCount: r1OptionsZero,
        stateRoot: stateTreeZero.root, associationRoot: assocTree.root,
        electionScope: electionScope,
        label: labelZero, nullifierSecret: ns, trapdoor: td,
        vote: r1VoteZero, salt: r1SaltZero,
        stateIndex: "0", stateSiblings: stateTreeZero.leafSiblings[0],
        associationIndex: "1", associationSiblings: assocTree.leafSiblings[1],
        _meta: {
            description: "Adversarial label=0 bypass — uses zero-padded association leaf at index 1",
            expected: "MUST FAIL after C0 fix (label != 0 constraint)"
        }
    };
    fs.writeFileSync(FIXTURES + '/r1-label-zero.json', stringify(r1LabelZero));
    console.log("Wrote r1-label-zero.json");

    // ===== Adversarial nullifierSecret=0 bypass fixtures =====
    // nullifierSecret=0 produces a nullifier collision across credentials sharing
    // the same electionScope. The circuit must reject this.
    console.log("\nBuilding nullifier-zero adversarial fixtures:");
    const nsZero = "0";
    const preCZeroNS = await p2(nsZero, td);
    const credCZeroNS = await p2(label, preCZeroNS);
    console.log("credentialCommitment(nullifierSecret=0):", String(credCZeroNS));
    const stateTreeZeroNS = await buildTree([credCZeroNS]);
    console.log("stateRoot (ns=0):", stateTreeZeroNS.root);

    // ===== R0 Negative: nullifierSecret=0 =====
    const r0NullifierZero = {
        vote: "0", optionCount: "5",
        stateRoot: stateTreeZeroNS.root, associationRoot: assocTree.root,
        electionScope: electionScope,
        label: label, nullifierSecret: nsZero, trapdoor: td,
        stateIndex: "0", stateSiblings: stateTreeZeroNS.leafSiblings[0],
        associationIndex: "0", associationSiblings: assocTree.leafSiblings[0],
        _meta: {
            description: "Adversarial nullifierSecret=0 bypass",
            expected: "MUST FAIL: nullifierSecret != 0 constraint"
        }
    };
    fs.writeFileSync(FIXTURES + '/r0-nullifier-zero.json', stringify(r0NullifierZero));
    console.log("Wrote r0-nullifier-zero.json");

    // ===== R1 Negative: nullifierSecret=0 =====
    const r1NullifierZero = {
        optionCount: "5",
        stateRoot: stateTreeZeroNS.root, associationRoot: assocTree.root,
        electionScope: electionScope,
        label: label, nullifierSecret: nsZero, trapdoor: td,
        vote: "3", salt: "42",
        stateIndex: "0", stateSiblings: stateTreeZeroNS.leafSiblings[0],
        associationIndex: "0", associationSiblings: assocTree.leafSiblings[0],
        _meta: {
            description: "Adversarial nullifierSecret=0 bypass",
            expected: "MUST FAIL: nullifierSecret != 0 constraint"
        }
    };
    fs.writeFileSync(FIXTURES + '/r1-nullifier-zero.json', stringify(r1NullifierZero));
    console.log("Wrote r1-nullifier-zero.json");

    console.log("\nDone. All fixtures written to", FIXTURES);
}

main().catch(e => { console.error(e); process.exit(1); });
