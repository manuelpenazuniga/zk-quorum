#![cfg(test)]

use crate::storage::Storage;
use crate::*;
use ark_bls12_381::{Fq, Fq2};
use ark_serialize::CanonicalSerialize;
use core::str::FromStr;
use soroban_sdk::{
    crypto::bls12_381::{Fr, G1Affine, G2Affine, G1_SERIALIZED_SIZE, G2_SERIALIZED_SIZE},
    testutils::{Address as _, Events as _, Ledger},
    Address, Bytes, BytesN, Env, U256,
};
use zk::{Proof, PublicSignals, VerificationKey, BLS12_381_FR_MODULUS};

// ── Low-level coordinate helpers ──

fn g1_from_coords(env: &Env, x: &str, y: &str) -> G1Affine {
    let ark_g1 = ark_bls12_381::G1Affine::new(Fq::from_str(x).unwrap(), Fq::from_str(y).unwrap());
    let mut buf = [0u8; G1_SERIALIZED_SIZE];
    ark_g1.serialize_uncompressed(&mut buf[..]).unwrap();
    G1Affine::from_array(env, &buf)
}

/// Return the G1 identity (point at infinity) in uncompressed encoding.
fn g1_identity(env: &Env) -> G1Affine {
    let mut buf = [0u8; G1_SERIALIZED_SIZE];
    buf[0] = 0x40; // arkworks uncompressed infinity flag
    G1Affine::from_array(env, &buf)
}

fn g2_from_coords(env: &Env, x1: &str, x2: &str, y1: &str, y2: &str) -> G2Affine {
    let x = Fq2::new(Fq::from_str(x1).unwrap(), Fq::from_str(x2).unwrap());
    let y = Fq2::new(Fq::from_str(y1).unwrap(), Fq::from_str(y2).unwrap());
    let ark_g2 = ark_bls12_381::G2Affine::new(x, y);
    let mut buf = [0u8; G2_SERIALIZED_SIZE];
    ark_g2.serialize_uncompressed(&mut buf[..]).unwrap();
    G2Affine::from_array(env, &buf)
}

/// Build VK bytes from the upstream c=33 fixture (a*b=c, IC len 2).
fn make_vk_bytes_c33(env: &Env) -> Bytes {
    let vk = VerificationKey {
        alpha: g1_from_coords(env,
            "851850525556173310373115880154698084608631105506432893865500290442025919078535925294035153152030470398262539759609",
            "2637289349983507610125993281171282870664683328789064436670091381805667870657250691837988574635646688089951719927247",
        ),
        beta: g2_from_coords(env,
            "1312620381151154625549413690218290437739613987001512553647554932245743783919690104921577716179019375920325686841943",
            "1853421227732662200477195678252233549930451033531229987959164216695698667330234953033341200627605777603511819497457",
            "3215807833988244618006117550809420301978856703407297742347804415291049013404133666905173282837707341742014140541018",
            "812366606879346135498483310623227330050424196838294715759414425317592599094348477520229174120664109186562798527696",
        ),
        gamma: g2_from_coords(env,
            "352701069587466618187139116011060144890029952792775240219908644239793785735715026873347600343865175952761926303160",
            "3059144344244213709971259814753781636986470325476647558659373206291635324768958432433509563104347017837885763365758",
            "1985150602287291935568054521177171638300868978215655730859378665066344726373823718423869104263333984641494340347905",
            "927553665492332455747201965776037880757740193453592970025027978793976877002675564980949289727957565575433344219582",
        ),
        delta: g2_from_coords(env,
            "2981843938988033214458466658185878126396080429969635248100956025957789319926032198626745120548947333202362392267114",
            "2236695112259305382987038341098587500598216646308901956168137697892380899086228863246537938263638056666003066263342",
            "717163810166643254871951856655865822196000925757284470845197358532703820821048809982340614428800986999944933231635",
            "3496058064578305387608803828034117220735807855182872031001942587835768203820179263722136810383631418598310938506798",
        ),
        ic: Vec::from_array(env, [
            g1_from_coords(env,
                "829685638389803071404995253486571779300247099942205634643821309129201420207693030476756893332812706176564514055395",
                "3455508165409829148751617737772894557887792278044850553785496869183933597103951941805834639972489587640583544390358",
            ),
            g1_from_coords(env,
                "2645559270376031734407122278942646687260452979296081924477586893972449945444985371392950465676350735694002713633589",
                "2241039659097418315097403108596818813895651201896886552939297756980670248638746432560267634304593609165964274111037",
            ),
        ]),
    };
    vk.to_bytes(env)
}

/// Extend the c=33 VK from IC length 2 to IC length 7 by appending five
/// G1 identity points. The five extra public inputs must therefore be zero
/// for the pairing check to remain valid; this lets us reuse the c=33 proof
/// (one public input) for the R0 schema (six public inputs).
fn make_vk_bytes_c33_extended(env: &Env) -> Bytes {
    let mut vk = VerificationKey::from_bytes(env, &make_vk_bytes_c33(env)).unwrap();
    for _ in 0..5 {
        vk.ic.push_back(g1_identity(env));
    }
    vk.to_bytes(env)
}

fn make_proof_bytes_c33(env: &Env) -> Bytes {
    let proof = Proof {
        a: g1_from_coords(env,
            "314442236668110257304682488877371582255161413673331360366570443799415414639292047869143313601702131653514009114222",
            "2384632327855835824635705027009217874826122107057894594162233214798350178691568018290025994699762298534539543934607",
        ),
        b: g2_from_coords(env,
            "428844167033934720609657613212495751617651348480870890908850335525890280786532876634895457032623422366474694342656",
            "3083139526360252775789959298805261067575555607578161553873977966165446991459924053189383038704105379290158793353905",
            "1590919422794657666432683000821892403620510405626533455397042191265963587891653562867091397248216891852168698286910",
            "3617931039814164588401589536353142503544155307022467123698224064329647390280346725086550997337076315487486714327146",
        ),
        c: g1_from_coords(env,
            "3052934797502613468327963344215392478880720823583493172692775426011388142569325036386650708808320216973179639719187",
            "2028185281516938724429867827057869371578022471499780916652824405212207527699373814371051328341613972789943854539597",
        ),
    };
    proof.to_bytes(env)
}

