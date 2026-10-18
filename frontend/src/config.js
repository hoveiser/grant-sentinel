// GrantSentinel frontend configuration and on-chain rule mirrors.
// Deployed on studionet (chain id 61999), gasless.

export const CONTRACT_ADDRESS = "0x8d256ce6Af9Fa9419b82F3E2555aB742b341D6bD";
export const NETWORK = "studionet";
export const CHAIN_ID = 61999;
export const EXPLORER_URL = "https://genlayer-explorer.vercel.app";

// Funded custody tokenomics (Sentinel Grant Token, SGT). These mirror the
// contract's genesis constants exactly.
export const TOKEN_SYMBOL = "SGT";
export const TOTAL_SGT_SUPPLY = 100000000;
export const INITIAL_CUSTODY = 50000000;
export const TX_TYPES = {
  TREASURY_DEPOSIT: "TREASURY_DEPOSIT",
  GRANT_DISBURSEMENT: "GRANT_DISBURSEMENT",
  TOKEN_TRANSFER: "TOKEN_TRANSFER",
};

// These mirror the contract constants exactly.
export const CATEGORIES = ["DEVELOPER_TOOLS", "PROTOCOL_INFRA", "AI_RESEARCH", "ECOSYSTEM_GROWTH"];
export const STANCES = ["ENDORSE_CONVICTION", "RED_FLAG_CHALLENGE", "TECHNICAL_NOTE"];
export const STATUS = {
  SCREENING: "SCREENING",
  APPROVED: "APPROVED_FUNDED",
  PARTIAL: "PARTIAL_GRANT",
  REJECTED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
};

const SCORE_STEP = 5;
const TIER_FULL = 75;
const TIER_PARTIAL = 45;
const RED_FLAG_PENALTY = 15;
const ENDORSE_BONUS = 5;
const UNVERIFIED_CAP = 70;
const PARTIAL_REPRESENTATIVE = 60;

const snap = (v) => Math.floor(v / SCORE_STEP) * SCORE_STEP;

// Mirrors the on-chain settlement exactly: quantize the raw score to the 5-point
// grid, apply the deterministic conviction modifier, cap an unverified artifact,
// pick the consensus band, then derive the exact approved_payout deterministically
// from that band (full request, the PARTIAL representative, or zero).
export function simulateTier(rawScore, endorsements = 0, redFlags = 0, artifactVerified = true, requested = 0) {
  let impact = snap(Math.max(0, Math.min(100, Math.round(rawScore || 0))));
  if (redFlags > endorsements) {
    impact = impact >= RED_FLAG_PENALTY ? impact - RED_FLAG_PENALTY : 0;
  } else if (endorsements > redFlags) {
    impact = impact + ENDORSE_BONUS > 100 ? 100 : impact + ENDORSE_BONUS;
  }
  impact = snap(impact);
  if (!artifactVerified && impact >= TIER_FULL) impact = UNVERIFIED_CAP;

  let status = STATUS.REJECTED;
  let representative = 0;
  let payout = 0;
  if (impact >= TIER_FULL) {
    status = STATUS.APPROVED;
    representative = 100;
    payout = requested;
  } else if (impact >= TIER_PARTIAL) {
    status = STATUS.PARTIAL;
    representative = PARTIAL_REPRESENTATIVE;
    payout = Math.floor((requested * PARTIAL_REPRESENTATIVE) / 100);
  }
  const fraction = requested > 0 ? payout / requested : 0;
  return { status, tier: status, impact: representative, bandScore: impact, approvedPayout: payout, fraction };
}

export function shortAddr(a) {
  if (!a) return "";
  const s = String(a);
  return s.length > 14 ? `${s.slice(0, 8)}...${s.slice(-4)}` : s;
}
