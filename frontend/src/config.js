// GrantSentinel frontend configuration.
// Deployed on studionet (chain id 61999), gasless.

export const CONTRACT_ADDRESS = "0x2736a79F03d36080e63FA2ab164F7E9151D03978";
export const NETWORK = "studionet";
export const CHAIN_ID = 61999;
export const EXPLORER_URL = "https://genlayer-explorer.vercel.app";

// Treasury starts at 50,000,000 virtual grant units.
export const INITIAL_TREASURY = 50000000;

export const CATEGORIES = [
  "DEVELOPER_TOOLS",
  "PROTOCOL_INFRA",
  "AI_RESEARCH",
  "ECOSYSTEM_GROWTH",
];

export const STANCES = ["ENDORSE_CONVICTION", "RED_FLAG_CHALLENGE", "TECHNICAL_NOTE"];

// Mirrors the contract disbursement rules for the off-chain simulator only.
export function simulateTier(score, endorsements, redFlags, requestedGrant) {
  let impact = Math.max(0, Math.min(100, Math.floor(score)));
  if (redFlags > endorsements) {
    impact = Math.max(0, impact - 15);
  } else if (endorsements > redFlags) {
    impact = Math.min(100, impact + 5);
  }
  let status = "REJECTED";
  let payout = 0;
  if (impact >= 75) {
    status = "APPROVED_FUNDED";
    payout = requestedGrant;
  } else if (impact >= 45) {
    status = "PARTIAL_GRANT";
    payout = Math.floor((requestedGrant * impact) / 100);
  }
  return { impact, status, payout };
}