/// Build a dummy VK bytes blob (not matching any proof - for validation tests).
fn make_dummy_vk_bytes(env: &Env) -> Bytes {
    let vk = VerificationKey {
        alpha: g1_from_coords(env,
            "2625583050305146829700663917277485398332586266229739236073977691599912239208704058548731458555934906273399977862822",
            "1155364156944807367912876641032696519500054551629402873339575774959620483194368919563799050765095981406853619398751",
        ),
        beta: g2_from_coords(env,
            "1659696755509039809248937927616726274238080235224171061036366585278216098417245587200210264410333778948851576160490",
            "1338363397031837211155983756179787835339490797745307535810204658838394402900152502268197396587061400659003281046656",
            "1974652615426136516341494326987376616840373177388374023461177997087381634383568759591087499459321812809521924259354",
            "3301884318087924474550898163462840036865878131635519297186391370517333773367262804074867347346141727012544462046142",
        ),
        gamma: g2_from_coords(env,
            "352701069587466618187139116011060144890029952792775240219908644239793785735715026873347600343865175952761926303160",
            "3059144344244213709971259814753781636986470325476647558659373206291635324768958432433509563104347017837885763365758",
            "1985150602287291935568054521177171638300868978215655730859378665066344726373823718423869104263333984641494340347905",
            "927553665492332455747201965776037880757740193453592970025027978793976877002675564980949289727957565575433344219582",
        ),
        delta: g2_from_coords(env,
            "2750191744467054372912942146482544263484467550244832445881626112777617723646810063952263428512022936903253267127350",
            "2413234737575312815700598631122026291319065432043412800839944397857332202830802685415923770088689063622756702939375",
            "1076967202486993406108941342102174843689250913208763125383730107292668137282535239225119066564005251774661400843821",
            "784091089348445241891924627629031628871298938526420228496183038286414003726447208549611976928427786617444752683904",
        ),
        ic: Vec::from_array(env, [
            g1_from_coords(env,
                "1931769351244036379618100283994844046485312882458040431401676712058257124546097756332532237907637132315648906217636",
                "2219462221684288788247757134332962645470083865115055927456187574960992952094314940257753501443104606354496083113203",
            ),
            g1_from_coords(env,
                "2726325242623221693388802248110816107554759305800882344642286106642968529507795071709947858512355148550879270019178",
                "2690452834591447292232392438454117662004701691035040250634864436657178120453111433393322306334324558619029220405511",
            ),
            g1_from_coords(env,
                "2276753520377413052133204619264853734926027674320220733263964937413806530791610300908525130874383991218501161443629",
                "2216565042994647061456742959690979278824752277479734731836503122505090074006677407948960110633236603228440758211011",
            ),
            g1_from_coords(env,
                "2054702829658916052030239062784122350883101497414801284378548048954817335805733517964277882891682327579038641542963",
                "1861299377849520465661244108949779781960526739720579329803172490216038156998919390163110860296739149427635782605232",
            ),
            g1_from_coords(env,
                "2856004998221708121377069305149495649378668245327503671752831152976814973551962498318427356938380464598719642329610",
                "3445052445376607662168014620609501339582857414982758608624858423598446194176241135586201569345644453045853894315946",
            ),
            g1_from_coords(env,
                "2856004998221708121377069305149495649378668245327503671752831152976814973551962498318427356938380464598719642329610",
                "3445052445376607662168014620609501339582857414982758608624858423598446194176241135586201569345644453045853894315946",
            ),
            g1_from_coords(env,
                "1931769351244036379618100283994844046485312882458040431401676712058257124546097756332532237907637132315648906217636",
                "2219462221684288788247757134332962645470083865115055927456187574960992952094314940257753501443104606354496083113203",
            ),
        ]),
    };
    vk.to_bytes(env)
}

fn make_empty_proof_bytes(env: &Env) -> Bytes {
    let mut bytes = Bytes::new(env);
    let zeros = [0u8; G1_SERIALIZED_SIZE + G2_SERIALIZED_SIZE + G1_SERIALIZED_SIZE];
    bytes.append(&Bytes::from_slice(env, &zeros));
    bytes
}

fn make_r0_pub_signals_bytes(
    env: &Env,
    nullifier_hash: &[u8; 32],
    vote: u32,
    option_count: u32,
    state_root: &[u8; 32],
    association_root: &[u8; 32],
    election_scope: &[u8; 32],
) -> Bytes {
    let pub_signals = PublicSignals {
        pub_signals: Vec::from_array(
            env,
            [
                Fr::from_u256(U256::from_be_bytes(
                    env,
                    &Bytes::from_array(env, nullifier_hash),
                )),
                Fr::from_u256(U256::from_u32(env, vote)),
                Fr::from_u256(U256::from_u32(env, option_count)),
                Fr::from_u256(U256::from_be_bytes(
                    env,
                    &Bytes::from_array(env, state_root),
                )),
                Fr::from_u256(U256::from_be_bytes(
                    env,
                    &Bytes::from_array(env, association_root),
                )),
                Fr::from_u256(U256::from_be_bytes(
                    env,
                    &Bytes::from_array(env, election_scope),
                )),
            ],
        ),
    };
    pub_signals.to_bytes(env)
}

fn make_r1_pub_signals_bytes(
    env: &Env,
    nullifier_hash: &[u8; 32],
    ballot_commitment: &[u8; 32],
    option_count: u32,
    state_root: &[u8; 32],
    association_root: &[u8; 32],
    election_scope: &[u8; 32],
) -> Bytes {
    let pub_signals = PublicSignals {
        pub_signals: Vec::from_array(
            env,
            [
                Fr::from_u256(U256::from_be_bytes(
                    env,
                    &Bytes::from_array(env, nullifier_hash),
                )),
                Fr::from_u256(U256::from_be_bytes(
                    env,
                    &Bytes::from_array(env, ballot_commitment),
                )),
                Fr::from_u256(U256::from_u32(env, option_count)),
                Fr::from_u256(U256::from_be_bytes(
                    env,
                    &Bytes::from_array(env, state_root),
                )),
                Fr::from_u256(U256::from_be_bytes(
                    env,
                    &Bytes::from_array(env, association_root),
                )),
                Fr::from_u256(U256::from_be_bytes(
                    env,
                    &Bytes::from_array(env, election_scope),
                )),
            ],
        ),
    };
    pub_signals.to_bytes(env)
}

fn nullifier_hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn example_scope(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[2u8; 32])
}
fn example_state_root(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[3u8; 32])
}
fn example_association_root(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[4u8; 32])
}

/// Register the verifier contract, then register zk-quorum with proper VK bytes.
fn setup_contract(env: &Env) -> (Address, Address) {
    // Register verifier first
    let verifier_id = env.register(crate::verifier_client::WASM, ());

    let admin = Address::generate(env);
    let vk_r0 = make_dummy_vk_bytes(env);
    let vk_r1 = make_dummy_vk_bytes(env);
    // Compute VK hashes from the VK bytes
    let vk_r0_hash = sha256_bytes(env, &vk_r0);
    let vk_r1_hash = sha256_bytes(env, &vk_r1);

    let contract_id = env.register(
        ZkQuorumContract,
        (
            admin.clone(),
            verifier_id.clone(),
            vk_r0,
            vk_r1,
            vk_r0_hash,
            vk_r1_hash,
        ),
    );

    (contract_id, admin)
}

/// Register zk-quorum with the real c=33 VK as both R0 and R1 VK (for the
/// positive cross-contract test).
#[allow(dead_code)]
fn setup_contract_with_c33_vk(env: &Env) -> (Address, Address) {
    let verifier_id = env.register(crate::verifier_client::WASM, ());

    let admin = Address::generate(env);
    let vk = make_vk_bytes_c33(env);
    let vk_hash = sha256_bytes(env, &vk);

    let contract_id = env.register(
        ZkQuorumContract,
        (
            admin.clone(),
            verifier_id.clone(),
            vk.clone(),
            vk.clone(),
            vk_hash.clone(),
            vk_hash.clone(),
        ),
    );

    (contract_id, admin)
}

// ── Constructor tests ──

