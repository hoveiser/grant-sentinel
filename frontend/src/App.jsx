import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectIdentity, disconnectIdentity, readModel, write, switchToBurner,
  connectMetaMask, isBurnerActive, shortAddr,
} from "./gl";
import { CONTRACT_ADDRESS, simulateTier } from "./config";
import Gauge from "./components/Gauge";
import BackgroundMesh from "./components/BackgroundMesh";
import ConsensusInspector from "./components/ConsensusInspector";
import { click, hum, chime, error as errSfx, isMuted, toggleMuted } from "./lib/sound";
import { celebrateFinalized } from "./lib/fx";
import {
  Wallet, RefreshCw, Sparkles, ShieldCheck, ShieldAlert, Volume2, VolumeX,
  Sliders, Activity, FileSignature, ArrowUp, ScanSearch, Coins, X, ChevronRight,
} from "lucide-react";

const CATEGORIES = ["DEFI", "AI_INFRA", "SECURITY", "CLIMATE"];

function tierColor(tier) {
  if (tier === "APPROVED_FULL") return "#2fbf7a";
  if (tier === "APPROVED_PARTIAL") return "#d6b25c";
  return "#e06c75";
}

// Interactive Payout & Consensus Simulator.
function Simulator({ budget }) {
  const [score, setScore] = useState(82);
  const [mult, setMult] = useState(1000);
  const [remaining, setRemaining] = useState(120000);
  const [artifact, setArtifact] = useState(true);
  const [redFlag, setRedFlag] = useState(false);

  const effScore = useMemo(() => {
    let s = score + (redFlag ? -15 : 0);
    if (!artifact && s > 70) s = 70;
    return Math.max(0, Math.min(100, s));
  }, [score, artifact, redFlag]);

  const tier = simulateTier(effScore, artifact);
  const conviction = Math.min(1500, Math.max(1000, mult + Math.min(200, 10 * 5)));
  const adjusted = Math.min(100, Math.round((effScore * conviction) / 1000));
  const raw = tier.tier === "APPROVED_FULL" ? remaining : tier.tier === "APPROVED_PARTIAL" ? Math.floor((remaining * 45) / 100) : 0;
  const paid = Math.min(raw, budget);

  return (
    <div className="simulator glass">
      <div className="sim-head">
        <Sliders size={16} className="accent" />
        <h3>Payout &amp; Consensus What-If Simulator</h3>
      </div>
      <p className="muted small">Drag the sliders to preview the exact on-chain settlement math before submitting a transaction.</p>
      <div className="sim-body">
        <div className="sim-controls">
          <label className="slider">
            <span>AI consensus score <b>{score}</b></span>
            <input type="range" min="0" max="100" value={score} onChange={(e) => { setScore(Number(e.target.value)); click(); }} />
          </label>
          <label className="slider">
            <span>Remaining tokens <b>{remaining.toLocaleString()}</b></span>
            <input type="range" min="0" max="500000" step="1000" value={remaining} onChange={(e) => { setRemaining(Number(e.target.value)); click(); }} />
          </label>
          <label className="slider">
            <span>Community upvotes <b>{Math.round((mult - 1000) / 10)}</b></span>
            <input type="range" min="1000" max="1500" value={mult} onChange={(e) => { setMult(Number(e.target.value)); click(); }} />
          </label>
          <label className="slider">
            <span>Conviction multiplier <b>{(conviction / 1000).toFixed(3)}x</b></span>
            <input type="range" min="1000" max="1500" value={conviction} readOnly />
          </label>
          <div className="toggles">
            <button type="button" className={`toggle ${artifact ? "on" : ""}`} onClick={() => { setArtifact(!artifact); hum(); }}>
              <ScanSearch size={14} /> artifact verified
            </button>
            <button type="button" className={`toggle danger ${redFlag ? "on" : ""}`} onClick={() => { setRedFlag(!redFlag); hum(); }}>
              <ShieldAlert size={14} /> apply red-flag (-15)
            </button>
          </div>
        </div>
        <div className="sim-viz">
          <Gauge value={effScore} label="Effective Score" tone={tierColor(tier.tier)} />
          <div className="tier-bar">
            <div className="tier-track">
              <span className="seg reject" style={{ width: "45%" }} />
              <span className="seg partial" style={{ width: "30%" }} />
              <span className="seg full" style={{ width: "25%" }} />
              <span className="marker" style={{ left: `${effScore}%` }} title={`score ${effScore}`} />
            </div>
            <div className="tier-legend">
              <span>0-44 REJECTED</span><span>45-74 PARTIAL</span><span>75-100 FULL</span>
            </div>
          </div>
          <div className="sim-out">
            <div><span>Payout tier</span><b style={{ color: tierColor(tier.tier) }}>{tier.tier}</b></div>
            <div><span>Adjusted score</span><b>{adjusted}</b></div>
            <div><span>Projected payout</span><b>{paid.toLocaleString()} / {remaining.toLocaleString()}</b></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [address, setAddress] = useState(null);
  const [burner, setBurner] = useState(false);
  const [model, setModel] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(isMuted());
  const [tab, setTab] = useState("all");
  const [inspectId, setInspectId] = useState(null);
  const [form, setForm] = useState({
    title: "", category: "AI_INFRA", manifest: "", proof_url: "", token: "v2", grant: 120000,
  });
  const [review, setReview] = useState({ pid: 1, score: 82, artifact: true, risk: "", note: "" });

  const addLine = useCallback((line) => setLog((prev) => [...prev.slice(-60), line]), []);

  const refresh = useCallback(async () => {
    try {
      setModel(await readModel());
    } catch (e) {
      addLine(`read failed: ${String(e.message || e).slice(0, 90)}`);
    }
  }, [addLine]);

  useEffect(() => {
    setAddress(connectIdentity() || null);
    setBurner(isBurnerActive());
    refresh();
  }, [refresh]);

  const run = useCallback(async (fn, label) => {
    setBusy(true);
    addLine(`${label} submitted (awaiting FINALIZED)`);
    click();
    try {
      const res = await fn();
      const msg = String(res.message || "").slice(0, 120);
      if (res.statusName === "FINALIZED" && res.success) {
        chime();
        celebrateFinalized(0.35);
        addLine(`${label} FINALIZED OK · tx ${shortAddr(res.hash)}${msg ? ` · ${msg}` : ""}`);
        await refresh();
      } else if (res.statusName === "FINALIZED") {
        errSfx();
        addLine(`${label} FINALIZED, execution FAILED${msg ? `: ${msg}` : ""}`);
      } else {
        errSfx();
        addLine(`${label} status=${res.statusName}${msg ? `: ${msg}` : ""}`);
      }
    } catch (e) {
      errSfx();
      addLine(`${label} error: ${String(e.message || e).slice(0, 120)}`);
    } finally {
      setBusy(false);
    }
  }, [addLine, refresh]);

  // Adversarial guard test: submits an out-of-policy proposal that the contract must reject.
  const runGuard = useCallback(() => {
    setBusy(true);
    addLine("guard test: submitting invalid category (expect revert)");
    click();
    (async () => {
      const res = await write("submit_grant_proposal", ["Guard Probe", "EXPLOIT", "x".repeat(20), "https://example.com/x", "v2", 999]);
      if (res.statusName === "FINALIZED" && !res.success) {
        addLine(`guard tripped as expected · reverted ${shortAddr(res.hash)} · ${String(res.message || "").slice(0, 80)}`);
        errSfx();
      } else if (res.success) {
        addLine(`unexpected: guard did NOT reject ${shortAddr(res.hash)}`);
      } else {
        addLine(`guard test status=${res.statusName}`);
      }
    })().finally(() => setBusy(false));
  }, [addLine]);

  const setF = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setR = (k) => (e) => setReview({ ...review, [k]: e.target.value });
  const quickFill = () => {
    setForm({
      title: "Open Zero-Knowledge Verifier Library",
      category: "SECURITY",
      manifest: "Audit-ready ZK verifier with 214 passing tests, deterministic circuit builders, and a public API. Sentinels should locate the token v2.",
      proof_url: "https://github.com/audit-wiki/index.md",
      token: "v2",
      grant: 120000,
    });
    hum();
    addLine("quick-fill populated the proposal form");
  };

  const switchTab = (t) => { setTab(t); hum(); };

  const proposals = useMemo(() => {
    const ids = model ? Object.keys(model.proposals).map(Number).sort((a, b) => b - a) : [];
    return ids.map((id) => model.proposals[id]).filter((p) => {
      if (tab === "active") return p.status === "ACTIVE_FUNDING";
      if (tab === "screening") return p.status === "PENDING_SCREENING";
      if (tab === "approved") return p.status === "APPROVED_FUNDED" || p.status === "PARTIALLY_FUNDED";
      if (tab === "paid") return p.status === "FULLY_PAID";
      return true;
    });
  }, [model, tab]);

  const inspectProposal = inspectId != null && model ? model.proposals[inspectId] : null;

  return (
    <div className="app">
      <BackgroundMesh />
      <header className="topbar glass">
        <div className="brand">
          <img src="logo.png" alt="GrantSentinel logo" className="logo" />
          <div>
            <h1>GrantSentinel</h1>
            <span className="muted small">AI-Audited Public Goods &amp; Milestone Grant Allocator</span>
          </div>
        </div>
        <div className="top-actions">
          <button
            className={`icon-btn ${muted ? "" : "on"}`}
            onClick={() => { setMuted(toggleMuted()); if (muted) click(); }}
            title={muted ? "Unmute UI sounds" : "Mute UI sounds"}
            aria-pressed={!muted}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button className="ghost icon-btn" onClick={() => { refresh(); click(); }} title="Refresh on-chain state">
            <RefreshCw size={16} />
          </button>
          {address ? (
            <>
              <span className="pill">{burner ? "burner" : "identity"} {shortAddr(address)}</span>
              <button className="ghost icon-btn" onClick={() => { switchToBurner(); setBurner(isBurnerActive()); setAddress(connectIdentity()?.address || address); setMuted(isMuted()); hum(); }} title="Switch Identity: ephemeral burner">
                <Sparkles size={16} />
              </button>
              <button className="ghost icon-btn" onClick={() => { connectMetaMask(); setBurner(isBurnerActive()); setAddress(connectIdentity()?.address || address); }} title="Link MetaMask">
                <Wallet size={16} />
              </button>
              <button className="danger icon-btn" onClick={() => { disconnectIdentity(); setAddress(null); setBurner(false); click(); }} title="Disconnect">
                <X size={16} />
              </button>
            </>
          ) : (
            <button className="primary" onClick={() => { setAddress(connectIdentity()); click(); }}>
              <Wallet size={16} /> Connect GenLayer Identity
            </button>
          )}
        </div>
      </header>

      <div className="addrbar glass">
        <span className="muted small">Contract</span>
        <code>{CONTRACT_ADDRESS}</code>
        <span className="chip">studionet</span>
        <span className="chip">chain 61999</span>
        <span className="chip">gasless</span>
      </div>

      {!address && (
        <div className="callout glass">
          <ShieldCheck size={16} className="accent" />
          <span>Reads stream live from studionet. Connect to sign audits and grant actions. Use <b>Switch Identity</b> for an ephemeral burner that cannot touch your real accounts.</span>
        </div>
      )}

      <div className="layout">
        <main>
          {model && (
            <div className="treasury-row">
              <div className="stat glass"><span>Treasury Budget</span><b>{model.treasury_budget.toLocaleString()}</b></div>
              <div className="stat glass"><span>Total Credited</span><b>{model.total_credited_tokens.toLocaleString()}</b></div>
              <div className="stat glass"><span>Uncredited Pool</span><b>{(model.treasury_budget - model.total_credited_tokens).toLocaleString()}</b></div>
              <div className="stat glass"><span>Proposals</span><b>{model.next_proposal_id - 1}</b></div>
              <div className="stat glass"><span>Reviews</span><b>{model.next_review_id - 1}</b></div>
            </div>
          )}

          <Simulator budget={model ? model.treasury_budget : 50000000} />

          <div className="tabs">
            {[["all", "All"], ["active", "Active Funding"], ["screening", "Pending Screening"], ["approved", "Approved"], ["paid", "Paid"]].map(([k, lbl]) => (
              <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => switchTab(k)}>{lbl}</button>
            ))}
          </div>

          <section className="proposals">
            <h2><Activity size={16} className="accent" /> Proposals (live on-chain)</h2>
            {!model && <p className="muted">Loading on-chain state...</p>}
            {model && proposals.length === 0 && <p className="muted">No proposals in this view.</p>}
            {proposals.map((p) => {
              const tier = simulateTier(p.impact_score, p.artifact_verified);
              const reviews = Object.values(model.reviews).filter((r) => Number(r.proposal_id) === p.id);
              return (
                <article className="proposal glass" key={p.id}>
                  <header>
                    <div>
                      <h3>{p.title} <span className="chip">#{p.id}</span></h3>
                      <span className="muted small">{p.category} · {p.status} · applicant {shortAddr(p.applicant)}</span>
                    </div>
                    <button className="icon-btn inspect-btn" onClick={() => { setInspectId(inspectId === p.id ? null : p.id); hum(); }} title="Open Consensus & Prompt Inspector">
                      <ScanSearch size={16} />
                    </button>
                  </header>
                  <div className="proposal-grid">
                    <div className="pgauge">
                      <Gauge value={p.impact_score} label="Impact" size={128} tone={tierColor(p.status.startsWith("APPROVED") || p.status === "FULLY_PAID" ? "APPROVED_FULL" : tier.tier)} />
                    </div>
                    <dl className="kv">
                      <div><dt>Requested</dt><dd>{p.requested_tokens.toLocaleString()}</dd></div>
                      <div><dt>Credited</dt><dd>{p.credited_tokens.toLocaleString()}</dd></div>
                      <div><dt>Remaining</dt><dd>{p.remaining_tokens.toLocaleString()}</dd></div>
                      <div><dt>Artifact</dt><dd>{p.artifact_verified ? "verified" : "unverified"}</dd></div>
                      <div><dt>Tier</dt><dd style={{ color: tierColor(tier.tier) }}>{tier.tier}</dd></div>
                      <div><dt>Upvotes</dt><dd>{p.upvotes}</dd></div>
                      <div><dt>Multiplier</dt><dd>{(p.conviction_multiplier / 1000).toFixed(3)}x</dd></div>
                      <div><dt>Proof URL</dt><dd className="url" title={p.proof_url}>{p.proof_url}</dd></div>
                    </dl>
                  </div>
                  <p className="manifest">{p.grant_manifest}</p>
                  {reviews.length > 0 && (
                    <ul className="reviews">
                      {reviews.map((r) => (
                        <li key={r.id}>
                          score {r.review_score}{r.contains_red_flag ? " · RED FLAG" : ""} · {r.summary}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="row">
                    <button disabled={busy} className="ghost" onClick={() => run(() => write("audit_grant_live", [p.id]), `live audit #${p.id}`)}>
                      <ShieldCheck size={14} /> Live AI Audit
                    </button>
                    {reviews.length > 0 && (
                      <button disabled={busy} className="ghost" onClick={() => run(() => write("upvote_delegate_review", [Number(reviews[0].id)]), `upvote review #${reviews[0].id}`)}>
                        <ArrowUp size={14} /> Upvote Review #{reviews[0].id}
                      </button>
                    )}
                    {p.status === "APPROVED_FUNDED" || p.status === "PARTIALLY_FUNDED" ? (
                      <button disabled={busy} className="primary" onClick={() => run(() => write("claim_grant_payout", [p.id]), `claim #${p.id}`)}>
                        <Coins size={14} /> Claim Payout
                      </button>
                    ) : (
                      <button disabled={busy} className="ghost" onClick={() => run(() => write("withdraw_proposal", [p.id]), `withdraw #${p.id}`)}>
                        <X size={14} /> Withdraw
                      </button>
                    )}
                  </div>
                  {inspectId === p.id && <ConsensusInspector proposal={p} />}
                </article>
              );
            })}
          </section>
        </main>

        <aside className="side">
          <section className="glass panel">
            <h2><FileSignature size={16} className="accent" /> Submit Grant Proposal</h2>
            <label>Title<input value={form.title} onChange={setF("title")} placeholder="Public goods milestone" /></label>
            <label>Category<select value={form.category} onChange={setF("category")}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label>Manifest<textarea rows={3} value={form.manifest} onChange={setF("manifest")} placeholder="Plain text, no markup" /></label>
            <label>Proof URL<input value={form.proof_url} onChange={setF("proof_url")} placeholder="https://..." /></label>
            <div className="two">
              <label>Token<input value={form.token} onChange={setF("token")} /></label>
              <label>Grant<input type="number" value={form.grant} onChange={setF("grant")} /></label>
            </div>
            <div className="row wrap">
              <button className="ghost" onClick={quickFill} disabled={busy}><Sparkles size={14} /> Quick-Fill</button>
              <button className="danger" onClick={runGuard} disabled={busy}><ShieldAlert size={14} /> Test Security Guard</button>
              <button className="primary" disabled={busy} onClick={() => run(() => write("submit_grant_proposal", [form.title, form.category, form.manifest, form.proof_url, form.token, Math.max(0, Math.floor(Number(form.grant) || 0))]), "submit proposal")}>
                Submit
              </button>
            </div>
          </section>

          <section className="glass panel">
            <h2><ShieldCheck size={16} className="accent" /> Submit Delegate Review</h2>
            <div className="two">
              <label>Proposal ID<input type="number" value={review.pid} onChange={setR("pid")} /></label>
              <label>Score (1-100)<input type="number" value={review.score} onChange={setR("score")} /></label>
            </div>
            <label>Risk flags<input value={review.risk} onChange={setR("risk")} placeholder="none" /></label>
            <label>Summary<input value={review.note} onChange={setR("note")} placeholder="Delegate assessment" /></label>
            <label className="check">
              <input type="checkbox" checked={review.artifact} onChange={(e) => setReview({ ...review, artifact: e.target.checked })} />
              Artifact verified
            </label>
            <div className="row">
              <button className="primary" disabled={busy} onClick={() => run(() => write("submit_delegate_review", [Math.max(0, Math.floor(Number(review.pid) || 0)), Math.max(0, Math.floor(Number(review.score) || 0)), review.risk || "none", review.artifact, review.note || "delegate review"]), "submit review")}>
                Submit Review
              </button>
              <button className="ghost" disabled={busy} onClick={() => run(() => write("upvote_delegate_review", [Math.max(0, Math.floor(Number(review.pid) || 0))]), "upvote review")}>
                <ArrowUp size={14} /> Upvote Review
              </button>
            </div>
          </section>

          <section className="glass panel">
            <h2 className="loghead"><ChevronRight size={16} className="accent" /> Transaction Log</h2>
            <div className="log">
              {log.length === 0 && <span className="muted">No transactions yet.</span>}
              {log.map((l, i) => <span key={i}>{l}</span>)}
            </div>
          </section>
        </aside>
      </div>

      <footer className="foot muted small">
        GrantSentinel · GenLayer Intelligent Contract on studionet (chain 61999) · every fund transfer gated by
        gl.nondet.web.render evidence and gl.eq_principle.prompt_comparative validator consensus.
      </footer>
    </div>
  );
}
