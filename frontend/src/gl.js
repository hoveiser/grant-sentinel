import {
  createClient,
  createAccount,
  generatePrivateKey,
} from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { CONTRACT_ADDRESS } from "./config.js";

const BURNER_KEY_STORAGE = "grantsentinel.burner.pk";

// A read-only client (no account needed for views on gasless studionet).
export function readClient() {
  return createClient({ chain: studionet });
}

// Burner delegate wallet: a locally generated key, persisted in localStorage.
export function getOrCreateBurner() {
  let pk = localStorage.getItem(BURNER_KEY_STORAGE);
  if (!pk) {
    pk = generatePrivateKey();
    localStorage.setItem(BURNER_KEY_STORAGE, pk);
  }
  return createAccount(pk);
}

export function rotateBurner() {
  const pk = generatePrivateKey();
  localStorage.setItem(BURNER_KEY_STORAGE, pk);
  return createAccount(pk);
}

export function writeClient(account) {
  return createClient({ chain: studionet, account });
}

// Build a client backed by an EIP-1193 provider (MetaMask). GenLayer signing on
// studionet requires the GenLayer MetaMask Snap; errors are surfaced to the UI.
export function providerClient(provider, address) {
  return createClient({ chain: studionet, provider, account: address });
}

export async function connectMetaMask() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No EIP-1193 provider found. Install MetaMask.");
  }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  return { provider: window.ethereum, address: accounts[0] };
}

export async function read(client, functionName, args = []) {
  return client.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
  });
}

function leaderSuccess(receipt) {
  const cd = receipt && receipt.consensus_data;
  if (!cd) return false;
  let lr = cd.leader_receipt;
  if (lr && !Array.isArray(lr)) lr = [lr];
  return Array.isArray(lr) && lr[0] && lr[0].execution_result === "SUCCESS";
}

// Submit a write, wait for FINALIZED, and report execution success.
export async function write(client, functionName, args = []) {
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    value: 0n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  return {
    hash,
    statusName: receipt.status_name,
    finalized: receipt.status_name === "FINALIZED",
    success: leaderSuccess(receipt),
    receipt,
  };
}

// Normalize u256/bigint fields to JS numbers for display.
export function toNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "bigint") return Number(v);
  return Number(v);
}
