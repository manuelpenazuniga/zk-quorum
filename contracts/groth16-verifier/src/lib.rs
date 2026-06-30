#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, Bytes, Env};
use zk::{Proof, PublicSignals, VerificationKey};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VerifierError {
    MalformedVerifyingKey = 1,
    MalformedProof = 2,
    MalformedPublicSignals = 3,
    IcLengthMismatch = 4,
}

#[contract]
pub struct Groth16VerifierContract;

#[contractimpl]
impl Groth16VerifierContract {
    /// Verify a Groth16 proof over BLS12-381.
    ///
    /// Takes raw bytes for VK, proof, and public signals. Deserializes
    /// them internally using the zk crate's canonical encoding.
    pub fn verify_proof(
        env: Env,
        vk_bytes: Bytes,
        proof_bytes: Bytes,
        public_signals_bytes: Bytes,
    ) -> Result<bool, VerifierError> {
        let vk = VerificationKey::from_bytes(&env, &vk_bytes)
            .map_err(|_| VerifierError::MalformedVerifyingKey)?;
        let proof =
            Proof::from_bytes(&env, &proof_bytes).map_err(|_| VerifierError::MalformedProof)?;
        let signals = PublicSignals::from_bytes(&env, &public_signals_bytes)
            .map_err(|_| VerifierError::MalformedPublicSignals)?;

        let bls = env.crypto().bls12_381();

        if signals.pub_signals.len() + 1 != vk.ic.len() {
            return Err(VerifierError::IcLengthMismatch);
        }

        let mut vk_x = vk.ic.first().ok_or(VerifierError::MalformedVerifyingKey)?;
        for (s, v) in signals.pub_signals.iter().zip(vk.ic.iter().skip(1)) {
            let prod = bls.g1_mul(&v, &s);
            vk_x = bls.g1_add(&vk_x, &prod);
        }

        let neg_a = -proof.a;
        let vp1 = soroban_sdk::vec![&env, neg_a, vk.alpha, vk_x, proof.c];
        let vp2 = soroban_sdk::vec![&env, proof.b, vk.beta, vk.gamma, vk.delta];

        Ok(bls.pairing_check(vp1, vp2))
    }
}

#[cfg(test)]
mod test;