#[test]
fn test_constructor() {
    let env = Env::default();
    let verifier_id = env.register(crate::verifier_client::WASM, ());
    let admin = Address::generate(&env);
    let vk = make_dummy_vk_bytes(&env);
    let vk_hash = sha256_bytes(&env, &vk);

    let contract_id = env.register(
        ZkQuorumContract,
        (
            admin.clone(),
            verifier_id.clone(),
            vk.clone(),
            vk.clone(),
            vk_hash.clone(),
            vk_hash.clone(),
        ),
    );

    let client = ZkQuorumContractClient::new(&env, &contract_id);
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_verifier(), verifier_id);
}

#[test]
#[should_panic]
fn test_constructor_twice() {
    let env = Env::default();
    let verifier_id = env.register(crate::verifier_client::WASM, ());
    let admin = Address::generate(&env);
    let vk = make_dummy_vk_bytes(&env);
    let vk_hash = sha256_bytes(&env, &vk);

    let contract_id = env.register(
        ZkQuorumContract,
        (
            admin.clone(),
            verifier_id.clone(),
            vk.clone(),
            vk.clone(),
            vk_hash.clone(),
            vk_hash.clone(),
        ),
    );
    let _client = ZkQuorumContractClient::new(&env, &contract_id);

    let verifier = Address::generate(&env);
    let hash = BytesN::from_array(&env, &[0u8; 32]);
    Storage::init(&env, &admin, &verifier, &vk, &vk, &hash, &hash).unwrap();
}

// ── open_election tests ──

#[test]
fn test_open_election_success() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();
    let opens_at = now + 1;
    let closes_at = now + 1000;

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &opens_at,
        &closes_at,
        &0u64,
    );

    let election = client.get_election(&election_id);
    assert_eq!(election.mode, ElectionMode::R0);
    assert_eq!(election.option_count, 3u32);
    assert_eq!(election.opens_at, opens_at);
    assert_eq!(election.closes_at, closes_at);
}

#[test]
fn test_open_election_non_admin() {
    let env = Env::default();
    let (contract_id, _admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let non_admin = Address::generate(&env);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    let result = client.try_open_election(
        &non_admin,
        &BytesN::from_array(&env, &[1u8; 32]),
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &(now + 1),
        &(now + 1000),
        &0u64,
    );

    assert_eq!(result, Err(Ok(Error::NotAdmin)));
}

#[test]
fn test_open_election_invalid_option_count() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let now = env.ledger().timestamp();
    env.mock_all_auths();

    let result = client.try_open_election(
        &admin,
        &BytesN::from_array(&env, &[1u8; 32]),
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &0u32,
        &(now + 1),
        &(now + 1000),
        &0u64,
    );
    assert_eq!(result, Err(Ok(Error::InvalidOptionCount)));

    let result = client.try_open_election(
        &admin,
        &BytesN::from_array(&env, &[2u8; 32]),
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &(MAX_OPTIONS + 1),
        &(now + 1),
        &(now + 1000),
        &0u64,
    );
    assert_eq!(result, Err(Ok(Error::InvalidOptionCount)));
}

#[test]
fn test_open_election_invalid_timestamps() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    env.mock_all_auths();

    let result = client.try_open_election(
        &admin,
        &BytesN::from_array(&env, &[1u8; 32]),
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &100u64,
        &50u64,
        &0u64,
    );
    assert_eq!(result, Err(Ok(Error::InvalidTimestamp)));

    env.ledger().set_timestamp(500);
    let result = client.try_open_election(
        &admin,
        &BytesN::from_array(&env, &[0xF0u8; 32]),
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &10u64,
        &100u64,
        &0u64,
    );
    assert_eq!(result, Err(Ok(Error::InvalidTimestamp)));
}

#[test]
fn test_open_election_r1_invalid_reveal_window() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let now = env.ledger().timestamp();
    env.mock_all_auths();

    let result = client.try_open_election(
        &admin,
        &BytesN::from_array(&env, &[1u8; 32]),
        &example_scope(&env),
        &ElectionMode::R1,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &(now + 1),
        &100u64,
        &100u64,
    );
    assert_eq!(result, Err(Ok(Error::InvalidRevealWindow)));

    let result = client.try_open_election(
        &admin,
        &BytesN::from_array(&env, &[2u8; 32]),
        &example_scope(&env),
        &ElectionMode::R1,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &(now + 1),
        &100u64,
        &50u64,
    );
    assert_eq!(result, Err(Ok(Error::InvalidRevealWindow)));
}

#[test]
fn test_open_election_duplicate() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &(now + 1),
        &(now + 1000),
        &0u64,
    );

    let result = client.try_open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &(now + 1),
        &(now + 1000),
        &0u64,
    );
    assert_eq!(result, Err(Ok(Error::ElectionAlreadyExists)));
}

// ── cast validation tests ──

#[test]
fn test_cast_election_not_found() {
    let env = Env::default();
    let (contract_id, _admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let proof_bytes = make_empty_proof_bytes(&env);
    let pub_sigs =
        make_r0_pub_signals_bytes(&env, &[0u8; 32], 0, 3, &[0u8; 32], &[0u8; 32], &[0u8; 32]);

    let result = client.try_cast(
        &BytesN::from_array(&env, &[0xFFu8; 32]),
        &proof_bytes,
        &pub_sigs,
    );
    assert_eq!(result, Err(Ok(Error::ElectionNotFound)));
}

#[test]
fn test_cast_election_not_started() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &(now + 1000),
        &(now + 2000),
        &0u64,
    );

    let proof_bytes = make_empty_proof_bytes(&env);
    let pub_sigs =
        make_r0_pub_signals_bytes(&env, &[0u8; 32], 0, 3, &[3u8; 32], &[4u8; 32], &[2u8; 32]);

    let result = client.try_cast(&election_id, &proof_bytes, &pub_sigs);
    assert_eq!(result, Err(Ok(Error::ElectionNotStarted)));
}

#[test]
fn test_cast_election_closed() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();
    let opens_at = now + 100;

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &opens_at,
        &(opens_at + 100),
        &0u64,
    );

    env.ledger().set_timestamp(opens_at + 200);

    let proof_bytes = make_empty_proof_bytes(&env);
    let pub_sigs =
        make_r0_pub_signals_bytes(&env, &[0u8; 32], 0, 3, &[3u8; 32], &[4u8; 32], &[2u8; 32]);

    let result = client.try_cast(&election_id, &proof_bytes, &pub_sigs);
    assert_eq!(result, Err(Ok(Error::ElectionClosed)));
}

#[test]
fn test_cast_malformed_proof() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    let short_proof = Bytes::from_array(&env, &[0u8; 10]);
    let pub_sigs =
        make_r0_pub_signals_bytes(&env, &[0u8; 32], 0, 3, &[3u8; 32], &[4u8; 32], &[2u8; 32]);

    let result = client.try_cast(&election_id, &short_proof, &pub_sigs);
    assert_eq!(result, Err(Ok(Error::MalformedProof)));
}

#[test]
fn test_cast_malformed_public_signals() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    let proof_bytes = make_empty_proof_bytes(&env);
    let short_sigs = Bytes::from_array(&env, &[0u8; 5]);

    let result = client.try_cast(&election_id, &proof_bytes, &short_sigs);
    assert_eq!(result, Err(Ok(Error::MalformedPublicSignals)));
}

