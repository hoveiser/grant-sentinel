import { useCallback, useEffect, useMemo, useState } from "react";
import {
  readClient,
  writeClient,
  getOrCreateBurner,
  rotateBurner,
  connectMetaMask,
  providerClient,
  read,
  write,
  toNum,
} from "./gl.js";
import {
  CONTRACT_ADDRESS,
  EXPLORER_URL,
  CATEGORIES,
  STANCES,
  INITIAL_TREASURY,
  simulateTier,
} from "./config.js";

const PRESET = {
  project_title: "Open-Source ZK Verifier Toolkit",
  public_good_category: "DEVELOPER_TOOLS",
  deliverable_manifest:
    "Ship a permissively licensed ZK verifier with docs, property tests and CI, published for public audit.",
  proof_url: "https://github.com/grantsentinel/proof-of-work",
  mandatory_artifact_token: "SENTINEL-ART-2026",
  requested_grant: 120000,
};

function short(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "\u2026" + addr.slice(-4);
}

export default function App() {
  const [identity, setIdentity] = useState({ kind: "none", address: null });
  const [account, setAccount] = useState(null); // burner viem account or provider info
  const [summary, setSummary] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [claimable, setClaimable] = useState(0);
  const [openReviews, setOpenReviews] = useState({});
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);

  // simulator state
  const [simScore, setSimScore] = useState(80);
  const [simEndorse, setSimEndorse] = useState(1);
  const [simFlags, setSimFlags] = useState(0);
  const [simGrant, setSimGrant] = useState(120000);

  // forms
  const [form, setForm] = useState(PRESET);
  const [reviewForm, setReviewForm] = useState({
    proposal_id: 1,
    delegate_handle: "delegate-oveis",
    verdict_stance: "ENDORSE_CONVICTION",
    rationale: "Reproducible build and tests pass; deliverable matches the manifest.",
  });

  const pushLog = useCallback((entry) => {
    setLog((prev) => [{ ts: Date.now(), ...entry }, ...prev].slice(0, 24));
  }, []);

  const refresh = useCallback(async () => {
    const rc = readClient();
    try {
      const [s, ps, lb] = await Promise.all([
        read(rc, "get_sentinel_summary", []),
        read(rc, "get_all_proposals", []),
        read(rc, "get_delegate_leaderboard", []),
      ]);
      setSummary(s);
      setProposals(ps || []);
      setLeaderboard(lb || []);
      if (identity.address) {
        const c = await read(rc, "get_claimable_grant", [identity.address]);
        setClaimable(toNum(c));
      }
    } catch (e) {
      pushLog({ kind: "error", msg: `refresh failed: ${e.message}` });
    }
  }, [identity.address, pushLog]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activateBurner = () => {
    const acc = getOrCreateBurner();
    setAccount(acc);
    setIdentity({ kind: "burner", address: acc.address });
    pushLog({ kind: "ok", msg: `burner delegate wallet active: ${acc.address}` });
  };

  const switchIdentity = () => {
    if (identity.kind === "burner") {
      setIdentity({ kind: "none", address: null });
      setAccount(null);
      pushLog({ kind: "info", msg: "identity cleared; activate a burner or connect MetaMask" });
    } else {
      activateBurner();
    }
  };

  const rotate = () => {
    const acc = rotateBurner();
    setAccount(acc);
    setIdentity({ kind: "burner", address: acc.address });
    pushLog({ kind: "ok", msg: `new burner identity: ${acc.address}` });
  };

  const useMetaMask = async () => {
    try {
      const { provider, address } = await connectMetaMask();
      setAccount({ provider, address });
      setIdentity({ kind: "metamask", address });
      pushLog({ kind: "ok", msg: `MetaMask connected: ${address}` });
    } catch (e) {
      pushLog({ kind: "error", msg: `MetaMask connect failed: ${e.message}` });
    }
  };

  const activeWriteClient = () => {
    if (identity.kind === "burner") return writeClient(account);
    if (identity.kind === "metamask") return providerClient(account.provider, account.address);
    return null;
  };

  const runWrite = async (label, fn, args) => {
    const client = activeWriteClient();
    if (!client) {
      pushLog({ kind: "error", msg: "activate a wallet identity first" });
      return;
    }
    setBusy(true);
    pushLog({ kind: "info", msg: `submitting ${label}...` });
    try {
      const res = await write(client, fn, args);
      pushLog({
        kind: res.finalized && res.success ? "ok" : "error",
        msg: `${label}: ${res.statusName}${res.success ? " / SUCCESS" : " / execution failed"}`,
        hash: res.hash,
      });
      await refresh();
    } catch (e) {
      pushLog({ kind: "error", msg: `${label} failed: ${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  const submitProposal = () =>
    runWrite("submit_grant_proposal", "submit_grant_proposal", [
      form.project_title,
      form.public_good_category,
      form.deliverable_manifest,
      form.proof_url,
      form.mandatory_artifact_token,
      BigInt(form.requested_grant),
    ]);

  const submitReview = () =>
    runWrite("submit_delegate_review", "submit_delegate_review", [
      BigInt(reviewForm.proposal_id),
      reviewForm.delegate_handle,
      reviewForm.verdict_stance,
      reviewForm.rationale,
    ]);

  const upvote = (reviewId) =>
    runWrite("upvote_delegate_review", "upvote_delegate_review", [BigInt(reviewId)]);

  const auditLive = (pid) =>
    runWrite("audit_grant_live", "audit_grant_live", [BigInt(pid)]);

  const withdraw = (pid) =>
    runWrite("withdraw_proposal", "withdraw_proposal", [BigInt(pid)]);

  const claim = () => runWrite("claim_grant_payout", "claim_grant_payout", []);

  const loadReviews = async (pid) => {
    const rc = readClient();
    const revs = await read(rc, "get_proposal_reviews", [BigInt(pid)]);
    setOpenReviews((prev) => ({ ...prev, [pid]: revs || [] }));
  };

  const toggleReviews = (pid) => {
    if (openReviews[pid]) {
      setOpenReviews((prev) => {
        const copy = { ...prev };
        delete copy[pid];
        return copy;
      });
    } else {
      loadReviews(pid);
    }
  };

  const sim = useMemo(
    () => simulateTier(simScore, simEndorse, simFlags, simGrant),
    [simScore, simEndorse, simFlags, simGrant]
  );

  const treasuryUsed = summary ? INITIAL_TREASURY - toNum(summary.treasury_budget) : 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="GrantSentinel logo" className="logo" />
          <div>
            <h1>GrantSentinel</h1>
            <p className="sub">AI-Audited Public Goods &amp; Milestone Grant Allocator</p>
          </div>
        </div>
        <div className="net">
          <span className="badge">studionet &#183; 61999</span>
          <a className="addr" href={`${EXPLORER_URL}/tx`} target="_blank" rel="noreferrer" title={CONTRACT_ADDRESS}>
            {short(CONTRACT_ADDRESS)}
          </a>
        </div>
      </header>

      <section className="wallet card">
        <div className="wallet-left">
          <span className="label">Identity</span>
          {identity.kind === "none" && <span className="id-none">Not connected</span>}
          {identity.kind === "burner" && <span className="id-ok">Burner delegate &#183; {short(identity.address)}</span>}
          {identity.kind === "metamask" && <span className="id-ok">MetaMask &#183; {short(identity.address)}</span>}
          {claimable > 0 && <span className="claim-chip">{claimable.toLocaleString()} units claimable</span>}
        </div>
        <div className="wallet-right">
          <button className="btn primary" onClick={activateBurner} disabled={identity.kind === "burner"}>
            1-Click Burner Wallet
          </button>
          <button className="btn" onClick={switchIdentity}>Switch Identity</button>
          <button className="btn" onClick={rotate} disabled={identity.kind !== "burner"}>Rotate Burner</button>
          <button className="btn" onClick={useMetaMask}>Connect MetaMask</button>
          <button className="btn accent" onClick={claim} disabled={busy || !identity.address}>Claim Grant Payout</button>
        </div>
      </section>

      <section className="metrics">
        <Metric label="Treasury Budget" value={(toNum(summary?.treasury_budget)).toLocaleString()} />
        <Metric label="Granted Out" value={treasuryUsed.toLocaleString()} />
        <Metric label="Proposals" value={toNum(summary?.proposal_count)} />
        <Metric label="Reviews" value={toNum(summary?.review_count)} />
        <Metric label="Approved" value={toNum(summary?.approved_count)} tone="ok" />
        <Metric label="Partial" value={toNum(summary?.partial_count)} tone="warn" />
        <Metric label="Rejected" value={toNum(summary?.rejected_count)} tone="bad" />
        <Metric label="Screening" value={toNum(summary?.screening_count)} />
      </section>

      <section className="grid">
        <div className="card sim">
          <h2>Impact &amp; Tranche Simulator</h2>
          <p className="hint">
            Visualizes the deterministic disbursement rules: impact score plus the community
            conviction modifier maps to APPROVED_FUNDED (100%), PARTIAL_GRANT (proportional) or
            REJECTED (0%).
          </p>
          <Slider label="Impact score" min={0} max={100} value={simScore} onChange={setSimScore} />
          <Slider label="Conviction endorsements" min={0} max={10} value={simEndorse} onChange={setSimEndorse} />
          <Slider label="Red-flag challenges" min={0} max={10} value={simFlags} onChange={setSimFlags} />
          <Slider label="Requested grant" min={100} max={5000000} step={100} value={simGrant} onChange={setSimGrant} />
          <div className="sim-out">
            <div>
              <span className="label">Adjusted impact</span>
              <span className="big">{sim.impact}</span>
            </div>
            <div>
              <span className="label">Projected tier</span>
              <span className={`tier ${tierClass(sim.status)}`}>{sim.status}</span>
            </div>
            <div>
              <span className="label">Projected payout</span>
              <span className="big">{sim.payout.toLocaleString()}</span>
            </div>
          </div>
          <div className="bar">
            <div className={`bar-fill ${tierClass(sim.status)}`} style={{ width: `${sim.impact}%` }} />
          </div>
        </div>

        <div className="card submit">
          <h2>Submit Grant Proposal</h2>
          <Field label="Project title">
            <input value={form.project_title} onChange={(e) => setForm({ ...form, project_title: e.target.value })} />
          </Field>
          <Field label="Public good category">
            <select value={form.public_good_category} onChange={(e) => setForm({ ...form, public_good_category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Deliverable manifest">
            <textarea rows={3} value={form.deliverable_manifest} onChange={(e) => setForm({ ...form, deliverable_manifest: e.target.value })} />
          </Field>
          <Field label="Proof URL">
            <input value={form.proof_url} onChange={(e) => setForm({ ...form, proof_url: e.target.value })} />
          </Field>
          <Field label="Mandatory artifact token">
            <input value={form.mandatory_artifact_token} onChange={(e) => setForm({ ...form, mandatory_artifact_token: e.target.value })} />
          </Field>
          <Field label="Requested grant (100..5000000)">
            <input type="number" value={form.requested_grant} onChange={(e) => setForm({ ...form, requested_grant: Number(e.target.value) })} />
          </Field>
          <div className="row">
            <button className="btn" onClick={() => setForm(PRESET)}>Quick-Fill Preset</button>
            <button className="btn primary" onClick={submitProposal} disabled={busy}>Submit Proposal</button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Delegate Screening</h2>
        <div className="grid-3">
          <Field label="Proposal ID">
            <input type="number" value={reviewForm.proposal_id} onChange={(e) => setReviewForm({ ...reviewForm, proposal_id: Number(e.target.value) })} />
          </Field>
          <Field label="Delegate handle">
            <input value={reviewForm.delegate_handle} onChange={(e) => setReviewForm({ ...reviewForm, delegate_handle: e.target.value })} />
          </Field>
          <Field label="Verdict stance">
            <select value={reviewForm.verdict_stance} onChange={(e) => setReviewForm({ ...reviewForm, verdict_stance: e.target.value })}>
              {STANCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Rationale">
          <textarea rows={2} value={reviewForm.rationale} onChange={(e) => setReviewForm({ ...reviewForm, rationale: e.target.value })} />
        </Field>
        <button className="btn primary" onClick={submitReview} disabled={busy}>Submit Delegate Review</button>
      </section>

      <section className="card">
        <h2>Live Grant Board</h2>
        <table className="board">
          <thead>
            <tr>
              <th>#</th><th>Project</th><th>Category</th><th>Requested</th>
              <th>Endorse</th><th>Flags</th><th>Score</th><th>Status</th><th>Payout</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((p) => {
              const pid = toNum(p.proposal_id);
              return (
                <tr key={pid}>
                  <td>{pid}</td>
                  <td>{p.project_title}</td>
                  <td>{p.public_good_category}</td>
                  <td>{toNum(p.requested_grant).toLocaleString()}</td>
                  <td>{toNum(p.conviction_endorsements)}</td>
                  <td>{toNum(p.red_flag_challenges)}</td>
                  <td>{toNum(p.verified_impact_score)}</td>
                  <td><span className={`tier ${tierClass(p.status)}`}>{p.status}</span></td>
                  <td>{toNum(p.approved_payout).toLocaleString()}</td>
                  <td className="actions">
                    <button className="mini" onClick={() => toggleReviews(pid)}>
                      {openReviews[pid] ? "hide" : "reviews"}
                    </button>
                    {p.status === "SCREENING" && (
                      <button className="mini audit" onClick={() => auditLive(pid)} disabled={busy}>AI audit</button>
                    )}
                    {p.status === "SCREENING" && (
                      <button className="mini" onClick={() => withdraw(pid)} disabled={busy}>withdraw</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {Object.entries(openReviews).map(([pid, revs]) => (
          <div key={pid} className="reviews">
            <h3>Reviews for proposal #{pid}</h3>
            {(!revs || revs.length === 0) && <p className="hint">No reviews yet.</p>}
            {(revs || []).map((r) => (
              <div key={toNum(r.review_id)} className="review">
                <span className={`stance ${stanceClass(r.verdict_stance)}`}>{r.verdict_stance}</span>
                <strong>{r.delegate_handle}</strong>
                <span className="votes">helpful {toNum(r.helpful_votes)}</span>
                <p>{r.rationale}</p>
                <button className="mini" onClick={() => upvote(toNum(r.review_id))} disabled={busy}>Upvote</button>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="grid">
        <div className="card">
          <h2>Delegate Leaderboard</h2>
          <ul className="lb">
            {leaderboard.slice(0, 10).map((d) => (
              <li key={d.delegate}>
                <span>{short(d.delegate)}</span>
                <span className="rep">{toNum(d.reputation)} rep</span>
              </li>
            ))}
            {leaderboard.length === 0 && <li className="hint">No delegate activity yet.</li>}
          </ul>
        </div>
        <div className="card">
          <h2>Transaction Log</h2>
          <ul className="log">
            {log.map((e, i) => (
              <li key={i} className={e.kind}>
                <span>{e.msg}</span>
                {e.hash && (
                  <a href={`${EXPLORER_URL}/tx/${e.hash}`} target="_blank" rel="noreferrer">{short(e.hash)}</a>
                )}
              </li>
            ))}
            {log.length === 0 && <li className="hint">Actions will appear here.</li>}
          </ul>
        </div>
      </section>

      <footer className="foot">
        GrantSentinel &#183; GenLayer Intelligent Contract on studionet &#183; frontend is a
        convenience layer; the contract is the source of truth.
      </footer>
    </div>
  );
}

function tierClass(status) {
  if (status === "APPROVED_FUNDED") return "ok";
  if (status === "PARTIAL_GRANT") return "warn";
  if (status === "REJECTED") return "bad";
  if (status === "WITHDRAWN") return "muted";
  return "screen";
}

function stanceClass(stance) {
  if (stance === "ENDORSE_CONVICTION") return "ok";
  if (stance === "RED_FLAG_CHALLENGE") return "bad";
  return "screen";
}

function Metric({ label, value, tone }) {
  return (
    <div className={`metric ${tone || ""}`}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Slider({ label, min, max, step = 1, value, onChange }) {
  return (
    <label className="slider">
      <span className="label">{label}: <b>{Number(value).toLocaleString()}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
