//! circom2soroban — Convert snarkjs Groth16 BLS12-381 JSON artifacts
//! to Soroban canonical bytes using arkworks for validation and serialization.
//!
//! Byte formats (matching crates/zk):
//!   VK:   alpha G1(96) | beta G2(192) | gamma G2(192) | delta G2(192)
//!         | ic_len u32 BE | IC[i] G1(96)
//!   Proof: A G1(96) | B G2(192) | C G1(96)
//!   Public: len u32 BE | Fr[i] 32-byte BE

use ark_bls12_381::{Fq, Fq2, Fr, G1Affine, G2Affine};
use ark_ff::{BigInteger, PrimeField};
use ark_serialize::CanonicalSerialize;
use num_bigint::BigUint;
use serde::Deserialize;
use std::str::FromStr;

pub const G1_SERIALIZED_SIZE: usize = 96;
pub const G2_SERIALIZED_SIZE: usize = 192;
pub const FR_SERIALIZED_SIZE: usize = 32;

/// Common error type.
#[derive(Debug)]
pub enum Error {
    Io(std::io::Error),
    Json(serde_json::Error),
    Msg(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Io(e) => write!(f, "IO: {}", e),
            Error::Json(e) => write!(f, "JSON: {}", e),
            Error::Msg(s) => write!(f, "{}", s),
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}
impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Json(e)
    }
}
impl From<String> for Error {
    fn from(s: String) -> Self {
        Error::Msg(s)
    }
}

// ── JSON types with deny_unknown_fields ──

