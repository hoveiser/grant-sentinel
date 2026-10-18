import { Globe, ShieldAlert, ScanLine, Brain, Users, Landmark, CheckCircle2 } from "lucide-react";

// Visualizes the exact on-chain consensus and prompt pipeline for one proposal.
export default function ConsensusInspector({ proposal }) {
  if (!proposal) return null;
  const p = proposal;
  // p.impact_score is the on-chain stored quantized score; the settlement stages
  // below read it directly rather than re-applying the modifier.
  const defused = /(<\/?untrusted_data|<\/?SENTINEL_USER_TEXT)/i.test(p.grant_manifest) ? "would be defused" : "clean";

  const stages = [
    {
      icon: Globe,
      name: 'gl.nondet.web.render(proof_url, mode="text")',
      detail: `Source URL: ${p.proof_url}`,
      note: `Scheme must be http(s); length 8..512. Independent fetch by leader and every validator.`,
    },
    {
      icon: ShieldAlert,
      name: "Sanitize untrusted evidence",
      detail: `Manifest delimiters: ${defused}`,
      note: "ASCII control characters stripped, injected closing delimiters rewritten, body truncated to 5000 chars.",
    },
    {
      icon: ScanLine,
      name: "Mandatory artifact token check",
      detail: `Token: "${p.mandatory_artifact_token}"`,
      note: "Leader and validators must independently report the exact token present in the fetched body.",
    },
    {
      icon: Brain,
      name: "gl.nondet.exec_prompt -> raw impact_score, artifact_verified, report",
      detail: "the LLM only proposes a raw 0..100 score; it never sets a fund amount",
      note: "The raw score is snapped to the deterministic 5-point grid and mapped to a funding band label.",
    },
    {
      icon: Users,
      name: "gl.eq_principle.prompt_comparative (exact on discrete labels)",
      detail: `validators must agree on the identical tier_status ${p.status} and artifact_verified for score ${p.impact_score}`,
      note: "Consensus is required on the tier band and artifact flag; the exact payout is then recomputed deterministically from the agreed band, so no leader raw score sets the amount.",
    },
    {
      icon: Landmark,
      name: "Funded custody reservation",
      detail: `Status ${p.status} · representative ${p.impact_score} · exact payout ${p.credited_tokens} SGT · reserve requires unencumbered custody >= payout`,
      note: `Approved payouts are reserved from the vault, then moved wallet-to-wallet on claim. Community signal: ${p.upvotes} endorsements vs ${p.red_flags} red-flag challenges.`,
    },
  ];

  return (
    <div className="inspector">
      <div className="inspector-head">
        <CheckCircle2 size={16} className="ok" />
        <span>Consensus &amp; Prompt Inspector · proposal #{p.id}</span>
        <span className="chip">{p.status}</span>
      </div>
      <ol className="pipeline">
        {stages.map((s, i) => (
          <li key={i} className="pipe-node">
            <div className="pipe-badge">
              <s.icon size={16} />
            </div>
            <div className="pipe-body">
              <code className="pipe-name">{s.name}</code>
              <div className="pipe-detail">{s.detail}</div>
              <div className="pipe-note">{s.note}</div>
            </div>
          </li>
        ))}
      </ol>
      <p className="inspector-foot">
        This pipeline is reproduced from the deployed contract source. Direct-mode tests exercise the leader path only;
        validator agreement is covered by live studionet runs.
      </p>
    </div>
  );
}
