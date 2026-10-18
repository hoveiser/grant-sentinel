import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectIdentity, disconnectIdentity, readModel, write, switchToBurner,
  connectMetaMask, isBurnerActive, shortAddr,
} from "./gl";
import { CONTRACT_ADDRESS, CATEGORIES, STANCES, STATUS, TOKEN_SYMBOL, TX_TYPES, simulateTier } from "./config";
import Gauge from "./components/Gauge";
import BackgroundMesh from "./components/BackgroundMesh";
import ConsensusInspector from "./components/ConsensusInspector";
import { click, hum, chime, error as errSfx, isMuted, toggleMuted } from "./lib/sound";
import { celebrateFinalized } from "./lib/fx";
import {
  Wallet, RefreshCw, Sparkles, ShieldCheck, ShieldAlert, Volume2, VolumeX,
  Sliders, Activity, FileSignature, ArrowUp, ScanSearch, Coins, X, ChevronRight,
  Landmark, ArrowLeftRight, HandCoins,
} from "lucide-react";

function tierColor(status) {
  if (status === STATUS.APPROVED) return "#2fbf7a";
  if (status === STATUS.PARTIAL) return "#d6b25c";
  if (status === STATUS.REJECTED) return "#e06c75";
  if (status === STATUS.WITHDRAWN) return "#8ea3bd";
  return "#60d2d6"; // SCREENING
}