#[test]
fn test_cast_wrong_signal_count() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    let proof_bytes = make_empty_proof_bytes(&env);
    let pub_signals = PublicSignals {
        pub_signals: Vec::from_array(
            &env,
            [
                Fr::from_u256(U256::from_u32(&env, 1)),
                Fr::from_u256(U256::from_u32(&env, 2)),
                Fr::from_u256(U256::from_u32(&env, 3)),
            ],
        ),
    };
    let sigs_bytes = pub_signals.to_bytes(&env);

    let result = client.try_cast(&election_id, &proof_bytes, &sigs_bytes);
    assert_eq!(result, Err(Ok(Error::MalformedPublicSignals)));
}

#[test]
fn test_cast_r0_option_count_mismatch() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &5u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    let proof_bytes = make_empty_proof_bytes(&env);
    let pub_sigs =
        make_r0_pub_signals_bytes(&env, &[0u8; 32], 0, 3, &[3u8; 32], &[4u8; 32], &[2u8; 32]);

    let result = client.try_cast(&election_id, &proof_bytes, &pub_sigs);
    assert_eq!(result, Err(Ok(Error::InvalidOptionCount)));
}

#[test]
fn test_cast_r0_root_mismatch() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    let proof_bytes = make_empty_proof_bytes(&env);
    let pub_sigs = make_r0_pub_signals_bytes(
        &env,
        &[0u8; 32],
        0,
        3,
        &[0x22u8; 32],
        &[4u8; 32],
        &[2u8; 32],
    );

    let result = client.try_cast(&election_id, &proof_bytes, &pub_sigs);
    assert_eq!(result, Err(Ok(Error::RootMismatch)));
}

#[test]
fn test_cast_r0_scope_mismatch() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    let proof_bytes = make_empty_proof_bytes(&env);
    let pub_sigs = make_r0_pub_signals_bytes(
        &env,
        &[0u8; 32],
        0,
        3,
        &[3u8; 32],
        &[4u8; 32],
        &[0x22u8; 32],
    );

    let result = client.try_cast(&election_id, &proof_bytes, &pub_sigs);
    assert_eq!(result, Err(Ok(Error::ScopeMismatch)));
}

#[test]
fn test_cast_r0_vote_out_of_range() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    let proof_bytes = make_empty_proof_bytes(&env);
    let pub_sigs =
        make_r0_pub_signals_bytes(&env, &[0u8; 32], 3, 3, &[3u8; 32], &[4u8; 32], &[2u8; 32]);

    let result = client.try_cast(&election_id, &proof_bytes, &pub_sigs);
    assert_eq!(result, Err(Ok(Error::VoteOutOfRange)));
}

#[test]
fn test_cast_r0_nullifier_dedup() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let nh = nullifier_hash(&env, 0x11);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    env.as_contract(&contract_id, || {
        Storage::mark_nullifier(&env, &election_id, &nh);
    });
    assert!(client.is_nullifier_used(&election_id, &nh));

    let proof_bytes = make_empty_proof_bytes(&env);
    let pub_sigs = make_r0_pub_signals_bytes(
        &env,
        &[0x11u8; 32],
        0,
        3,
        &[3u8; 32],
        &[4u8; 32],
        &[2u8; 32],
    );

    let result = client.try_cast(&election_id, &proof_bytes, &pub_sigs);
    assert_eq!(result, Err(Ok(Error::NullifierAlreadyUsed)));
}

// ── R1 cast validation ──

#[test]
fn test_cast_r1_scope_mismatch() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R1,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &(now + 2000),
    );

    let proof_bytes = make_empty_proof_bytes(&env);
    let pub_sigs = make_r1_pub_signals_bytes(
        &env,
        &[0u8; 32],
        &[0x0Cu8; 32],
        3,
        &[3u8; 32],
        &[4u8; 32],
        &[0x22u8; 32],
    );

    let result = client.try_cast(&election_id, &proof_bytes, &pub_sigs);
    assert_eq!(result, Err(Ok(Error::ScopeMismatch)));
}

#[test]
fn test_cast_r1_nullifier_dedup() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let nh = nullifier_hash(&env, 0x02);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R1,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &(now + 2000),
    );

    env.as_contract(&contract_id, || {
        Storage::mark_nullifier(&env, &election_id, &nh);
    });

    let proof_bytes = make_empty_proof_bytes(&env);
    let pub_sigs = make_r1_pub_signals_bytes(
        &env,
        &[0x02u8; 32],
        &[0x0Cu8; 32],
        3,
        &[3u8; 32],
        &[4u8; 32],
        &[2u8; 32],
    );

    let result = client.try_cast(&election_id, &proof_bytes, &pub_sigs);
    assert_eq!(result, Err(Ok(Error::NullifierAlreadyUsed)));
}

// ── reveal tests ──

#[test]
fn test_reveal_commitment_not_found() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let base: u64 = 1_000;
    env.ledger().set_timestamp(base);
    let opens_at = base + 100;
    let closes_at = base + 500;
    let reveal_closes_at = base + 5_000;

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R1,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &opens_at,
        &closes_at,
        &reveal_closes_at,
    );

    env.ledger().set_timestamp(base + 2_000);

    let commitment = BytesN::from_array(&env, &[0xCCu8; 32]);
    let salt = BytesN::from_array(&env, &[0xDDu8; 32]);

    let result = client.try_reveal(&election_id, &0u32, &salt, &commitment);
    assert_eq!(result, Err(Ok(Error::CommitmentNotFound)));
}

#[test]
fn test_reveal_wrong_mode() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    let commitment = BytesN::from_array(&env, &[0xCCu8; 32]);
    let salt = BytesN::from_array(&env, &[0xDDu8; 32]);

    let result = client.try_reveal(&election_id, &0u32, &salt, &commitment);
    assert_eq!(result, Err(Ok(Error::InvalidMode)));
}

#[test]
fn test_reveal_before_close() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R1,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 5000),
        &(now + 10000),
    );

    let commitment = BytesN::from_array(&env, &[0xCCu8; 32]);
    let salt = BytesN::from_array(&env, &[0xDDu8; 32]);

    let result = client.try_reveal(&election_id, &0u32, &salt, &commitment);
    assert_eq!(result, Err(Ok(Error::RevealNotOpen)));
}

#[test]
fn test_reveal_after_window() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let base: u64 = 1_000;
    env.ledger().set_timestamp(base);
    let opens_at = base + 100;
    let closes_at = base + 500;
    let reveal_closes_at = base + 1_000;

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R1,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &opens_at,
        &closes_at,
        &reveal_closes_at,
    );

    env.ledger().set_timestamp(reveal_closes_at + 100);

    let commitment = BytesN::from_array(&env, &[0xCCu8; 32]);
    let salt = BytesN::from_array(&env, &[0xDDu8; 32]);

    let result = client.try_reveal(&election_id, &0u32, &salt, &commitment);
    assert_eq!(result, Err(Ok(Error::RevealWindowClosed)));
}

