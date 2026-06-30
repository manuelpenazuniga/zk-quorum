#![cfg(test)]

use crate::*;
use ark_bls12_381::Fq;
use ark_serialize::CanonicalSerialize;
use core::str::FromStr;
use soroban_sdk::crypto::bls12_381::{
    Fr, G1Affine as SdkG1Affine, G2Affine as SdkG2Affine, G1_SERIALIZED_SIZE,
};
use soroban_sdk::{Env, Vec, U256};

fn g1_from_coords(env: &Env, x: &str, y: &str) -> SdkG1Affine {
    let ark_g1 = ark_bls12_381::G1Affine::new(Fq::from_str(x).unwrap(), Fq::from_str(y).unwrap());
    let mut buf = [0u8; G1_SERIALIZED_SIZE];
    ark_g1.serialize_uncompressed(&mut buf[..]).unwrap();
    SdkG1Affine::from_array(env, &buf)
}

fn g2_from_coords(env: &Env, x1: &str, x2: &str, y1: &str, y2: &str) -> SdkG2Affine {
    use ark_bls12_381::Fq2;
    let x = Fq2::new(Fq::from_str(x1).unwrap(), Fq::from_str(x2).unwrap());
    let y = Fq2::new(Fq::from_str(y1).unwrap(), Fq::from_str(y2).unwrap());
    let ark_g2 = ark_bls12_381::G2Affine::new(x, y);
    let mut buf = [0u8; G2_SERIALIZED_SIZE];
    ark_g2.serialize_uncompressed(&mut buf[..]).unwrap();
    SdkG2Affine::from_array(env, &buf)
}

fn make_vk_bytes(env: &Env) -> soroban_sdk::Bytes {
    let ark_g2_x1 = "1659696755509039809248937927616726274238080235224171061036366585278216098417245587200210264410333778948851576160490";
    let ark_g2_x2 = "1338363397031837211155983756179787835339490797745307535810204658838394402900152502268197396587061400659003281046656";
    let ark_g2_y1 = "1974652615426136516341494326987376616840373177388374023461177997087381634383568759591087499459321812809521924259354";
    let ark_g2_y2 = "3301884318087924474550898163462840036865878131635519297186391370517333773367262804074867347346141727012544462046142";
    use ark_bls12_381::Fq2;
    fn g2(env: &Env, x1: &str, x2: &str, y1: &str, y2: &str) -> SdkG2Affine {
        let x = Fq2::new(Fq::from_str(x1).unwrap(), Fq::from_str(x2).unwrap());
        let y = Fq2::new(Fq::from_str(y1).unwrap(), Fq::from_str(y2).unwrap());
        let ark_g2 = ark_bls12_381::G2Affine::new(x, y);
        let mut buf = [0u8; G2_SERIALIZED_SIZE];
        ark_g2.serialize_uncompressed(&mut buf[..]).unwrap();
        SdkG2Affine::from_array(env, &buf)
    }
    let vk = VerificationKey {
        alpha: g1_from_coords(env,
            "851850525556173310373115880154698084608631105506432893865500290442025919078535925294035153152030470398262539759609",
            "2637289349983507610125993281171282870664683328789064436670091381805667870657250691837988574635646688089951719927247",
        ),
        beta: g2(env, ark_g2_x1, ark_g2_x2, ark_g2_y1, ark_g2_y2),
        gamma: g2(env,
            "352701069587466618187139116011060144890029952792775240219908644239793785735715026873347600343865175952761926303160",
            "3059144344244213709971259814753781636986470325476647558659373206291635324768958432433509563104347017837885763365758",
            "1985150602287291935568054521177171638300868978215655730859378665066344726373823718423869104263333984641494340347905",
            "927553665492332455747201965776037880757740193453592970025027978793976877002675564980949289727957565575433344219582",
        ),
        delta: g2(env,
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
        ]),
    };
    vk.to_bytes(env)
}

#[test]
fn test_vk_roundtrip() {
    let env = Env::default();
    let bytes = make_vk_bytes(&env);
    let vk = VerificationKey::from_bytes(&env, &bytes).unwrap();

    let bytes2 = vk.to_bytes(&env);
    assert_eq!(bytes, bytes2);
    assert_eq!(vk.ic.len(), 2);
}

