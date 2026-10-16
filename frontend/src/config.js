// GrantSentinel frontend configuration.
// Deployed on studionet (chain id 61999), gasless.

export const CONTRACT_ADDRESS = "0x2736a79F03d36080e63FA2ab164F7E9151D03978";
export const NETWORK = "studionet";
export const CHAIN_ID = 61999;
export const EXPLORER_URL = "https://genlayer-explorer.vercel.app";
export const INITIAL_TREASURY = 50000000;
export const CATEGORIES = ["DEFI", "AI_INFRA", "SECURITY", "CLIMATE"];
export const STANCES = ["ENDORSE_CONVICTION", "RED_FLAG_CHALLENGE", "TECHNICAL_NOTE"];

// Mirror of the contract tiering rules for the simulator and inspector.
export function simulateTier(score, artifactVerified = true) {
  let s = Math.max(0, Math.min(100, Math.round(score || 0)));
  if (!artifactVerified && s > 70) s = 70;
  if (s >= 75) return { tier: "APPROVED_FULL", fraction: 75, score: s };
  if (s >= 45) return { tier: "APPROVED_PARTIAL", fraction: 45, score: s };
  return { tier: "REJECTED", fraction: 0, score: s };
}

export function shortAddr(a) {
  if (!a) return "";
  const s = String(a);
  return s.length > 14 ? `${s.slice(0, 8)}...${s.slice(-4)}` : s;
}
