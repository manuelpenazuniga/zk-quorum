#!/usr/bin/env node
// Write C0.4 Groth16 setup manifests from computed checksums.
// Called by scripts/setup-groth16.sh — reads R1CS info from snarkjs output,
// collects all checksums from argv, and writes manifests + copies VK JSONs.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_DIR = path.join(ROOT, 'circuits', 'artifacts', 'manifests');

const argv = process.argv.slice(2);
if (argv.length < 20) {
    console.error('Usage: node write-setup-manifests.js TIMESTAMP CIRCOM_VER SNARKJS_VER NODE_VER POWER PTAU_SHA PTAU_BYTES BEACON_HASH BEACON_ITERS R0_R1CS_SHA R0_R1CS_BYTES R0_ZKEY_SHA R0_ZKEY_BYTES R0_VK_SHA R0_VK_BYTES R1_R1CS_SHA R1_R1CS_BYTES R1_ZKEY_SHA R1_ZKEY_BYTES R1_VK_SHA R1_VK_BYTES');
    process.exit(1);
}

const [
    timestamp,
    circomVersion, snarkjsVersion, nodeVersion,
    powerStr,
    ptauSha256, ptauBytes, beaconHash, beaconItersStr,
    r0R1csSha256, r0R1csBytes, r0ZkeySha256, r0ZkeyBytes, r0VkSha256, r0VkBytes,
    r1R1csSha256, r1R1csBytes, r1ZkeySha256, r1ZkeyBytes, r1VkSha256, r1VkBytes,
] = argv;

const power = parseInt(powerStr, 10);
const beaconIters = parseInt(beaconItersStr, 10);
const powerCap = 1 << power;

const SNARKJS = path.join(ROOT, 'node_modules', '.bin', 'snarkjs');

function r1csInfo(r1csPath) {
    const out = execSync(`"${SNARKJS}" r1cs info ${r1csPath}`, {
        cwd: ROOT, encoding: 'utf8', stdio: 'pipe'
    });
    const info = {};
    const re = /# of ([\w\s]+):\s*(\d+)/g;
    let m;
    while ((m = re.exec(out)) !== null) {
        const key = m[1].trim().replace(/\s+/g, '_');
        info[key] = parseInt(m[2], 10);
    }
    return info;
}

const r0Info = r1csInfo(path.join(ROOT, 'circuits/build/public-vote/main.r1cs'));
const r1Info = r1csInfo(path.join(ROOT, 'circuits/build/commit-vote/main.r1cs'));

const r0TemplateInstances = 77;
const r1TemplateInstances = 77;

