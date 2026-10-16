import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { CONTRACT_ADDRESS } from "./config.js";

export { shortAddr } from "./config.js";

const IDENTITY_KEY = "grantsentinel.identity.pk";
const BURNER_KEY = "grantsentinel.burner.pk";

// Minimal ABI entries for the contract functions and views the UI calls.
export const contractAbi = [
  { type: "function", name: "treasury_budget", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "next_proposal_id", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "next_review_id", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "total_credited_tokens", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "get_proposal", stateMutability: "view", inputs: [{ name: "pid", type: "uint256" }], outputs: [{ type: "tuple", components: [
    { name: "id", type: "uint256" }, { name: "title", type: "string" }, { name: "applicant", type: "address" },
    { name: "category", type: "string" }, { name: "grant_manifest", type: "string" }, { name: "proof_url", type: "string" },
    { name: "mandatory_artifact_token", type: "string" }, { name: "requested_tokens", type: "uint256" },
    { name: "credited_tokens", type: "uint256" }, { name: "remaining_tokens", type: "uint256" },
    { name: "upvotes", type: "uint256" }, { name: "conviction_multiplier", type: "uint256" },
    { name: "impact_score", type: "uint8" }, { name: "status", type: "string" }, { name: "artifact_verified", type: "bool" },
  ] }] },
  { type: "function", name: "get_review", stateMutability: "view", inputs: [{ name: "rid", type: "uint256" }], outputs: [{ type: "tuple", components: [
    { name: "id", type: "uint256" }, { name: "proposal_id", type: "uint256" }, { name: "reviewer", type: "address" },
    { name: "review_score", type: "uint8" }, { name: "contains_red_flag", type: "bool" }, { name: "summary", type: "string" },
    { name: "upvotes", type: "uint256" },
  ] }] },
  { type: "function", name: "submit_grant_proposal", stateMutability: "nonpayable", inputs: [
    { name: "title", type: "string" }, { name: "category", type: "string" }, { name: "grant_manifest", type: "string" },
    { name: "proof_url", type: "string" }, { name: "mandatory_artifact_token", type: "string" }, { name: "requested_tokens", type: "uint256" },
  ], outputs: [] },
  { type: "function", name: "submit_delegate_review", stateMutability: "nonpayable", inputs: [
    { name: "proposal_id", type: "uint256" }, { name: "review_score", type: "uint8" }, { name: "risk_flags", type: "string" },
    { name: "artifact_verified", type: "bool" }, { name: "summary", type: "string" },
  ], outputs: [] },
  { type: "function", name: "upvote_delegate_review", stateMutability: "nonpayable", inputs: [{ name: "review_id", type: "uint256" }], outputs: [] },
  { type: "function", name: "audit_grant_live", stateMutability: "nonpayable", inputs: [{ name: "proposal_id", type: "uint256" }], outputs: [] },
  { type: "function", name: "claim_grant_payout", stateMutability: "nonpayable", inputs: [{ name: "proposal_id", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdraw_proposal", stateMutability: "nonpayable", inputs: [{ name: "proposal_id", type: "uint256" }], outputs: [] },
];

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }

export function readClient() {
  return createClient({ chain: studionet });
}

function clientFor(account) {
  return createClient({ chain: studionet, account });
}

export function switchToBurner() {
  let pk = lsGet(BURNER_KEY);
  if (!pk) {
    pk = generatePrivateKey();
    lsSet(BURNER_KEY, pk);
  }
  const acct = createAccount(pk);
  lsSet(IDENTITY_KEY, pk);
  return acct;
}

function currentIdentity() {
  const pk = lsGet(IDENTITY_KEY);
  return pk ? createAccount(pk) : null;
}

export function isBurnerActive() {
  const id = lsGet(IDENTITY_KEY);
  return !!id && id === lsGet(BURNER_KEY);
}

export function connectIdentity() {
  let acct = currentIdentity();
  if (!acct) acct = switchToBurner();
  return { address: acct.address };
}

export function disconnectIdentity() {
  lsDel(IDENTITY_KEY);
}

export async function connectMetaMask() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No EIP-1193 provider found. Install MetaMask with the GenLayer Snap.");
  }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  const address = accounts[0];
  lsDel(IDENTITY_KEY);
  return { address };
}

