#![cfg(test)]
extern crate std;

use ark_bls12_381::{Fq, Fq2};
use ark_serialize::CanonicalSerialize;
use core::str::FromStr;
use soroban_sdk::{
    crypto::bls12_381::{Fr, G1Affine, G2Affine, G1_SERIALIZED_SIZE, G2_SERIALIZED_SIZE},
    Bytes, Env, Vec, U256,
};
use zk::{Proof, PublicSignals, VerificationKey};

use crate::{Groth16VerifierContract, Groth16VerifierContractClient};

fn g1_from_coords(env: &Env, x: &str, y: &str) -> G1Affine {
    let ark_g1 = ark_bls12_381::G1Affine::new(Fq::from_str(x).unwrap(), Fq::from_str(y).unwrap());
    let mut buf = [0u8; G1_SERIALIZED_SIZE];
    ark_g1.serialize_uncompressed(&mut buf[..]).unwrap();
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

/// The canonical a*b=c fixture where a=3, b=11, c=33, only c is public.
/// VK has IC length 2 (ic[0] + ic[1] * c).
fn make_vk_bytes(env: &Env) -> Bytes {
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

fn make_proof_bytes(env: &Env) -> Bytes {
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

fn make_public_signals_bytes(env: &Env, value: u32) -> Bytes {
    let signals = PublicSignals {
        pub_signals: Vec::from_array(env, [Fr::from_u256(U256::from_u32(env, value))]),
    };
    signals.to_bytes(env)
}

#[test]
fn test_verify_proof_c33() {
    let env = Env::default();
    let contract_id = env.register(Groth16VerifierContract, ());
    let client = Groth16VerifierContractClient::new(&env, &contract_id);

    let vk_bytes = make_vk_bytes(&env);
    let proof_bytes = make_proof_bytes(&env);
    let signals_bytes = make_public_signals_bytes(&env, 33);

    let result = client.verify_proof(&vk_bytes, &proof_bytes, &signals_bytes);
    assert!(result);
}

#[test]
fn test_verify_proof_wrong_public() {
    let env = Env::default();
    let contract_id = env.register(Groth16VerifierContract, ());
    let client = Groth16VerifierContractClient::new(&env, &contract_id);

    let vk_bytes = make_vk_bytes(&env);
    let proof_bytes = make_proof_bytes(&env);
    let signals_bytes = make_public_signals_bytes(&env, 22);

    let result = client.verify_proof(&vk_bytes, &proof_bytes, &signals_bytes);
    assert!(!result);
}

#[test]
fn test_malformed_vk() {
    let env = Env::default();
    let contract_id = env.register(Groth16VerifierContract, ());
    let client = Groth16VerifierContractClient::new(&env, &contract_id);

    let vk_bytes = Bytes::from_array(&env, &[0u8; 10]);
    let proof_bytes = make_proof_bytes(&env);
    let signals_bytes = make_public_signals_bytes(&env, 33);

    let result = client.try_verify_proof(&vk_bytes, &proof_bytes, &signals_bytes);
    assert_eq!(result, Err(Ok(crate::VerifierError::MalformedVerifyingKey)));
}

#[test]
fn test_malformed_proof() {
    let env = Env::default();
    let contract_id = env.register(Groth16VerifierContract, ());
    let client = Groth16VerifierContractClient::new(&env, &contract_id);

    let vk_bytes = make_vk_bytes(&env);
    let proof_bytes = Bytes::from_array(&env, &[0u8; 10]);
    let signals_bytes = make_public_signals_bytes(&env, 33);

    let result = client.try_verify_proof(&vk_bytes, &proof_bytes, &signals_bytes);
    assert_eq!(result, Err(Ok(crate::VerifierError::MalformedProof)));
}

#[test]
fn test_ic_length_mismatch() {
    let env = Env::default();
    let contract_id = env.register(Groth16VerifierContract, ());
    let client = Groth16VerifierContractClient::new(&env, &contract_id);

    let vk_bytes = make_vk_bytes(&env);
    let proof_bytes = make_proof_bytes(&env);
    // 2 public signals, but VK has IC length 2 (needs 1)
    let signals = PublicSignals {
        pub_signals: Vec::from_array(
            &env,
            [
                Fr::from_u256(U256::from_u32(&env, 33)),
                Fr::from_u256(U256::from_u32(&env, 44)),
            ],
        ),
    };
    let signals_bytes = signals.to_bytes(&env);

    let result = client.try_verify_proof(&vk_bytes, &proof_bytes, &signals_bytes);
    assert_eq!(result, Err(Ok(crate::VerifierError::IcLengthMismatch)));
}
