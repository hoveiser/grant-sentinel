// GrantSentinel frontend configuration and on-chain rule mirrors.
// Deployed on studionet (chain id 61999), gasless.

export const CONTRACT_ADDRESS = "0x2736a79F03d36080e63FA2ab164F7E9151D03978";
export const NETWORK = "studionet";
export const CHAIN_ID = 61999;
export const EXPLORER_URL = "https://genlayer-explorer.vercel.app";
export const INITIAL_TREASURY = 50000000;

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

const TIER_FULL = 75;
const TIER_PARTIAL = 45;
const RED_FLAG_PENALTY = 15;
const ENDORSE_BONUS = 5;
const UNVERIFIED_CAP = 70;

// Mirrors _apply_verdict() on-chain: conviction modifier, unverified cap, tiers.
export function simulateTier(score, endorsements = 0, redFlags = 0, artifactVerified = true) {
  let impact = Math.max(0, Math.min(100, Math.round(score || 0)));
  if (redFlags > endorsements) {
    impact = impact >= RED_FLAG_PENALTY ? impact - RED_FLAG_PENALTY : 0;
  } else if (endorsements > redFlags) {
    impact = impact + ENDORSE_BONUS > 100 ? 100 : impact + ENDORSE_BONUS;
  }
  if (!artifactVerified && impact >= TIER_FULL) impact = UNVERIFIED_CAP;

  let status = STATUS.REJECTED;
  let fraction = 0;
  if (impact >= TIER_FULL) {
    status = STATUS.APPROVED;
    fraction = 1;
  } else if (impact >= TIER_PARTIAL) {
    status = STATUS.PARTIAL;
    fraction = impact / 100;
  }
  return { status, tier: status, impact, fraction };
}

export function shortAddr(a) {
  if (!a) return "";
  const s = String(a);
  return s.length > 14 ? `${s.slice(0, 8)}...${s.slice(-4)}` : s;
}