#[test]
fn test_reveal_double() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let base: u64 = 1_000;
    env.ledger().set_timestamp(base);
    let opens_at = base + 100;
    let closes_at = base + 500;
    let reveal_closes_at = base + 5_000;

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R1,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &opens_at,
        &closes_at,
        &reveal_closes_at,
    );

    env.ledger().set_timestamp(base + 2_000);

    let commitment = BytesN::from_array(&env, &[0xCCu8; 32]);
    let salt = BytesN::from_array(&env, &[0xDDu8; 32]);

    let pending = PendingCommitment {
        bucket: 0,
        revealed: true,
    };
    env.as_contract(&contract_id, || {
        Storage::update_pending_commitment(&env, &election_id, &commitment, &pending);
    });

    let result = client.try_reveal(&election_id, &0u32, &salt, &commitment);
    assert_eq!(result, Err(Ok(Error::AlreadyRevealed)));
}

#[test]
fn test_reveal_vote_out_of_range() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let base: u64 = 1_000;
    env.ledger().set_timestamp(base);
    let opens_at = base + 100;
    let closes_at = base + 500;
    let reveal_closes_at = base + 5_000;

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R1,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &opens_at,
        &closes_at,
        &reveal_closes_at,
    );

    env.ledger().set_timestamp(base + 2_000);

    let commitment = BytesN::from_array(&env, &[0xCCu8; 32]);
    let salt = BytesN::from_array(&env, &[0xDDu8; 32]);

    // Need the commitment to exist (unrevealed) first
    let entry = PendingCommitment {
        bucket: 0,
        revealed: false,
    };
    env.as_contract(&contract_id, || {
        Storage::update_pending_commitment(&env, &election_id, &commitment, &entry);
    });

    let result = client.try_reveal(&election_id, &5u32, &salt, &commitment);
    assert_eq!(result, Err(Ok(Error::VoteOutOfRange)));
}

// ── result tests ──

#[test]
fn test_result_empty() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    let summary = client.result(&election_id);
    assert_eq!(summary.commit_count, 0);
    assert_eq!(summary.reveal_count, 0);
    assert_eq!(summary.non_reveal_count, 0);
    for i in 0..3 {
        assert_eq!(summary.tally.get(i).unwrap(), 0);
    }
}

#[test]
fn test_result_election_not_found() {
    let env = Env::default();
    let (contract_id, _admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let result = client.try_result(&BytesN::from_array(&env, &[0xFFu8; 32]));
    assert_eq!(result, Err(Ok(Error::ElectionNotFound)));
}

// ── audit_summary tests ──

#[test]
fn test_audit_summary() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();
    let scope = example_scope(&env);
    let state_root = example_state_root(&env);
    let assoc_root = example_association_root(&env);

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &scope,
        &ElectionMode::R1,
        &state_root,
        &assoc_root,
        &3u32,
        &now,
        &(now + 1000),
        &(now + 2000),
    );

    let summary = client.audit_summary(&election_id);
    assert_eq!(summary.option_count, 3u32);
    assert_eq!(summary.mode, ElectionMode::R1);
    assert_eq!(summary.state_root, state_root);
    assert_eq!(summary.association_root, assoc_root);
    assert_eq!(summary.election_scope, scope);
    assert_eq!(summary.commit_count, 0);
    assert_eq!(summary.non_reveal_count, 0);
}

// ── TTL tests ──

#[test]
fn test_extend_election_ttl_success() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    client.extend_election_ttl(&election_id, &120u32, &535_680u32);
}

#[test]
fn test_extend_election_ttl_not_found() {
    let env = Env::default();
    let (contract_id, _admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let result = client.try_extend_election_ttl(
        &BytesN::from_array(&env, &[0xFFu8; 32]),
        &120u32,
        &535_680u32,
    );
    assert_eq!(result, Err(Ok(Error::ElectionNotFound)));
}

// ── Bucket tests ──

#[test]
fn test_tally_bucket_deterministic() {
    let env = Env::default();
    let mut arr = [0u8; 32];
    arr[31] = 0x0A;
    let nh1 = BytesN::from_array(&env, &arr);
    let nh2 = BytesN::from_array(&env, &arr);
    assert_eq!(
        tally_bucket_from_nullifier(&nh1),
        tally_bucket_from_nullifier(&nh2)
    );
}

#[test]
fn test_tally_bucket_range() {
    for b in 0u8..=255u8 {
        let mut arr = [0u8; 32];
        arr[31] = b;
        let nh = BytesN::from_array(&Env::default(), &arr);
        let bucket = tally_bucket_from_nullifier(&nh);
        assert!(bucket < TALLY_BUCKETS);
    }
}

#[test]
fn test_tally_bucket_distribution() {
    let env = Env::default();
    let test_cases = [
        (0x00, 0),
        (0x01, 1),
        (0x0F, 15),
        (0x10, 0),
        (0x11, 1),
        (0xFF, 15),
    ];
    for (byte, expected) in test_cases.iter() {
        let mut arr = [0u8; 32];
        arr[31] = *byte;
        let nh = BytesN::from_array(&env, &arr);
        assert_eq!(tally_bucket_from_nullifier(&nh), *expected as u32);
    }
}

// ── Event tests ──

#[test]
fn test_no_event_on_failed_cast() {
    let env = Env::default();
    let (contract_id, _admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let proof_bytes = make_empty_proof_bytes(&env);
    let pub_sigs =
        make_r0_pub_signals_bytes(&env, &[0u8; 32], 0, 3, &[3u8; 32], &[4u8; 32], &[2u8; 32]);

    let _ = client.try_cast(
        &BytesN::from_array(&env, &[0xFFu8; 32]),
        &proof_bytes,
        &pub_sigs,
    );

    let all_events = env.events().all();
    assert_eq!(all_events.events().len(), 0);
}

// ── Multi-election independence ──

#[test]
fn test_multi_election_independence() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let now = env.ledger().timestamp();

    let eid1 = BytesN::from_array(&env, &[1u8; 32]);
    let eid2 = BytesN::from_array(&env, &[2u8; 32]);

    env.mock_all_auths();
    client.open_election(
        &admin,
        &eid1,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3,
        &now,
        &(now + 1000),
        &0,
    );
    env.mock_all_auths();
    client.open_election(
        &admin,
        &eid2,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &5,
        &now,
        &(now + 2000),
        &0,
    );

    let nh = nullifier_hash(&env, 0xCC);
    env.as_contract(&contract_id, || {
        Storage::mark_nullifier(&env, &eid1, &nh);
    });

    assert!(client.is_nullifier_used(&eid1, &nh));
    assert!(!client.is_nullifier_used(&eid2, &nh));
}

// ── Full R1 reveal lifecycle ──

#[test]
fn test_r1_commit_and_reveal_lifecycle() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let base: u64 = 1_000;
    env.ledger().set_timestamp(base);
    let opens_at = base + 100;
    let closes_at = base + 500;
    let reveal_closes_at = base + 5_000;
    let scope = example_scope(&env);

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &scope,
        &ElectionMode::R1,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &opens_at,
        &closes_at,
        &reveal_closes_at,
    );

    env.ledger().set_timestamp(base + 2_000);

    let mut salt_arr = [0u8; 32];
    salt_arr[31] = 0xAA;
    let salt = BytesN::from_array(&env, &salt_arr);
    let mut salt2_arr = [0u8; 32];
    salt2_arr[31] = 0xBB;
    let salt2 = BytesN::from_array(&env, &salt2_arr);

    let commitment1 = recompute_ballot_commitment(&env, 0, &salt, &scope).unwrap();
    let commitment2 = recompute_ballot_commitment(&env, 1, &salt, &scope).unwrap();
    let commitment3 = recompute_ballot_commitment(&env, 2, &salt2, &scope).unwrap();
    let nh1 = nullifier_hash(&env, 0x11);
    let nh2 = nullifier_hash(&env, 0x22);
    let nh3 = nullifier_hash(&env, 0x33);

    env.as_contract(&contract_id, || {
        for (commitment, nh) in [
            (&commitment1, &nh1),
            (&commitment2, &nh2),
            (&commitment3, &nh3),
        ] {
            Storage::mark_nullifier(&env, &election_id, nh);
            let bucket = tally_bucket_from_nullifier(nh);
            let pending = PendingCommitment {
                bucket,
                revealed: false,
            };
            Storage::update_pending_commitment(&env, &election_id, commitment, &pending);
            Storage::increment_commit_count(&env, &election_id).unwrap();
        }
    });

    assert_eq!(client.result(&election_id).commit_count, 3);
    assert_eq!(client.result(&election_id).reveal_count, 0);
    assert_eq!(client.result(&election_id).non_reveal_count, 3);

    client.reveal(&election_id, &0u32, &salt, &commitment1);

    let summary = client.result(&election_id);
    assert_eq!(summary.commit_count, 3);
    assert_eq!(summary.reveal_count, 1);
    assert_eq!(summary.non_reveal_count, 2);
    assert_eq!(summary.tally.get(0).unwrap(), 1);

    client.reveal(&election_id, &1u32, &salt, &commitment2);
    let summary = client.result(&election_id);
    assert_eq!(summary.reveal_count, 2);
    assert_eq!(summary.non_reveal_count, 1);
    assert_eq!(summary.tally.get(1).unwrap(), 1);

    let result = client.try_reveal(&election_id, &0u32, &salt, &commitment2);
    assert_eq!(result, Err(Ok(Error::AlreadyRevealed)));

    let mut wrong_salt_arr = [0u8; 32];
    wrong_salt_arr[31] = 0xCC;
    let wrong_salt = BytesN::from_array(&env, &wrong_salt_arr);
    let result = client.try_reveal(&election_id, &2u32, &wrong_salt, &commitment3);
    assert_eq!(result, Err(Ok(Error::WrongSalt)));

    client.reveal(&election_id, &2u32, &salt2, &commitment3);
    assert_eq!(client.result(&election_id).non_reveal_count, 0);
    assert_eq!(client.result(&election_id).tally.get(2).unwrap(), 1);
}