function buildManifest(name, rung, desc, r1csBits, zkeyBits, vkBits, info, templateInstances) {
    const bcHashShort = beaconHash.slice(0, 16) + '...';
    return {
        circuit: name,
        rung,
        description: desc,
        curve: 'bls12-381',
        proof_system: 'Groth16',
        circom_version: circomVersion,
        snarkjs_version: snarkjsVersion,
        node_version: nodeVersion,
        depth: 10,
        max_options: 16,
        setup_power: power,
        setup_power_justification: `2^${power} = ${powerCap} > ${info.Constraints} constraints. Minimum power that covers the constraint count.`,
        ceremony_type: 'TRUSTED_DEV_HACKATHON',
        reproducibility_boundary: 'IMMUTABLE_RELEASE_ASSETS__ZKEY_AND_PTAU_DELIVERED_VIA_IMMUTABLE_URL_WITH_SHA256_VERIFICATION__VK_JSON_FILES_COMMITTED_AS_TRUTH',
        r1cs: {
            file: 'main.r1cs',
            sha256: r1csBits.sha256,
            bytes: parseInt(r1csBits.bytes, 10),
            constraints: info.Constraints,
            non_linear: info.Non_linear,
            linear: info.Linear,
            wires: info.Wires,
            labels: info.Labels,
            template_instances: templateInstances,
            public_inputs: info.Public_Inputs,
            private_inputs: info.Private_Inputs,
            public_outputs: info.Outputs,
        },
        setup: {
            ptau: {
                file: 'pot14_final.ptau',
                sha256: ptauSha256,
                bytes: parseInt(ptauBytes, 10),
                curve: 'bls12-381',
                power,
                contributions: 2,
                beacon_hash: beaconHash,
                beacon_iterations_exp: beaconIters,
            },
            zkey: {
                file: `r${rung}_final.zkey`,
                sha256: zkeyBits.sha256,
                bytes: parseInt(zkeyBits.bytes, 10),
            },
            verification_key: {
                file: `r${rung}_vk.json`,
                sha256: vkBits.sha256,
                bytes: parseInt(vkBits.bytes, 10),
            },
            commands: [
                `snarkjs powersoftau new bls12381 ${power} pot14_0000.ptau`,
                'snarkjs powersoftau contribute pot14_0000.ptau pot14_0001.ptau --name="ZK-Quorum dev contribution"',
                `snarkjs powersoftau beacon pot14_0001.ptau pot14_beacon.ptau ${beaconHash} ${beaconIters} -n="Final Beacon"`,
                'snarkjs powersoftau prepare phase2 pot14_beacon.ptau pot14_final.ptau',
                `snarkjs groth16 setup ${rung === 0 ? 'public-vote' : 'commit-vote'}/main.r1cs pot14_final.ptau r${rung}_0000.zkey`,
                `snarkjs zkey contribute r${rung}_0000.zkey r${rung}_0001.zkey --name="R${rung} circuit-specific"`,
                `snarkjs zkey beacon r${rung}_0001.zkey r${rung}_final.zkey ${beaconHash} ${beaconIters} -n="R${rung} Final Beacon"`,
                `snarkjs zkey export verificationkey r${rung}_final.zkey r${rung}_vk.json`,
            ],
        },
        public_schema: {
            version: rung === 0 ? 'V1_R0' : 'V1_R1',
            total: 6,
            signals: rung === 0
                ? [
                    {index: 0, name: 'nullifierHash', type: 'Fr', kind: 'output'},
                    {index: 1, name: 'vote', type: 'u32', kind: 'public_input'},
                    {index: 2, name: 'optionCount', type: 'u32', kind: 'public_input'},
                    {index: 3, name: 'stateRoot', type: 'Fr', kind: 'public_input'},
                    {index: 4, name: 'associationRoot', type: 'Fr', kind: 'public_input'},
                    {index: 5, name: 'electionScope', type: 'Fr', kind: 'public_input'},
                ]
                : [
                    {index: 0, name: 'nullifierHash', type: 'Fr', kind: 'output'},
                    {index: 1, name: 'ballotCommitment', type: 'Fr', kind: 'output'},
                    {index: 2, name: 'optionCount', type: 'u32', kind: 'public_input'},
                    {index: 3, name: 'stateRoot', type: 'Fr', kind: 'public_input'},
                    {index: 4, name: 'associationRoot', type: 'Fr', kind: 'public_input'},
                    {index: 5, name: 'electionScope', type: 'Fr', kind: 'public_input'},
                ],
        },
        private_inputs: rung === 0
            ? [
                'label', 'nullifierSecret', 'trapdoor',
                'stateSiblings[10]', 'stateIndex',
                'associationSiblings[10]', 'associationIndex',
            ]
            : [
                'label', 'nullifierSecret', 'trapdoor', 'vote', 'salt',
                'stateSiblings[10]', 'stateIndex',
                'associationSiblings[10]', 'associationIndex',
            ],
        timestamp,
    };
}

const r0 = buildManifest('PublicVoteR0', 0,
    'Public vote with hidden identity/credential. Vote is public input.',
    {sha256: r0R1csSha256, bytes: r0R1csBytes},
    {sha256: r0ZkeySha256, bytes: r0ZkeyBytes},
    {sha256: r0VkSha256, bytes: r0VkBytes},
    r0Info, r0TemplateInstances);

const r1 = buildManifest('CommitVoteR1', 1,
    'Commit/reveal vote with hidden identity. Ballot commitment hides vote until reveal.',
    {sha256: r1R1csSha256, bytes: r1R1csBytes},
    {sha256: r1ZkeySha256, bytes: r1ZkeyBytes},
    {sha256: r1VkSha256, bytes: r1VkBytes},
    r1Info, r1TemplateInstances);

fs.writeFileSync(path.join(MANIFEST_DIR, 'public-vote-r0.json'), JSON.stringify(r0, null, 2) + '\n');
fs.writeFileSync(path.join(MANIFEST_DIR, 'commit-vote-r1.json'), JSON.stringify(r1, null, 2) + '\n');

// Copy VK JSONs to committed location
const setupDir = path.join(ROOT, 'tmp', 'setup');
fs.copyFileSync(path.join(setupDir, 'r0_vk.json'), path.join(MANIFEST_DIR, 'r0_vk.json'));
fs.copyFileSync(path.join(setupDir, 'r1_vk.json'), path.join(MANIFEST_DIR, 'r1_vk.json'));

console.log('Manifests and VK JSONs written to circuits/artifacts/manifests/');
