// MIT License
//
// Copyright (c) 2024
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// Adapted from stellar/soroban-examples privacy-pools/libs/zk.
// Upstream reference pinned at commit 7b168174ae1268dab91a0190d80a94ab7ff41b59.

#![no_std]

use soroban_sdk::{
    contracterror,
    crypto::bls12_381::{Fr, G1Affine, G2Affine, G1_SERIALIZED_SIZE, G2_SERIALIZED_SIZE},
    Bytes, Env, Vec, U256,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Groth16Error {
    MalformedVerifyingKey = 0,
    MalformedProof = 1,
    MalformedPublicSignals = 2,
}

#[derive(Clone, Debug, PartialEq)]
pub struct VerificationKey {
    pub alpha: G1Affine,
    pub beta: G2Affine,
    pub gamma: G2Affine,
    pub delta: G2Affine,
    pub ic: Vec<G1Affine>,
}

impl VerificationKey {
    pub fn to_bytes(&self, env: &Env) -> Bytes {
        let mut bytes = Bytes::new(env);
        bytes.append(&Bytes::from_slice(env, &self.alpha.to_bytes().to_array()));
        bytes.append(&Bytes::from_slice(env, &self.beta.to_bytes().to_array()));
        bytes.append(&Bytes::from_slice(env, &self.gamma.to_bytes().to_array()));
        bytes.append(&Bytes::from_slice(env, &self.delta.to_bytes().to_array()));
        let ic_len = self.ic.len();
        let ic_len_bytes = ic_len.to_be_bytes();
        bytes.append(&Bytes::from_slice(env, &ic_len_bytes));
        for g1 in self.ic.iter() {
            bytes.append(&Bytes::from_slice(env, &g1.to_bytes().to_array()));
        }
        bytes
    }

    pub fn from_bytes(env: &Env, bytes: &Bytes) -> Result<Self, Groth16Error> {
        let header_size: u32 = (G1_SERIALIZED_SIZE as u32)
            .checked_add((G2_SERIALIZED_SIZE * 3) as u32)
            .and_then(|v| v.checked_add(4))
            .ok_or(Groth16Error::MalformedVerifyingKey)?;
        if bytes.len() < header_size {
            return Err(Groth16Error::MalformedVerifyingKey);
        }
        let mut pos: u32 = 0;

        let alpha_bytes: [u8; G1_SERIALIZED_SIZE] =
            Self::take_array(bytes, &mut pos, G1_SERIALIZED_SIZE)?;
        let beta_bytes: [u8; G2_SERIALIZED_SIZE] =
            Self::take_array(bytes, &mut pos, G2_SERIALIZED_SIZE)?;
        let gamma_bytes: [u8; G2_SERIALIZED_SIZE] =
            Self::take_array(bytes, &mut pos, G2_SERIALIZED_SIZE)?;
        let delta_bytes: [u8; G2_SERIALIZED_SIZE] =
            Self::take_array(bytes, &mut pos, G2_SERIALIZED_SIZE)?;

        let ic_len_bytes: [u8; 4] = Self::take_array(bytes, &mut pos, 4)?;
        let ic_len_u32 = u32::from_be_bytes(ic_len_bytes);
        if ic_len_u32 == 0 {
            return Err(Groth16Error::MalformedVerifyingKey);
        }

        // Prevent overflow: cast to u64 for multiplication check
        let ic_len = ic_len_u32 as usize;
        let expected_ic: u64 = (ic_len_u32 as u64)
            .checked_mul(G1_SERIALIZED_SIZE as u64)
            .ok_or(Groth16Error::MalformedVerifyingKey)?;
        let remaining = bytes
            .len()
            .checked_sub(pos)
            .ok_or(Groth16Error::MalformedVerifyingKey)? as u64;
        if remaining != expected_ic {
            return Err(Groth16Error::MalformedVerifyingKey);
        }

        let alpha = G1Affine::from_array(env, &alpha_bytes);
        let beta = G2Affine::from_array(env, &beta_bytes);
        let gamma = G2Affine::from_array(env, &gamma_bytes);
        let delta = G2Affine::from_array(env, &delta_bytes);

        let mut ic = Vec::new(env);
        for _ in 0..ic_len {
            let g1_bytes: [u8; G1_SERIALIZED_SIZE] =
                Self::take_array(bytes, &mut pos, G1_SERIALIZED_SIZE)?;
            let g1 = G1Affine::from_array(env, &g1_bytes);
            ic.push_back(g1);
        }

        Ok(VerificationKey {
            alpha,
            beta,
            gamma,
            delta,
            ic,
        })
    }

    /// Return the first IC element, or None if IC is empty.
    pub fn first(&self) -> Option<G1Affine> {
        self.ic.first()
    }

    /// Return the IC element at `index`, or None.
    pub fn get(&self, index: u32) -> Option<G1Affine> {
        self.ic.get(index)
    }

    fn take_array<const N: usize>(
        bytes: &Bytes,
        pos: &mut u32,
        size: usize,
    ) -> Result<[u8; N], Groth16Error> {
        if N != size {
            return Err(Groth16Error::MalformedVerifyingKey);
        }
        let start = *pos;
        let end = start
            .checked_add(size as u32)
            .ok_or(Groth16Error::MalformedVerifyingKey)?;
        if end > bytes.len() {
            return Err(Groth16Error::MalformedVerifyingKey);
        }
        let mut arr = [0u8; N];
        bytes.slice(start..end).copy_into_slice(&mut arr);
        *pos = end;
        Ok(arr)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Proof {
    pub a: G1Affine,
    pub b: G2Affine,
    pub c: G1Affine,
}

impl Proof {
    pub fn to_bytes(&self, env: &Env) -> Bytes {
        let mut bytes = Bytes::new(env);
        bytes.append(&Bytes::from_slice(env, &self.a.to_bytes().to_array()));
        bytes.append(&Bytes::from_slice(env, &self.b.to_bytes().to_array()));
        bytes.append(&Bytes::from_slice(env, &self.c.to_bytes().to_array()));
        bytes
    }

    pub fn from_bytes(env: &Env, bytes: &Bytes) -> Result<Self, Groth16Error> {
        let expected: u32 = (G1_SERIALIZED_SIZE as u32)
            .checked_add(G2_SERIALIZED_SIZE as u32)
            .and_then(|v| v.checked_add(G1_SERIALIZED_SIZE as u32))
            .ok_or(Groth16Error::MalformedProof)?;
        if bytes.len() != expected {
            return Err(Groth16Error::MalformedProof);
        }
        let mut pos: u32 = 0;

        fn take_array<const N: usize>(
            bytes: &Bytes,
            pos: &mut u32,
        ) -> Result<[u8; N], Groth16Error> {
            let start = *pos;
            let end = start
                .checked_add(N as u32)
                .ok_or(Groth16Error::MalformedProof)?;
            if end > bytes.len() {
                return Err(Groth16Error::MalformedProof);
            }
            let mut arr = [0u8; N];
            bytes.slice(start..end).copy_into_slice(&mut arr);
            *pos = end;
            Ok(arr)
        }

        let a = G1Affine::from_array(env, &take_array::<G1_SERIALIZED_SIZE>(bytes, &mut pos)?);
        let b = G2Affine::from_array(env, &take_array::<G2_SERIALIZED_SIZE>(bytes, &mut pos)?);
        let c = G1Affine::from_array(env, &take_array::<G1_SERIALIZED_SIZE>(bytes, &mut pos)?);
        Ok(Proof { a, b, c })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PublicSignals {
    pub pub_signals: Vec<Fr>,
}

/// BLS12-381 scalar field modulus r.
/// 52435875175126190479447740508185965837690552500527637822603658699938581184513
pub const BLS12_381_FR_MODULUS: [u8; 32] = [
    0x73, 0xed, 0xa7, 0x53, 0x29, 0x9d, 0x7d, 0x48, 0x33, 0x39, 0xd8, 0x08, 0x09, 0xa1, 0xd8, 0x05,
    0x53, 0xbd, 0xa4, 0x02, 0xff, 0xfe, 0x5b, 0xfe, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01,
];

impl PublicSignals {
    pub const FR_SIZE: usize = 32;

    pub fn to_bytes(&self, env: &Env) -> Bytes {
        let mut bytes = Bytes::new(env);
        let len = self.pub_signals.len();
        let len_bytes = len.to_be_bytes();
        bytes.append(&Bytes::from_slice(env, &len_bytes));
        for fr in self.pub_signals.iter() {
            let u256 = fr.to_u256();
            let arr32 = u256.to_be_bytes();
            bytes.append(&arr32);
        }
        bytes
    }

    /// Deserialize public signals from raw bytes.
    /// Each 32-byte big-endian scalar is rejected if its value is >= the
    /// BLS12-381 scalar field modulus r. Zero is allowed.
    pub fn from_bytes(env: &Env, bytes: &Bytes) -> Result<Self, Groth16Error> {
        if bytes.len() < 4 {
            return Err(Groth16Error::MalformedPublicSignals);
        }
        let mut pos: u32 = 0;
        let len_end = pos
            .checked_add(4)
            .ok_or(Groth16Error::MalformedPublicSignals)?;
        let len_slice = bytes.slice(pos..len_end);
        let mut len_arr = [0u8; 4];
        len_slice.copy_into_slice(&mut len_arr);
        let len = u32::from_be_bytes(len_arr) as usize;
        pos = len_end;

        let expected: u64 = (len as u64)
            .checked_mul(Self::FR_SIZE as u64)
            .ok_or(Groth16Error::MalformedPublicSignals)?;
        let body_len = bytes
            .len()
            .checked_sub(pos)
            .ok_or(Groth16Error::MalformedPublicSignals)? as u64;
        if body_len != expected {
            return Err(Groth16Error::MalformedPublicSignals);
        }

        let fr_modulus = U256::from_be_bytes(env, &Bytes::from_slice(env, &BLS12_381_FR_MODULUS));

        let mut pub_signals = Vec::new(env);
        for _ in 0..len {
            let fr_end = pos
                .checked_add(Self::FR_SIZE as u32)
                .ok_or(Groth16Error::MalformedPublicSignals)?;
            let mut arr = [0u8; Self::FR_SIZE];
            let slice = bytes.slice(pos..fr_end);
            slice.copy_into_slice(&mut arr);
            pos = fr_end;
            let u256 = U256::from_be_bytes(env, &Bytes::from_array(env, &arr));
            // Reject non-canonical scalars: value must be strictly less than r
            if u256 >= fr_modulus {
                return Err(Groth16Error::MalformedPublicSignals);
            }
            let fr = Fr::from_u256(u256);
            pub_signals.push_back(fr);
        }
        Ok(PublicSignals { pub_signals })
    }
}

#[cfg(test)]
mod test;
