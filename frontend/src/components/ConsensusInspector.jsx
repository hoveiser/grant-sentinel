import { Globe, ShieldAlert, ScanLine, Brain, Users, Coins, CheckCircle2 } from "lucide-react";
import { simulateTier } from "../config";

// Visualizes the exact on-chain consensus and prompt pipeline for one proposal.
export default function ConsensusInspector({ proposal }) {
  if (!proposal) return null;
  const p = proposal;
  const tier = simulateTier(p.impact_score, p.upvotes, p.red_flags, p.artifact_verified);
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
      name: "gl.nondet.exec_prompt → JSON verdict",
      detail: "artifact_verified, evidence_quality (0-100), risk_flags, summary",
      note: "The LLM scores evidence quality only; it never decides a fund amount directly.",
    },
    {
      icon: Users,
      name: "gl.eq_principle.prompt_comparative",
      detail: `Tier band around score ${p.impact_score} (75 / 45 boundaries)`,
      note: "Consensus fails closed unless validators agree within the tier band and on artifact_verified.",
    },
    {
      icon: Coins,
      name: "Deterministic settlement",
      detail: `Status ${tier.status} · adjusted impact ${tier.impact} · red-flag -15 · endorse +5 · unverified cap 70`,
      note: `Community signal: ${p.upvotes} endorsements vs ${p.red_flags} red-flag challenges.`,
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