async function activeClient() {
  const acct = currentIdentity();
  if (!acct) throw new Error("No active account. Click Connect.");
  return clientFor(acct);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// studionet can answer a gen_call with a transient failure; retry a few times.
async function withRetry(fn, tries = 3, delay = 900) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await sleep(delay * (i + 1));
    }
  }
  throw last;
}

function num(v) {
  if (v === null || v === undefined) return 0;
  return Number(v);
}

export async function readModel() {
  const client = readClient();
  const call = (functionName, args = [], tries = 3) =>
    withRetry(() => client.readContract({ address: CONTRACT_ADDRESS, abi: contractAbi, functionName, args }), tries);

  // Derive proposal and review presence by probing contiguous ids. The zero-arg
  // getters can fail transiently on the node, so they are best-effort with
  // fallbacks derived from the rows we did manage to fetch.
  const props = {};
  let pidMisses = 0;
  for (let i = 1; i <= 40 && pidMisses < 3; i++) {
    try {
      const p = await call("get_proposal", [BigInt(i)], 2);
      if (!p || !p.title) { pidMisses++; continue; }
      pidMisses = 0;
      props[i] = {
        id: num(p.id), title: p.title, applicant: p.applicant, category: p.category,
        grant_manifest: p.grant_manifest, proof_url: p.proof_url,
        mandatory_artifact_token: p.mandatory_artifact_token,
        requested_tokens: num(p.requested_tokens), credited_tokens: num(p.credited_tokens),
        remaining_tokens: num(p.remaining_tokens), upvotes: num(p.upvotes),
        conviction_multiplier: num(p.conviction_multiplier), impact_score: num(p.impact_score),
        status: p.status, artifact_verified: Boolean(p.artifact_verified),
      };
    } catch { pidMisses++; }
  }

  const revs = {};
  let ridMisses = 0;
  for (let i = 1; i <= 60 && ridMisses < 3; i++) {
    try {
      const r = await call("get_review", [BigInt(i)], 2);
      if (!r || !r.summary) { ridMisses++; continue; }
      ridMisses = 0;
      revs[i] = {
        id: num(r.id), proposal_id: num(r.proposal_id), reviewer: r.reviewer,
        review_score: num(r.review_score), contains_red_flag: Boolean(r.contains_red_flag),
        summary: r.summary, upvotes: num(r.upvotes),
      };
    } catch { ridMisses++; }
  }

  const derivedCredited = Object.values(props).reduce((s, p) => s + p.credited_tokens, 0);
  let budget = 50000000;
  let credited = derivedCredited;
  try { budget = num(await call("treasury_budget", [], 2)); } catch { /* fallback */ }
  try { credited = num(await call("total_credited_tokens", [], 2)); } catch { /* fallback */ }

  return {
    treasury_budget: budget,
    next_proposal_id: Object.keys(props).length + 1,
    next_review_id: Object.keys(revs).length + 1,
    total_credited_tokens: credited,
    proposals: props,
    reviews: revs,
  };
}

function leaderSuccess(receipt) {
  const cd = receipt && receipt.consensus_data;
  if (!cd) return false;
  let lr = cd.leader_receipt;
  if (lr && !Array.isArray(lr)) lr = [lr];
  return Array.isArray(lr) && lr[0] && lr[0].execution_result === "SUCCESS";
}

// Submit a write with the active account, wait for FINALIZED, report success.
export async function write(functionName, args = []) {
  const client = await activeClient();
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    abi: contractAbi,
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
    message: (receipt.consensus_data && receipt.consensus_data.message) || "",
    receipt,
  };
}
