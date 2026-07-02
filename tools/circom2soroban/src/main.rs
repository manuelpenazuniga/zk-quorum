//! circom2soroban CLI — convert snarkjs JSON to Soroban canonical bytes.

use circom2soroban::{convert_proof, convert_public_signals, convert_vk, ProofJson, PublicJson, VkJson};
use std::fs;
use std::io::{self, Write};
use std::path::Path;

fn read_json<T: serde::de::DeserializeOwned>(path: &str) -> Result<T, String> {
    let data = fs::read_to_string(path).map_err(|e| format!("Cannot read {}: {}", path, e))?;
    serde_json::from_str(&data).map_err(|e| format!("Invalid JSON in {}: {}", path, e))
}

fn write_output(data: &[u8], path: Option<&str>) -> Result<(), String> {
    if let Some(p) = path {
        fs::write(p, data).map_err(|e| format!("Cannot write {}: {}", p, e))
    } else {
        io::stdout()
            .write_all(data)
            .map_err(|e| format!("Cannot write stdout: {}", e))
    }
}

fn cmd_vk(vk_path: &str, out: Option<&str>) -> Result<(), String> {
    let vk: VkJson = read_json(vk_path)?;
    let bytes = convert_vk(&vk).map_err(|e| e.to_string())?;
    write_output(&bytes, out)
}

fn cmd_proof(proof_path: &str, out: Option<&str>) -> Result<(), String> {
    let proof: ProofJson = read_json(proof_path)?;
    let bytes = convert_proof(&proof).map_err(|e| e.to_string())?;
    write_output(&bytes, out)
}

fn cmd_public(pub_path: &str, out: Option<&str>) -> Result<(), String> {
    let signals: PublicJson = read_json(pub_path)?;
    let bytes =
        convert_public_signals(&signals).map_err(|e| e.to_string())?;
    write_output(&bytes, out)
}

fn cmd_all(
    vk_path: &str,
    proof_path: &str,
    pub_path: &str,
    out_dir: &str,
) -> Result<(), String> {
    fs::create_dir_all(out_dir).map_err(|e| format!("Cannot create {}: {}", out_dir, e))?;

    let vk: VkJson = read_json(vk_path)?;
    let vk_bytes = convert_vk(&vk).map_err(|e| e.to_string())?;
    fs::write(Path::new(out_dir).join("vk.bin"), &vk_bytes)
        .map_err(|e| format!("Cannot write vk.bin: {}", e))?;

    let proof: ProofJson = read_json(proof_path)?;
    let proof_bytes =
        convert_proof(&proof).map_err(|e| e.to_string())?;
    fs::write(Path::new(out_dir).join("proof.bin"), &proof_bytes)
        .map_err(|e| format!("Cannot write proof.bin: {}", e))?;

    let signals: PublicJson = read_json(pub_path)?;
    let pub_bytes =
        convert_public_signals(&signals).map_err(|e| e.to_string())?;
    fs::write(Path::new(out_dir).join("public.bin"), &pub_bytes)
        .map_err(|e| format!("Cannot write public.bin: {}", e))?;

    eprintln!("Wrote vk.bin, proof.bin, public.bin to {}", out_dir);
    Ok(())
}

fn print_usage() {
    eprintln!("Usage: circom2soroban <vk|proof|public|all> <args...>");
    eprintln!("  vk     <vk.json> [output.bin]");
    eprintln!("  proof  <proof.json> [output.bin]");
    eprintln!("  public <public.json> [output.bin]");
    eprintln!("  all    <vk.json> <proof.json> <public.json> <out_dir>");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        print_usage();
        std::process::exit(1);
    }

    let result = match args[1].as_str() {
        "vk" => {
            if args.len() < 3 {
                eprintln!("Missing VK JSON path");
                std::process::exit(1);
            }
            cmd_vk(&args[2], args.get(3).map(|s| s.as_str()))
        }
        "proof" => {
            if args.len() < 3 {
                eprintln!("Missing proof JSON path");
                std::process::exit(1);
            }
            cmd_proof(&args[2], args.get(3).map(|s| s.as_str()))
        }
        "public" => {
            if args.len() < 3 {
                eprintln!("Missing public JSON path");
                std::process::exit(1);
            }
            cmd_public(&args[2], args.get(3).map(|s| s.as_str()))
        }
        "all" => {
            if args.len() < 6 {
                eprintln!("Usage: circom2soroban all <vk.json> <proof.json> <public.json> <out_dir>");
                std::process::exit(1);
            }
            cmd_all(&args[2], &args[3], &args[4], &args[5])
        }
        _ => {
            eprintln!("Unknown command: {}", args[1]);
            print_usage();
            std::process::exit(1);
        }
    };

    if let Err(e) = result {
        eprintln!("ERROR: {}", e);
        std::process::exit(1);
    }
}