// ── Tally overflow safety ──

#[test]
fn test_tally_bucket_overflow_safety() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    let key = DataKey::tally_bucket_key(&election_id, 0, 0);
    env.as_contract(&contract_id, || {
        env.storage().persistent().set(&key, &(u64::MAX - 1u64));
    });

    env.as_contract(&contract_id, || {
        Storage::increment_tally(&env, &election_id, 0, 0).unwrap();
    });

    let tally = client.get_tally_bucket(&election_id, &0u32, &0u32);
    assert_eq!(tally, u64::MAX);

    // Checked arithmetic: overflow returns TallyOverflow instead of saturating
    env.as_contract(&contract_id, || {
        let result = Storage::increment_tally(&env, &election_id, 0, 0);
        assert_eq!(result, Err(Error::TallyOverflow));
    });
}

// ── Nullifier key exactness ──

#[test]
fn test_nullifier_key_per_election() {
    let env = Env::default();
    let eid1 = BytesN::from_array(&env, &[1u8; 32]);
    let eid2 = BytesN::from_array(&env, &[2u8; 32]);
    let nh = BytesN::from_array(&env, &[0xAAu8; 32]);

    let (contract_id, _) = setup_contract(&env);

    env.as_contract(&contract_id, || {
        Storage::mark_nullifier(&env, &eid1, &nh);
    });

    env.as_contract(&contract_id, || {
        assert!(Storage::is_nullifier_used(&env, &eid1, &nh));
        assert!(!Storage::is_nullifier_used(&env, &eid2, &nh));
    });
}

// ── R0 lifecycle with storage ──

#[test]
fn test_r0_lifecycle_with_storage() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    env.as_contract(&contract_id, || {
        let nh1 = nullifier_hash(&env, 0x01);
        let nh2 = nullifier_hash(&env, 0x02);
        let nh3 = nullifier_hash(&env, 0x03);

        Storage::mark_nullifier(&env, &election_id, &nh1);
        Storage::increment_tally(&env, &election_id, 0, tally_bucket_from_nullifier(&nh1)).unwrap();

        Storage::mark_nullifier(&env, &election_id, &nh2);
        Storage::increment_tally(&env, &election_id, 1, tally_bucket_from_nullifier(&nh2)).unwrap();

        Storage::mark_nullifier(&env, &election_id, &nh3);
        Storage::increment_tally(&env, &election_id, 0, tally_bucket_from_nullifier(&nh3)).unwrap();
    });

    let summary = client.result(&election_id);
    assert_eq!(summary.tally.get(0).unwrap(), 2);
    assert_eq!(summary.tally.get(1).unwrap(), 1);
    assert_eq!(summary.tally.get(2).unwrap(), 0);
}

// ── MAX_OPTIONS boundary ──

#[test]
fn test_open_election_max_options() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let now = env.ledger().timestamp();
    env.mock_all_auths();

    let result = client.try_open_election(
        &admin,
        &BytesN::from_array(&env, &[1u8; 32]),
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &MAX_OPTIONS,
        &(now + 1),
        &(now + 1000),
        &0u64,
    );
    assert!(result.is_ok());

    let result = client.try_open_election(
        &admin,
        &BytesN::from_array(&env, &[2u8; 32]),
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &(MAX_OPTIONS + 1),
        &(now + 1),
        &(now + 1000),
        &0u64,
    );
    assert_eq!(result, Err(Ok(Error::InvalidOptionCount)));
}

// ── Unlinkability ──

#[test]
fn test_nullifier_unlinkability_across_elections() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let now = env.ledger().timestamp();
    let eid1 = BytesN::from_array(&env, &[1u8; 32]);
    let eid2 = BytesN::from_array(&env, &[2u8; 32]);

    env.mock_all_auths();
    client.open_election(
        &admin,
        &eid1,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3,
        &now,
        &(now + 1000),
        &0,
    );
    env.mock_all_auths();
    client.open_election(
        &admin,
        &eid2,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3,
        &now,
        &(now + 1000),
        &0,
    );

    let nh = nullifier_hash(&env, 0x42);
    env.as_contract(&contract_id, || {
        Storage::mark_nullifier(&env, &eid1, &nh);
    });

    assert!(client.is_nullifier_used(&eid1, &nh));
    assert!(!client.is_nullifier_used(&eid2, &nh));
}

// ── R1 cast root mismatch ──