#[test]
fn test_proof_roundtrip() {
    let env = Env::default();
    let proof = Proof {
        a: g1_from_coords(&env,
            "314442236668110257304682488877371582255161413673331360366570443799415414639292047869143313601702131653514009114222",
            "2384632327855835824635705027009217874826122107057894594162233214798350178691568018290025994699762298534539543934607",
        ),
        b: g2_from_coords(&env,
            "428844167033934720609657613212495751617651348480870890908850335525890280786532876634895457032623422366474694342656",
            "3083139526360252775789959298805261067575555607578161553873977966165446991459924053189383038704105379290158793353905",
            "1590919422794657666432683000821892403620510405626533455397042191265963587891653562867091397248216891852168698286910",
            "3617931039814164588401589536353142503544155307022467123698224064329647390280346725086550997337076315487486714327146",
        ),
        c: g1_from_coords(&env,
            "3052934797502613468327963344215392478880720823583493172692775426011388142569325036386650708808320216973179639719187",
            "2028185281516938724429867827057869371578022471499780916652824405212207527699373814371051328341613972789943854539597",
        ),
    };
    let bytes = proof.to_bytes(&env);
    let proof2 = Proof::from_bytes(&env, &bytes).unwrap();

    assert_eq!(proof.a, proof2.a);
    assert_eq!(proof.b, proof2.b);
    assert_eq!(proof.c, proof2.c);
}

#[test]
fn test_pub_signals_roundtrip() {
    let env = Env::default();
    let pub_signals = PublicSignals {
        pub_signals: Vec::from_array(&env, [Fr::from_u256(U256::from_u32(&env, 33))]),
    };
    let bytes = pub_signals.to_bytes(&env);
    let pub_signals2 = PublicSignals::from_bytes(&env, &bytes).unwrap();

    assert_eq!(
        pub_signals.pub_signals.len(),
        pub_signals2.pub_signals.len()
    );
    for i in 0..pub_signals.pub_signals.len() {
        let a = pub_signals.pub_signals.get(i).unwrap();
        let b = pub_signals2.pub_signals.get(i).unwrap();
        assert_eq!(a.to_u256(), b.to_u256());
    }
}

#[test]
fn test_malformed_vk_too_short() {
    let env = Env::default();
    let bytes = soroban_sdk::Bytes::from_array(&env, &[0u8; 10]);
    let result = VerificationKey::from_bytes(&env, &bytes);
    assert_eq!(result, Err(Groth16Error::MalformedVerifyingKey));
}

#[test]
fn test_malformed_proof_size() {
    let env = Env::default();
    let bytes = soroban_sdk::Bytes::from_array(&env, &[0u8; 10]);
    let result = Proof::from_bytes(&env, &bytes);
    assert_eq!(result, Err(Groth16Error::MalformedProof));
}

#[test]
fn test_malformed_pub_signals_too_short() {
    let env = Env::default();
    let bytes = soroban_sdk::Bytes::from_array(&env, &[0u8; 2]);
    let result = PublicSignals::from_bytes(&env, &bytes);
    assert_eq!(result, Err(Groth16Error::MalformedPublicSignals));
}

#[test]
fn test_pub_signals_size_mismatch() {
    let env = Env::default();
    let mut raw: [u8; 8] = [0u8; 8];
    raw[0..4].copy_from_slice(&2u32.to_be_bytes());
    let bytes = soroban_sdk::Bytes::from_array(&env, &raw);
    let result = PublicSignals::from_bytes(&env, &bytes);
    assert_eq!(result, Err(Groth16Error::MalformedPublicSignals));
}

#[test]
fn test_vk_first_and_get() {
    let env = Env::default();
    let bytes = make_vk_bytes(&env);
    let vk = VerificationKey::from_bytes(&env, &bytes).unwrap();

    assert!(vk.first().is_some());
    assert!(vk.get(0).is_some());
    assert!(vk.get(1).is_some());
    assert!(vk.get(2).is_none());
}