type G1Json = [String; 3];
type G2Json = [[String; 2]; 3];

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct VkJson {
    pub protocol: String,
    pub curve: String,
    #[serde(rename = "nPublic")]
    pub n_public: u32,
    pub vk_alpha_1: G1Json,
    pub vk_beta_2: G2Json,
    pub vk_gamma_2: G2Json,
    pub vk_delta_2: G2Json,
    #[serde(rename = "IC")]
    pub ic: Vec<G1Json>,
    #[serde(rename = "vk_alphabeta_12")]
    pub vk_alphabeta_12: serde_json::Value,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct ProofJson {
    pub protocol: String,
    pub curve: String,
    pub pi_a: G1Json,
    pub pi_b: G2Json,
    pub pi_c: G1Json,
}

pub type PublicJson = Vec<String>;

// ── Field element validation ──

lazy_static::lazy_static! {
    static ref FQ_MODULUS: BigUint = BigUint::from_str(
        "4002409555221667393417789825735904156556882819939007885332058136124031650490837864442687629129015664037894272559787"
    ).unwrap();
    static ref FR_MODULUS: BigUint = BigUint::from_str(
        "52435875175126190479447740508185965837690552500527637822603658699938581184513"
    ).unwrap();
}

/// Parse a decimal string to BigUint, rejecting leading zeros and non-canonical forms.
fn parse_decimal(s: &str) -> Result<BigUint, Error> {
    if s.is_empty() {
        return Err(Error::Msg("Empty decimal string".into()));
    }
    // Reject leading zeros except for "0" itself
    if s.len() > 1 && s.starts_with('0') {
        return Err(Error::Msg(format!("Leading zeros not allowed: {}", s)));
    }
    // Reject sign characters
    if s.starts_with('-') || s.starts_with('+') {
        return Err(Error::Msg(format!("Signs not allowed: {}", s)));
    }
    // Must be only digits 0-9
    if !s.chars().all(|c| c.is_ascii_digit()) {
        return Err(Error::Msg(format!("Non-digit character in: {}", s)));
    }
    BigUint::parse_bytes(s.as_bytes(), 10)
        .ok_or_else(|| Error::Msg(format!("Invalid decimal: {}", s)))
}

/// Parse Fq from decimal string, rejecting values >= Fq modulus.
fn parse_fq_strict(s: &str) -> Result<Fq, Error> {
    let val = parse_decimal(s)?;
    if val >= *FQ_MODULUS {
        return Err(Error::Msg(format!("Fq value >= modulus: {}", s)));
    }
    Ok(biguint_to_fq(&val))
}

/// Parse Fr from decimal string, rejecting values >= Fr modulus.
fn parse_fr_strict(s: &str) -> Result<Fr, Error> {
    let val = parse_decimal(s)?;
    if val >= *FR_MODULUS {
        return Err(Error::Msg(format!("Fr value >= modulus: {}", s)));
    }
    Ok(biguint_to_fr(&val))
}

/// Convert BigUint to arkworks Fq (assumes value < modulus).
fn biguint_to_fq(val: &BigUint) -> Fq {
    let be = val.to_bytes_be();
    Fq::from_be_bytes_mod_order(&be)
}

/// Convert BigUint to arkworks Fr (assumes value < modulus).
fn biguint_to_fr(val: &BigUint) -> Fr {
    let be = val.to_bytes_be();
    Fr::from_be_bytes_mod_order(&be)
}

// ── G1/G2 validation ──

fn parse_validate_g1(g1_json: &G1Json, label: &str) -> Result<G1Affine, Error> {
    let flag = &g1_json[2];
    if flag != "1" {
        return Err(Error::Msg(format!(
            "{}: flag must be '1' (affine), got '{}'",
            label, flag
        )));
    }
    let x = parse_fq_strict(&g1_json[0])?;
    let y = parse_fq_strict(&g1_json[1])?;

    let pt = G1Affine::new_unchecked(x, y);
    if !pt.is_on_curve() {
        return Err(Error::Msg(format!("{}: point not on G1 curve", label)));
    }
    if !pt.is_in_correct_subgroup_assuming_on_curve() {
        return Err(Error::Msg(format!("{}: point not in G1 subgroup", label)));
    }
    Ok(pt)
}

fn parse_validate_g2(g2_json: &G2Json, label: &str) -> Result<G2Affine, Error> {
    let c0 = &g2_json[2][0];
    let c1 = &g2_json[2][1];
    if c0 != "1" || c1 != "0" {
        return Err(Error::Msg(format!(
            "{}: flag must be ['1','0'] (affine), got ['{}','{}']",
            label, c0, c1
        )));
    }
    let x0 = parse_fq_strict(&g2_json[0][0])?;
    let x1 = parse_fq_strict(&g2_json[0][1])?;
    let y0 = parse_fq_strict(&g2_json[1][0])?;
    let y1 = parse_fq_strict(&g2_json[1][1])?;

    let x = Fq2::new(x0, x1);
    let y = Fq2::new(y0, y1);
    let pt = G2Affine::new_unchecked(x, y);

    if !pt.is_on_curve() {
        return Err(Error::Msg(format!("{}: point not on G2 curve", label)));
    }
    if !pt.is_in_correct_subgroup_assuming_on_curve() {
        return Err(Error::Msg(format!("{}: point not in G2 subgroup", label)));
    }
    Ok(pt)
}

fn serialize_g1(pt: &G1Affine) -> Result<Vec<u8>, Error> {
    let mut buf = vec![0u8; G1_SERIALIZED_SIZE];
    pt.serialize_uncompressed(&mut buf[..])
        .map_err(|e| Error::Msg(format!("G1 serialize: {}", e)))?;
    Ok(buf)
}

fn serialize_g2(pt: &G2Affine) -> Result<Vec<u8>, Error> {
    let mut buf = vec![0u8; G2_SERIALIZED_SIZE];
    pt.serialize_uncompressed(&mut buf[..])
        .map_err(|e| Error::Msg(format!("G2 serialize: {}", e)))?;
    Ok(buf)
}

fn serialize_fr(fr: &Fr) -> [u8; 32] {
    let bigint: ark_ff::BigInt<4> = (*fr).into();
    let be = bigint.to_bytes_be();
    let mut arr = [0u8; 32];
    let copy_len = be.len().min(32);
    arr[32 - copy_len..].copy_from_slice(&be[..copy_len]);
    arr
}

// ── Public API ──

pub fn convert_vk(vk: &VkJson) -> Result<Vec<u8>, Error> {
    if vk.protocol != "groth16" {
        return Err(Error::Msg(format!("Unsupported protocol: {}", vk.protocol)));
    }
    if vk.curve != "bls12381" {
        return Err(Error::Msg(format!("Unsupported curve: {}", vk.curve)));
    }
    if vk.n_public != 6 {
        return Err(Error::Msg(format!(
            "nPublic must be 6, got {}",
            vk.n_public
        )));
    }
    if vk.ic.len() != 7 {
        return Err(Error::Msg(format!(
            "IC length must be 7, got {}",
            vk.ic.len()
        )));
    }

    let alpha = parse_validate_g1(&vk.vk_alpha_1, "vk_alpha_1")?;
    let beta = parse_validate_g2(&vk.vk_beta_2, "vk_beta_2")?;
    let gamma = parse_validate_g2(&vk.vk_gamma_2, "vk_gamma_2")?;
    let delta = parse_validate_g2(&vk.vk_delta_2, "vk_delta_2")?;

    let mut out = Vec::with_capacity(96 + 3 * 192 + 4 + 7 * 96);
    out.extend_from_slice(&serialize_g1(&alpha)?);
    out.extend_from_slice(&serialize_g2(&beta)?);
    out.extend_from_slice(&serialize_g2(&gamma)?);
    out.extend_from_slice(&serialize_g2(&delta)?);
    out.extend_from_slice(&(vk.ic.len() as u32).to_be_bytes());

    for (i, ic_pt) in vk.ic.iter().enumerate() {
        let g1 = parse_validate_g1(ic_pt, &format!("IC[{}]", i))?;
        out.extend_from_slice(&serialize_g1(&g1)?);
    }
    Ok(out)
}

pub fn convert_proof(proof: &ProofJson) -> Result<Vec<u8>, Error> {
    if proof.protocol != "groth16" {
        return Err(Error::Msg(format!(
            "Unsupported protocol: {}",
            proof.protocol
        )));
    }
    if proof.curve != "bls12381" {
        return Err(Error::Msg(format!("Unsupported curve: {}", proof.curve)));
    }

    let a = parse_validate_g1(&proof.pi_a, "pi_a")?;
    let b = parse_validate_g2(&proof.pi_b, "pi_b")?;
    let c = parse_validate_g1(&proof.pi_c, "pi_c")?;

    let mut out = Vec::with_capacity(96 + 192 + 96);
    out.extend_from_slice(&serialize_g1(&a)?);
    out.extend_from_slice(&serialize_g2(&b)?);
    out.extend_from_slice(&serialize_g1(&c)?);
    Ok(out)
}

pub fn convert_public_signals(signals: &PublicJson) -> Result<Vec<u8>, Error> {
    if signals.len() != 6 {
        return Err(Error::Msg(format!(
            "Public signals must have exactly 6 elements (R0), got {}",
            signals.len()
        )));
    }

    let mut out = Vec::with_capacity(4 + 6 * 32);
    out.extend_from_slice(&(signals.len() as u32).to_be_bytes());

    for s in signals.iter() {
        let fr = parse_fr_strict(s)?;
        out.extend_from_slice(&serialize_fr(&fr));
    }
    Ok(out)
}