#[test]
fn test_cast_r1_root_mismatch() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R1,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &(now + 2000),
    );

    let proof_bytes = make_empty_proof_bytes(&env);
    let pub_sigs = make_r1_pub_signals_bytes(
        &env,
        &[0u8; 32],
        &[0x0Cu8; 32],
        3,
        &[3u8; 32],
        &[0x22u8; 32],
        &[2u8; 32],
    );

    let result = client.try_cast(&election_id, &proof_bytes, &pub_sigs);
    assert_eq!(result, Err(Ok(Error::RootMismatch)));
}

// ── ElectionStatus dynamic computation ──

#[test]
fn test_election_status_dynamic() {
    let env = Env::default();
    let config = ElectionConfig {
        election_scope: BytesN::from_array(&env, &[1u8; 32]),
        mode: ElectionMode::R0,
        state_root: BytesN::from_array(&env, &[2u8; 32]),
        association_root: BytesN::from_array(&env, &[3u8; 32]),
        option_count: 3,
        opens_at: 100,
        closes_at: 200,
        reveal_closes_at: 300,
    };

    assert_eq!(config.compute_status(50), ElectionStatus::Pending);
    assert_eq!(config.compute_status(150), ElectionStatus::Open);
    assert_eq!(config.compute_status(250), ElectionStatus::Closed);

    let config_r1 = ElectionConfig {
        election_scope: BytesN::from_array(&env, &[1u8; 32]),
        mode: ElectionMode::R1,
        state_root: BytesN::from_array(&env, &[2u8; 32]),
        association_root: BytesN::from_array(&env, &[3u8; 32]),
        option_count: 3,
        opens_at: 100,
        closes_at: 200,
        reveal_closes_at: 300,
    };

    assert_eq!(config_r1.compute_status(50), ElectionStatus::Pending);
    assert_eq!(config_r1.compute_status(150), ElectionStatus::Open);
    assert_eq!(config_r1.compute_status(250), ElectionStatus::RevealOpen);
    assert_eq!(config_r1.compute_status(350), ElectionStatus::RevealClosed);
}

// ── Zero salt rejection ──

#[test]
fn test_recompute_ballot_commitment_zero_salt() {
    let env = Env::default();
    let zero_salt = BytesN::from_array(&env, &[0u8; 32]);
    let scope = example_scope(&env);

    let result = recompute_ballot_commitment(&env, 0, &zero_salt, &scope);
    assert_eq!(result, Err(Error::ZeroSaltNotAllowed));
}

// ── VK hash mismatch ──

#[test]
fn test_vk_hash_mismatch_rejected() {
    let env = Env::default();
    let verifier_id = env.register(crate::verifier_client::WASM, ());

    let admin = Address::generate(&env);
    let vk_r0 = make_dummy_vk_bytes(&env);
    let vk_r1 = make_dummy_vk_bytes(&env);
    let correct_hash = sha256_bytes(&env, &vk_r0);
    let wrong_hash = BytesN::from_array(&env, &[0xBAu8; 32]);

    let contract_id = env.register(
        ZkQuorumContract,
        (
            admin.clone(),
            verifier_id.clone(),
            vk_r0.clone(),
            vk_r1.clone(),
            wrong_hash.clone(), // Wrong hash for R0 VK
            correct_hash.clone(),
        ),
    );
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let now = env.ledger().timestamp();
    env.mock_all_auths();
    client.open_election(
        &admin,
        &BytesN::from_array(&env, &[1u8; 32]),
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    let proof_bytes = make_empty_proof_bytes(&env);
    let pub_sigs =
        make_r0_pub_signals_bytes(&env, &[0u8; 32], 0, 3, &[3u8; 32], &[4u8; 32], &[2u8; 32]);

    // VK hash mismatch should be caught before verifier call
    let result = client.try_cast(
        &BytesN::from_array(&env, &[1u8; 32]),
        &proof_bytes,
        &pub_sigs,
    );
    assert_eq!(result, Err(Ok(Error::VkHashMismatch)));
}

// ── Cross-contract positive c=33 proof test ──

#[test]
fn test_cast_r0_with_c33_verifier() {
    let env = Env::default();
    // Register verifier contract first
    let verifier_id = env.register(crate::verifier_client::WASM, ());

    let admin = Address::generate(&env);
    // Extend the c=33 VK from IC len 2 to IC len 7 so it matches the R0
    // public signal schema (6 public signals). The five appended G1 identity
    // points contribute zero to vk_x, so the original c=33 proof remains valid
    // as long as the five extra public signals are zero.
    let vk = make_vk_bytes_c33_extended(&env);
    let vk_hash = sha256_bytes(&env, &vk);

    let contract_id = env.register(
        ZkQuorumContract,
        (
            admin.clone(),
            verifier_id.clone(),
            vk.clone(),
            vk.clone(),
            vk_hash.clone(),
            vk_hash.clone(),
        ),
    );
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    env.ledger().set_timestamp(1000);
    let opens_at = 1000;
    let closes_at = 5000;

    env.mock_all_auths();
    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let scope = example_scope(&env);
    let state_root = example_state_root(&env);
    let association_root = example_association_root(&env);
    client.open_election(
        &admin,
        &election_id,
        &scope,
        &ElectionMode::R0,
        &state_root,
        &association_root,
        &3u32,
        &opens_at,
        &closes_at,
        &0u64,
    );

    // nullifier_hash = 33 encoded as a canonical 32-byte big-endian scalar.
    let mut nullifier_arr = [0u8; 32];
    nullifier_arr[31] = 33;
    let nullifier_hash = BytesN::from_array(&env, &nullifier_arr);
    let bucket = tally_bucket_from_nullifier(&nullifier_hash);

    let state_root_arr = state_root.to_array();
    let association_root_arr = association_root.to_array();
    let scope_arr = scope.to_array();
    let pub_sigs = make_r0_pub_signals_bytes(
        &env,
        &nullifier_arr,
        0,
        3,
        &state_root_arr,
        &association_root_arr,
        &scope_arr,
    );
    let proof_bytes = make_proof_bytes_c33(&env);

    let result = client.try_cast(&election_id, &proof_bytes, &pub_sigs);
    assert_eq!(result, Ok(Ok(())));

    // Check events before any other host invocation (env.events().all()
    // only reports events from the most recent invocation).
    let all_events = env.events().all();
    assert_eq!(all_events.events().len(), 1);

    // Nullifier is marked and tally is updated.
    assert!(client.is_nullifier_used(&election_id, &nullifier_hash));
    assert_eq!(client.get_tally_bucket(&election_id, &0u32, &bucket), 1);
}

// ── R1 first-commit regression (extends c=33 proof) ──

#[test]
fn test_commit_r1_first_with_c33_verifier() {
    let env = Env::default();
    let verifier_id = env.register(crate::verifier_client::WASM, ());

    let admin = Address::generate(&env);
    let vk = make_vk_bytes_c33_extended(&env);
    let vk_hash = sha256_bytes(&env, &vk);

    let contract_id = env.register(
        ZkQuorumContract,
        (
            admin.clone(),
            verifier_id.clone(),
            vk.clone(),
            vk.clone(),
            vk_hash.clone(),
            vk_hash.clone(),
        ),
    );
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    env.ledger().set_timestamp(1000);
    let opens_at = 1000;
    let closes_at = 5000;
    let reveal_closes_at = 10000;

    env.mock_all_auths();
    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let scope = example_scope(&env);
    let state_root = example_state_root(&env);
    let association_root = example_association_root(&env);
    client.open_election(
        &admin,
        &election_id,
        &scope,
        &ElectionMode::R1,
        &state_root,
        &association_root,
        &3u32,
        &opens_at,
        &closes_at,
        &reveal_closes_at,
    );

    // nullifier_hash = 33 (matches c=33 proof's single public input)
    let mut nullifier_arr = [0u8; 32];
    nullifier_arr[31] = 33;
    let nullifier_hash = BytesN::from_array(&env, &nullifier_arr);

    // ballot_commitment = 1 (non-zero; its IC point is G1 identity so
    // any value is fine for the pairing check to pass)
    let mut commitment_arr = [0u8; 32];
    commitment_arr[31] = 1;

    let state_root_arr = state_root.to_array();
    let association_root_arr = association_root.to_array();
    let scope_arr = scope.to_array();
    let pub_sigs = make_r1_pub_signals_bytes(
        &env,
        &nullifier_arr,
        &commitment_arr,
        3,
        &state_root_arr,
        &association_root_arr,
        &scope_arr,
    );
    let proof_bytes = make_proof_bytes_c33(&env);

    let result = client.try_cast(&election_id, &proof_bytes, &pub_sigs);
    assert_eq!(result, Ok(Ok(())));

    // Check events before any other host invocation.
    let all_events = env.events().all();
    assert_eq!(all_events.events().len(), 1);

    // Nullifier is marked.
    assert!(client.is_nullifier_used(&election_id, &nullifier_hash));

    // Commit count = 1, reveal count still zero.
    let summary = client.result(&election_id);
    assert_eq!(summary.commit_count, 1);
    assert_eq!(summary.reveal_count, 0);
    assert_eq!(summary.non_reveal_count, 1);
}

// ── Zero electionScope rejection ──

#[test]
fn test_open_election_zero_scope() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let now = env.ledger().timestamp();
    let zero_scope = BytesN::from_array(&env, &[0u8; 32]);

    env.mock_all_auths();
    let result = client.try_open_election(
        &admin,
        &BytesN::from_array(&env, &[1u8; 32]),
        &zero_scope,
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &(now + 1),
        &(now + 1000),
        &0u64,
    );
    assert_eq!(result, Err(Ok(Error::InvalidElectionScope)));
}