#[test]
fn test_vk_ic_len_zero_rejected() {
    let env = Env::default();
    // Build VK bytes with ic_len = 0
    let mut bytes = soroban_sdk::Bytes::new(&env);
    let zeros_g1 = [0u8; G1_SERIALIZED_SIZE];
    let zeros_g2 = [0u8; G2_SERIALIZED_SIZE];
    bytes.append(&Bytes::from_slice(&env, &zeros_g1)); // alpha
    bytes.append(&Bytes::from_slice(&env, &zeros_g2)); // beta
    bytes.append(&Bytes::from_slice(&env, &zeros_g2)); // gamma
    bytes.append(&Bytes::from_slice(&env, &zeros_g2)); // delta
    bytes.append(&Bytes::from_slice(&env, &0u32.to_be_bytes())); // ic_len = 0

    let result = VerificationKey::from_bytes(&env, &bytes);
    assert_eq!(result, Err(Groth16Error::MalformedVerifyingKey));
}

#[test]
fn test_pub_signals_non_canonical_equal_modulus() {
    let env = Env::default();
    // BLS12-381 Fr modulus as scalar => exactly r, must be rejected
    let modulus_bytes = BLS12_381_FR_MODULUS;
    // Build: 1 signal, 32 bytes = Fr modulus
    let mut raw: [u8; 36] = [0u8; 36];
    raw[0..4].copy_from_slice(&1u32.to_be_bytes());
    raw[4..36].copy_from_slice(&modulus_bytes);
    let bytes = soroban_sdk::Bytes::from_array(&env, &raw);
    let result = PublicSignals::from_bytes(&env, &bytes);
    assert_eq!(result, Err(Groth16Error::MalformedPublicSignals));
}

#[test]
fn test_pub_signals_non_canonical_greater_than_modulus() {
    let env = Env::default();
    // BLS12-381 Fr modulus + 1 as scalar => > r, must be rejected
    let mut big = BLS12_381_FR_MODULUS;
    // Add 1 in big-endian
    let mut carry = 1u8;
    for i in (0..32).rev() {
        let (v, overflow) = big[i].overflowing_add(carry);
        big[i] = v;
        carry = if overflow { 1 } else { 0 };
        if carry == 0 {
            break;
        }
    }
    let mut raw: [u8; 36] = [0u8; 36];
    raw[0..4].copy_from_slice(&1u32.to_be_bytes());
    raw[4..36].copy_from_slice(&big);
    let bytes = soroban_sdk::Bytes::from_array(&env, &raw);
    let result = PublicSignals::from_bytes(&env, &bytes);
    assert_eq!(result, Err(Groth16Error::MalformedPublicSignals));
}

#[test]
fn test_pub_signals_zero_allowed() {
    let env = Env::default();
    // Zero is allowed (0 < r)
    let mut raw: [u8; 36] = [0u8; 36];
    raw[0..4].copy_from_slice(&1u32.to_be_bytes());
    // Bytes [4..36] are already zero
    let bytes = soroban_sdk::Bytes::from_array(&env, &raw);
    let result = PublicSignals::from_bytes(&env, &bytes);
    assert!(result.is_ok());
    let signals = result.unwrap();
    assert_eq!(signals.pub_signals.len(), 1);
    assert_eq!(
        signals.pub_signals.get(0).unwrap().to_u256(),
        U256::from_u32(&env, 0)
    );
}

#[test]
fn test_pub_signals_max_canonical_allowed() {
    let env = Env::default();
    // r-1 is the maximum canonical value, must be accepted
    let mut max = BLS12_381_FR_MODULUS;
    // Subtract 1 in big-endian
    let mut borrow = 1u8;
    for i in (0..32).rev() {
        let (v, overflow) = max[i].overflowing_sub(borrow);
        max[i] = v;
        borrow = if overflow { 1 } else { 0 };
        if borrow == 0 {
            break;
        }
    }
    let mut raw: [u8; 36] = [0u8; 36];
    raw[0..4].copy_from_slice(&1u32.to_be_bytes());
    raw[4..36].copy_from_slice(&max);
    let bytes = soroban_sdk::Bytes::from_array(&env, &raw);
    let result = PublicSignals::from_bytes(&env, &bytes);
    assert!(result.is_ok());
}
