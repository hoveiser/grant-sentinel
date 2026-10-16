import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { CONTRACT_ADDRESS } from "./config.js";

export { shortAddr } from "./config.js";

const IDENTITY_KEY = "grantsentinel.identity.pk";
const BURNER_KEY = "grantsentinel.burner.pk";

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }

// genlayer-js resolves the deployed contract schema itself, so we never hand a
// local ABI to readContract/writeContract. That keeps field decoding aligned
// with the real GrantProposal / DelegateReview structs.
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

function num(v) {
  if (v === null || v === undefined) return 0;
  return Number(v);
}

function read(client, functionName, args = []) {
  return client.readContract({ address: CONTRACT_ADDRESS, functionName, args });
}

export async function readModel() {
  const client = readClient();
  const rawList = await read(client, "get_all_proposals", []);
  const proposals = {};
  for (const p of rawList || []) {
    const id = num(p.proposal_id);
    const requested = num(p.requested_grant);
    const credited = num(p.approved_payout);
    proposals[id] = {
      id,
      title: p.project_title,
      applicant: p.applicant,
      category: p.public_good_category,
      grant_manifest: p.deliverable_manifest,
      proof_url: p.proof_url,
      mandatory_artifact_token: p.mandatory_artifact_token,
      requested_tokens: requested,
      credited_tokens: credited,
      remaining_tokens: Math.max(0, requested - credited),
      upvotes: num(p.conviction_endorsements),
      red_flags: num(p.red_flag_challenges),
      review_count: num(p.review_count),
      impact_score: num(p.verified_impact_score),
      status: p.status,
      artifact_verified: true,
      audit_report: p.sentinel_audit_report,
    };
  }

  const reviews = {};
  // studionet throttles to 30 requests/minute, so fetch delegate reviews only for
  // the two most recent proposals rather than every one. The card review list is
  // best-effort; the inspector visualises the pipeline from proposal fields only.
  const recentIds = Object.keys(proposals).sort((a, b) => Number(b) - Number(a)).slice(0, 2);
  for (const id of recentIds) {
    try {
      const revs = await read(client, "get_proposal_reviews", [BigInt(id)]);
      for (const r of revs || []) {
        reviews[num(r.review_id)] = {
          id: num(r.review_id),
          proposal_id: num(r.proposal_id),
          stance: r.verdict_stance,
          contains_red_flag: r.verdict_stance === "RED_FLAG_CHALLENGE",
          summary: r.rationale,
          helpful: num(r.helpful_votes),
          handle: r.delegate_handle,
          delegate: r.delegate,
        };
      }
    } catch { /* transient node or rate-limit failure */ }
  }

  let summary = {};
  try { summary = await read(client, "get_sentinel_summary", []); } catch { /* best effort */ }
  const derivedCredited = Object.values(proposals).reduce((s, p) => s + p.credited_tokens, 0);

  return {
    treasury_budget: num(summary.treasury_budget) || 50000000,
    total_credited_tokens: num(summary.total_granted) || derivedCredited,
    next_proposal_id: num(summary.proposal_count) + 1,
    next_review_id: num(summary.review_count) + 1,
    counts: {
      screening: num(summary.screening_count),
      approved: num(summary.approved_count),
      partial: num(summary.partial_count),
      rejected: num(summary.rejected_count),
      withdrawn: num(summary.withdrawn_count),
    },
    proposals,
    reviews,
  };
}

function leaderSuccess(receipt) {
  const cd = receipt && receipt.consensus_data;
  if (!cd) return false;
  let lr = cd.leader_receipt;
  if (lr && !Array.isArray(lr)) lr = [lr];
  return Array.isArray(lr) && lr[0] && lr[0].execution_result === "SUCCESS";
}

export async function write(functionName, args = []) {
  const client = await activeClient();
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    value: 0n,
  });
  // GenLayer may hand back an intermediate ACCEPTED receipt first; poll until the
  // transaction is FINALIZED (or a deadline) so the UI reports true execution.
  const receipt = await pollReceipt(client, hash, 30000);
  return {
    hash,
    statusName: receipt ? receipt.status_name : "UNKNOWN",
    finalized: !!receipt && receipt.status_name === "FINALIZED",
    success: leaderSuccess(receipt),
    message: (receipt && receipt.consensus_data && receipt.consensus_data.message) || "",
    receipt,
  };
}

async function pollReceipt(client, hash, deadlineMs) {
  const end = Date.now() + deadlineMs;
  let last = null;
  try {
    last = await client.waitForTransactionReceipt({ hash });
  } catch { /* not mined yet */ }
  while (Date.now() < end) {
    if (last && last.status_name === "FINALIZED") return last;
    await new Promise((r) => setTimeout(r, 4000));
    try {
      if (typeof client.getTransactionReceipt === "function") {
        last = await client.getTransactionReceipt({ hash });
      } else {
        last = await client.waitForTransactionReceipt({ hash, timeout: 4000 });
      }
    } catch { /* still pending */ }
  }
  return last;
}