#[test]
fn test_open_election_zero_state_root() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let now = env.ledger().timestamp();
    let zero_root = BytesN::from_array(&env, &[0u8; 32]);

    env.mock_all_auths();
    let result = client.try_open_election(
        &admin,
        &BytesN::from_array(&env, &[1u8; 32]),
        &example_scope(&env),
        &ElectionMode::R0,
        &zero_root,
        &example_association_root(&env),
        &3u32,
        &(now + 1),
        &(now + 1000),
        &0u64,
    );
    assert_eq!(result, Err(Ok(Error::InvalidStateRoot)));
}

#[test]
fn test_open_election_zero_association_root() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let now = env.ledger().timestamp();
    let zero_root = BytesN::from_array(&env, &[0u8; 32]);

    env.mock_all_auths();
    let result = client.try_open_election(
        &admin,
        &BytesN::from_array(&env, &[1u8; 32]),
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &zero_root,
        &3u32,
        &(now + 1),
        &(now + 1000),
        &0u64,
    );
    assert_eq!(result, Err(Ok(Error::InvalidAssociationRoot)));
}

// ── Non-canonical electionScope rejection ──

#[test]
fn test_open_election_non_canonical_scope_equal_modulus() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let now = env.ledger().timestamp();
    let modulus_scope = BytesN::from_array(&env, &BLS12_381_FR_MODULUS);

    env.mock_all_auths();
    let result = client.try_open_election(
        &admin,
        &BytesN::from_array(&env, &[1u8; 32]),
        &modulus_scope,
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &(now + 1),
        &(now + 1000),
        &0u64,
    );
    assert_eq!(result, Err(Ok(Error::InvalidElectionScope)));
}

// ── Salt >= r rejection in recompute_ballot_commitment ──

#[test]
fn test_recompute_ballot_commitment_salt_equal_modulus() {
    let env = Env::default();
    let salt = BytesN::from_array(&env, &BLS12_381_FR_MODULUS);
    let scope = example_scope(&env);

    let result = recompute_ballot_commitment(&env, 0, &salt, &scope);
    assert_eq!(result, Err(Error::CannotRecomputeCommitment));
}

#[test]
fn test_recompute_ballot_commitment_scope_equal_modulus() {
    let env = Env::default();
    let mut salt_arr = [0u8; 32];
    salt_arr[31] = 0x01;
    let salt = BytesN::from_array(&env, &salt_arr);
    let scope = BytesN::from_array(&env, &BLS12_381_FR_MODULUS);

    let result = recompute_ballot_commitment(&env, 0, &salt, &scope);
    assert_eq!(result, Err(Error::CannotRecomputeCommitment));
}

// ── Overflow negative tests ──

#[test]
fn test_commit_count_overflow() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R1,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &(now + 2000),
    );

    let key = DataKey::commit_count_key(&election_id);
    env.as_contract(&contract_id, || {
        env.storage().persistent().set(&key, &u32::MAX);
    });

    env.as_contract(&contract_id, || {
        let result = Storage::increment_commit_count(&env, &election_id);
        assert_eq!(result, Err(Error::CounterOverflow));
    });
}

#[test]
fn test_reveal_count_overflow() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R1,
        &example_state_root(&env),
        &example_association_root(&env),
        &3u32,
        &now,
        &(now + 1000),
        &(now + 2000),
    );

    let key = DataKey::reveal_count_key(&election_id);
    env.as_contract(&contract_id, || {
        env.storage().persistent().set(&key, &u32::MAX);
    });

    env.as_contract(&contract_id, || {
        let result = Storage::increment_reveal_count(&env, &election_id);
        assert_eq!(result, Err(Error::CounterOverflow));
    });
}

#[test]
fn test_sum_tally_overflow() {
    let env = Env::default();
    let (contract_id, admin) = setup_contract(&env);
    let client = ZkQuorumContractClient::new(&env, &contract_id);

    let election_id = BytesN::from_array(&env, &[1u8; 32]);
    let now = env.ledger().timestamp();

    env.mock_all_auths();
    client.open_election(
        &admin,
        &election_id,
        &example_scope(&env),
        &ElectionMode::R0,
        &example_state_root(&env),
        &example_association_root(&env),
        &1u32,
        &now,
        &(now + 1000),
        &0u64,
    );

    // Fill bucket 0 with u64::MAX and bucket 1 with 1
    env.as_contract(&contract_id, || {
        let key0 = DataKey::tally_bucket_key(&election_id, 0, 0);
        env.storage().persistent().set(&key0, &u64::MAX);
        let key1 = DataKey::tally_bucket_key(&election_id, 0, 1);
        env.storage().persistent().set(&key1, &1u64);
    });

    env.as_contract(&contract_id, || {
        let result = Storage::sum_tally(&env, &election_id, 1);
        assert_eq!(result, Err(Error::TallyOverflow));
    });
}