// Interactive payout & consensus simulator mirroring the on-chain run_audit math.
function Simulator() {
  const [score, setScore] = useState(82);
  const [endorsed, setEndorsed] = useState(2);
  const [redFlags, setRedFlags] = useState(0);
  const [requested, setRequested] = useState(120000);
  const [artifact, setArtifact] = useState(true);

  const tier = simulateTier(score, endorsed, redFlags, artifact, requested);
  const payout = tier.approvedPayout;

  return (
    <div className="simulator glass">
      <div className="sim-head">
        <Sliders size={16} className="accent" />
        <h3>Payout &amp; Consensus What-If Simulator</h3>
      </div>
      <p className="muted small">Preview the exact on-chain settlement math (5-point score grid, conviction modifier, unverified cap, funded tiers) before submitting a transaction. Validators must agree on the identical quantized score and the exact credited payout.</p>
      <div className="sim-body">
        <div className="sim-controls">
          <label className="slider">
            <span>Raw AI impact score <b>{score}</b></span>
            <input type="range" min="0" max="100" value={score} onChange={(e) => { setScore(Number(e.target.value)); click(); }} />
          </label>
          <label className="slider">
            <span>Conviction endorsements <b>{endorsed}</b></span>
            <input type="range" min="0" max="10" value={endorsed} onChange={(e) => { setEndorsed(Number(e.target.value)); click(); }} />
          </label>
          <label className="slider">
            <span>Red-flag challenges <b>{redFlags}</b></span>
            <input type="range" min="0" max="10" value={redFlags} onChange={(e) => { setRedFlags(Number(e.target.value)); click(); }} />
          </label>
          <label className="slider">
            <span>Requested grant <b>{requested.toLocaleString()}</b></span>
            <input type="range" min="100" max="5000000" step="100" value={requested} onChange={(e) => { setRequested(Number(e.target.value)); click(); }} />
          </label>
          <div className="toggles">
            <button type="button" className={`toggle ${artifact ? "on" : ""}`} onClick={() => { setArtifact(!artifact); hum(); }}>
              <ScanSearch size={14} /> artifact verified
            </button>
          </div>
        </div>
        <div className="sim-viz">
          <Gauge value={tier.impact} label="Quantized Impact" tone={tierColor(tier.status)} />
          <div className="tier-bar">
            <div className="tier-track">
              <span className="seg reject" style={{ width: "45%" }} />
              <span className="seg partial" style={{ width: "30%" }} />
              <span className="seg full" style={{ width: "25%" }} />
              <span className="marker" style={{ left: `${tier.impact}%` }} title={`impact ${tier.impact}`} />
            </div>
            <div className="tier-legend">
              <span>0-44 REJECTED</span><span>45-70 PARTIAL</span><span>75-100 APPROVED</span>
            </div>
          </div>
          <div className="sim-out">
            <div><span>Settlement status</span><b style={{ color: tierColor(tier.status) }}>{tier.status}</b></div>
            <div><span>Quantized score</span><b>{tier.impact}</b></div>
            <div><span>Exact approved payout</span><b>{payout.toLocaleString()} {TOKEN_SYMBOL}</b></div>
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
    project_title: "", public_good_category: "AI_RESEARCH", deliverable_manifest: "",
    proof_url: "", mandatory_artifact_token: "v2", requested_grant: 120000,
  });
  const [review, setReview] = useState({ pid: 1, handle: "sentinel-delegate", stance: "TECHNICAL_NOTE", rationale: "" });
  const [depositAmt, setDepositAmt] = useState(100000);
  const [xfer, setXfer] = useState({ to: "", amount: 1000 });

  const addLine = useCallback((line) => setLog((prev) => [...prev.slice(-60), line]), []);

  const refresh = useCallback(async () => {
    try {
      setModel(await readModel(address));
    } catch (e) {
      addLine(`read failed: ${String(e.message || e).slice(0, 90)}`);
    }
  }, [addLine, address]);

  useEffect(() => {
    setAddress(connectIdentity()?.address || null);
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

  // Adversarial guard test: invalid category must revert on-chain.
  const runGuard = useCallback(() => {
    setBusy(true);
    addLine("guard test: submitting invalid category (expect revert)");
    click();
    (async () => {
      const res = await write("submit_grant_proposal", [
        "Guard Probe", "EXPLOIT_CATEGORY", "x".repeat(20), "https://example.com/x", "v2", 999n,
      ]);
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
      project_title: "Open Zero-Knowledge Verifier Library",
      public_good_category: "PROTOCOL_INFRA",
      deliverable_manifest: "Audit-ready ZK verifier with 214 passing tests, deterministic circuit builders, and a public API. Sentinels should locate the token v2.",
      proof_url: "https://example.com/proof",
      mandatory_artifact_token: "v2",
      requested_grant: 120000,
    });
    hum();
    addLine("quick-fill populated the proposal form");
  };

  const switchTab = (t) => { setTab(t); hum(); };

  const proposals = useMemo(() => {
    const list = model ? Object.values(model.proposals).sort((a, b) => b.id - a.id) : [];
    return list.filter((p) => {
      if (tab === "active") return p.status === STATUS.SCREENING;
      if (tab === "approved") return p.status === STATUS.APPROVED || p.status === STATUS.PARTIAL;
      if (tab === "rejected") return p.status === STATUS.REJECTED || p.status === STATUS.WITHDRAWN;
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
            onClick={() => setMuted(toggleMuted())}
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
              <button className="ghost icon-btn" onClick={() => { switchToBurner(); setBurner(isBurnerActive()); setAddress(connectIdentity()?.address || address); hum(); }} title="Switch Identity: ephemeral burner">
                <Sparkles size={16} />
              </button>
              <button className="ghost icon-btn" onClick={() => { connectMetaMask().then((r) => { setAddress(r.address); setBurner(false); }).catch((e) => addLine(`metamask: ${String(e.message).slice(0, 60)}`)); }} title="Link MetaMask">
                <Wallet size={16} />
              </button>
              <button className="danger icon-btn" onClick={() => { disconnectIdentity(); setAddress(null); setBurner(false); click(); }} title="Disconnect">
                <X size={16} />
              </button>
            </>
          ) : (
            <button className="primary" onClick={() => { setAddress(connectIdentity()?.address || null); setBurner(isBurnerActive()); click(); }}>
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
              <div className="stat glass"><span>Custody Vault ({TOKEN_SYMBOL})</span><b>{model.vault_custody_balance.toLocaleString()}</b></div>
              <div className="stat glass"><span>Unclaimed Reserved Escrow</span><b>{model.total_allocated_unclaimed.toLocaleString()}</b></div>
              <div className="stat glass"><span>Unencumbered Custody</span><b>{model.unencumbered_custody.toLocaleString()}</b></div>
              <div className="stat glass"><span>Total Disbursed</span><b>{model.total_disbursed.toLocaleString()}</b></div>
              <div className="stat glass"><span>My Wallet ({TOKEN_SYMBOL})</span><b>{(model.wallet_balance || 0).toLocaleString()}</b></div>
              <div className="stat glass"><span>My Claimable</span><b>{(model.wallet_claimable || 0).toLocaleString()}</b></div>
            </div>
          )}

          <Simulator />

          <div className="tabs">
            {[["all", "All"], ["active", "Screening"], ["approved", "Funded"], ["rejected", "Rejected / Withdrawn"]].map(([k, lbl]) => (
              <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => switchTab(k)}>{lbl}</button>
            ))}
          </div>

          <section className="proposals">
            <h2><Activity size={16} className="accent" /> Proposals (live on-chain)</h2>
            {!model && <p className="muted">Loading on-chain state...</p>}
            {model && proposals.length === 0 && <p className="muted">No proposals in this view.</p>}
            {proposals.map((p) => {
              const reviews = Object.values(model.reviews).filter((r) => r.proposal_id === p.id);
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
                      <Gauge value={p.impact_score} label="Impact" size={128} tone={tierColor(p.status)} />
                    </div>
                    <dl className="kv">
                      <div><dt>Requested</dt><dd>{p.requested_tokens.toLocaleString()}</dd></div>
                      <div><dt>Approved payout</dt><dd>{p.credited_tokens.toLocaleString()}</dd></div>
                      <div><dt>Impact score</dt><dd>{p.impact_score}</dd></div>
                      <div><dt>Endorsements</dt><dd>{p.upvotes}</dd></div>
                      <div><dt>Red flags</dt><dd>{p.red_flags}</dd></div>
                      <div><dt>Reviews</dt><dd>{p.review_count}</dd></div>
                      <div><dt>Status</dt><dd style={{ color: tierColor(p.status) }}>{p.status}</dd></div>
                      <div><dt>Proof URL</dt><dd className="url" title={p.proof_url}>{p.proof_url}</dd></div>
                    </dl>
                  </div>
                  <p className="manifest">{p.grant_manifest}</p>
                  {reviews.length > 0 && (
                    <ul className="reviews">
                      {reviews.map((r) => (
                        <li key={r.id}>{r.handle || shortAddr(r.delegate)} · {r.stance}{r.contains_red_flag ? " · RED FLAG" : ""} · helpful {r.helpful} · {r.summary}</li>
                      ))}
                    </ul>
                  )}
                  <div className="row">
                    {p.status === STATUS.SCREENING && (
                      <button disabled={busy} className="ghost" onClick={() => run(() => write("audit_grant_live", [BigInt(p.id)]), `live audit #${p.id}`)}>
                        <ShieldCheck size={14} /> Live AI Audit
                      </button>
                    )}
                    {reviews.length > 0 && (
                      <button disabled={busy} className="ghost" onClick={() => run(() => write("upvote_delegate_review", [BigInt(reviews[0].id)]), `upvote review #${reviews[0].id}`)}>
                        <ArrowUp size={14} /> Upvote Review #{reviews[0].id}
                      </button>
                    )}
                    {(p.status === STATUS.APPROVED || p.status === STATUS.PARTIAL) && !p.claimed && address && p.applicant && p.applicant.toLowerCase() === address.toLowerCase() && (
                      <button disabled={busy} className="primary" onClick={() => run(() => write("claim_grant_payout", [BigInt(p.id)]), `claim payout #${p.id}`)}>
                        <HandCoins size={14} /> Claim Grant to Wallet
                      </button>
                    )}
                    {(p.status === STATUS.APPROVED || p.status === STATUS.PARTIAL) && p.claimed && (
                      <span className="chip">claimed</span>
                    )}
                    {p.status === STATUS.SCREENING && (
                      <button disabled={busy} className="ghost" onClick={() => run(() => write("withdraw_proposal", [BigInt(p.id)]), `withdraw #${p.id}`)}>
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
            <label>Project title<input value={form.project_title} onChange={setF("project_title")} placeholder="Public goods milestone" /></label>
            <label>Category<select value={form.public_good_category} onChange={setF("public_good_category")}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label>Deliverable manifest<textarea rows={3} value={form.deliverable_manifest} onChange={setF("deliverable_manifest")} placeholder="Plain text, no markup" /></label>
            <label>Proof URL<input value={form.proof_url} onChange={setF("proof_url")} placeholder="https://..." /></label>
            <div className="two">
              <label>Token<input value={form.mandatory_artifact_token} onChange={setF("mandatory_artifact_token")} /></label>
              <label>Requested grant<input type="number" value={form.requested_grant} onChange={setF("requested_grant")} /></label>
            </div>
            <div className="row wrap">
              <button className="ghost" onClick={quickFill} disabled={busy}><Sparkles size={14} /> Quick-Fill</button>
              <button className="danger" onClick={runGuard} disabled={busy}><ShieldAlert size={14} /> Test Security Guard</button>
              <button className="primary" disabled={busy} onClick={() => run(() => write("submit_grant_proposal", [form.project_title, form.public_good_category, form.deliverable_manifest, form.proof_url, form.mandatory_artifact_token, BigInt(Math.max(0, Math.floor(Number(form.requested_grant) || 0)))]), "submit proposal")}>
                Submit
              </button>
            </div>
          </section>

          <section className="glass panel">
            <h2><ShieldCheck size={16} className="accent" /> Submit Delegate Review</h2>
            <div className="two">
              <label>Proposal ID<input type="number" value={review.pid} onChange={setR("pid")} /></label>
              <label>Delegate handle<input value={review.handle} onChange={setR("handle")} /></label>
            </div>
            <label>Verdict stance<select value={review.stance} onChange={setR("stance")}>{STANCES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Rationale<textarea rows={2} value={review.rationale} onChange={setR("rationale")} placeholder="Delegate assessment" /></label>
            <div className="row">
              <button className="primary" disabled={busy} onClick={() => run(() => write("submit_delegate_review", [BigInt(Math.max(0, Math.floor(Number(review.pid) || 0))), review.handle, review.stance, review.rationale || "review"]), "submit review")}>
                Submit Review
              </button>
              <button className="ghost" disabled={busy} onClick={() => run(() => write("upvote_delegate_review", [BigInt(Math.max(0, Math.floor(Number(review.pid) || 0)))]), "upvote review")}>
                <ArrowUp size={14} /> Upvote (by ID)
              </button>
            </div>
          </section>

          <section className="glass panel">
            <h2><Landmark size={16} className="accent" /> Funded Custody &amp; SGT Transfers</h2>
            <p className="muted small">The vault holds real transferable Sentinel Grant Tokens. Deposit from your own wallet balance, claim an approved grant into your wallet, or move claimed SGT to any address.</p>
            <label>Fund custody amount ({TOKEN_SYMBOL})<input type="number" min="1" value={depositAmt} onChange={(e) => setDepositAmt(Number(e.target.value))} /></label>
            <div className="row">
              <button className="primary" disabled={busy || !address || depositAmt <= 0} onClick={() => run(() => write("deposit_treasury_funds", [BigInt(Math.floor(depositAmt))]), "fund custody")}>
                <Landmark size={14} /> Fund Treasury Custody
              </button>
            </div>
            <div className="two">
              <label>Transfer recipient<input value={xfer.to} onChange={(e) => setXfer({ ...xfer, to: e.target.value })} placeholder="0x..." /></label>
              <label>Amount ({TOKEN_SYMBOL})<input type="number" min="1" value={xfer.amount} onChange={(e) => setXfer({ ...xfer, amount: Number(e.target.value) })} /></label>
            </div>
            <div className="row">
              <button className="ghost" disabled={busy || !address || !xfer.to || xfer.amount <= 0} onClick={() => run(() => write("transfer_grant_tokens", [xfer.to, BigInt(Math.floor(xfer.amount))]), "transfer SGT")}>
                <ArrowLeftRight size={14} /> Transfer Claimed SGT
              </button>
            </div>
          </section>

          <section className="glass panel">
            <h2><Coins size={16} className="accent" /> On-Chain Custody &amp; Transfer Ledger</h2>
            <div className="ledger">
              {!model || model.receipts.length === 0 ? (
                <span className="muted">No custody movements recorded yet.</span>
              ) : (
                <ul>
                  {model.receipts.map((r) => (
                    <li key={r.id}>
                      <span className={`ledger-kind kind-${r.tx_type}`}>{r.tx_type.replace(/_/g, " ")}</span>
                      <b>{r.amount.toLocaleString()} {TOKEN_SYMBOL}</b>
                      <span className="muted small">{r.proposal_id ? `#${r.proposal_id} ` : ""}to {shortAddr(r.recipient)}</span>
                    </li>
                  ))}
                </ul>
              )}
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
        GrantSentinel · GenLayer Intelligent Contract on studionet (chain 61999) · every payout is gated by
        gl.nondet.web.render evidence and gl.eq_principle.prompt_comparative validator consensus on the exact credited
        amount, reserved from a funded custody vault and delivered to applicant wallets as transferable SGT.
      </footer>
    </div>
  );
}
