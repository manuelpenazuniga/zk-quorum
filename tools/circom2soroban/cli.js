#!/usr/bin/env node
// circom2soroban CLI — convert snarkjs JSON artifacts to Soroban canonical bytes
//
// Usage:
//   node cli.js vk        <vk.json>    [output.bin]
//   node cli.js proof     <proof.json> [output.bin]
//   node cli.js public    <public.json> [output.bin]
//   node cli.js all       <vk.json> <proof.json> <public.json> <output_dir>
//
// Outputs raw binary to stdout when no output file specified.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { convertVk, convertProof, convertPublicSignals } from './src/convert.js';

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`ERROR: cannot read ${path}: ${e.message}`);
    process.exit(1);
  }
}

function writeOutput(buf, outPath) {
  if (outPath) {
    writeFileSync(outPath, buf);
  } else {
    process.stdout.write(buf);
  }
}

const cmd = process.argv[2];

if (!cmd) {
  console.error('Usage: circom2soroban <vk|proof|public|all> <inputs...> [output]');
  process.exit(1);
}

try {
  switch (cmd) {
    case 'vk': {
      const vkPath = process.argv[3];
      if (!vkPath) { console.error('Missing VK JSON path'); process.exit(1); }
      const outPath = process.argv[4] || null;
      const vkJson = readJSON(vkPath);
      const buf = convertVk(vkJson);
      writeOutput(buf, outPath);
      break;
    }
    case 'proof': {
      const proofPath = process.argv[3];
      if (!proofPath) { console.error('Missing proof JSON path'); process.exit(1); }
      const outPath = process.argv[4] || null;
      const proofJson = readJSON(proofPath);
      const buf = convertProof(proofJson);
      writeOutput(buf, outPath);
      break;
    }
    case 'public': {
      const pubPath = process.argv[3];
      if (!pubPath) { console.error('Missing public JSON path'); process.exit(1); }
      const outPath = process.argv[4] || null;
      const pubJson = readJSON(pubPath);
      const buf = convertPublicSignals(pubJson);
      writeOutput(buf, outPath);
      break;
    }
    case 'all': {
      const vkPath = process.argv[3];
      const proofPath = process.argv[4];
      const pubPath = process.argv[5];
      const outDir = process.argv[6];
      if (!vkPath || !proofPath || !pubPath || !outDir) {
        console.error('Usage: circom2soroban all <vk.json> <proof.json> <public.json> <output_dir>');
        process.exit(1);
      }
      const vkJson = readJSON(vkPath);
      const proofJson = readJSON(proofPath);
      const pubJson = readJSON(pubPath);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(`${outDir}/vk.bin`, convertVk(vkJson));
      writeFileSync(`${outDir}/proof.bin`, convertProof(proofJson));
      writeFileSync(`${outDir}/public.bin`, convertPublicSignals(pubJson));
      console.log(`Wrote vk.bin, proof.bin, public.bin to ${outDir}`);
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}
