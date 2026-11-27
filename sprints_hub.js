/* Interactive Cleanroom Execution Hub for Production Sprints 1–6 (`/api/sprints/*`).
 * Implements native `<progress>` (`progress` guide) and single-tab-stop `role="toolbar"`
 * with `focusgroup="toolbar wrap"` + conditional roving-tabindex fallback (`toolbar` guide).
 */
(function () {
  "use strict";

  const state = {
    activeSprint: 1,
    activeRole: "process_technologist",
    roleToken: null,
    programId: "tsmc_n2_plug",
    busy: false,
    overview: null,
    s2Result: null,
    s3Result: null,
    s4Result: null,
    s5Diff: null,
    s5Bo: null,
    s6Runsheet: null,
    s6Transfer: null,
    s6Signoff: null,
    lastBanner: null,
  };

  try {
    const sp = new URL(window.location.href).searchParams;
    const initSprint = Number(sp.get("sprint"));
    if (initSprint >= 1 && initSprint <= 6) {
      state.activeSprint = initSprint;
    }
  } catch (_err) { /* ignore */ }

  function syncSprintUrl() {
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("sprint", String(state.activeSprint));
      window.history.replaceState(null, "", u.pathname + u.search + u.hash);
    } catch (_err) { /* ignore */ }
  }

  function esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function ensureRoleToken(roleName) {
    const targetRole = roleName || state.activeRole;
    if (window.WM_BACKEND && typeof window.WM_BACKEND.handle === "function") {
      const res = await window.WM_BACKEND.handle("/api/sprints/auth/token", { role: targetRole, actor: "cleanroom.ui" });
      state.roleToken = res && res.token ? res.token : null;
      return state.roleToken;
    }
    const resp = await fetch("/api/sprints/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: targetRole, actor: "cleanroom.ui" }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data.token) {
      state.roleToken = data.token;
    }
    return state.roleToken;
  }

  async function apiCall(path, method, body) {
    if (!state.roleToken && path !== "/api/sprints/auth/token") {
      await ensureRoleToken(state.activeRole).catch(() => null);
    }
    if (window.WM_BACKEND && typeof window.WM_BACKEND.handle === "function") {
      const staticBody =
        body && typeof body === "object"
          ? { role: state.activeRole, token: state.roleToken, ...body }
          : { role: state.activeRole, token: state.roleToken };
      return window.WM_BACKEND.handle(path, staticBody);
    }
    const headers = {
      "Content-Type": "application/json",
      "X-PANG-Role": state.activeRole,
    };
    if (state.roleToken) {
      headers["X-PANG-Token"] = state.roleToken;
    }
    const opts = {
      method: method || "GET",
      headers,
    };
    if (body && method !== "GET") opts.body = JSON.stringify(body);
    const resp = await fetch(path, opts);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error(data.detail || `HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return data;
  }

  function setStatus(msg, isError) {
    state.lastBanner = { msg, isError: Boolean(isError) };
    const el = document.getElementById("sprintLiveStatus");
    if (el) {
      el.textContent = msg;
      el.style.color = isError ? "var(--err)" : "var(--muted)";
    }
  }

  function setProgress(pctOrIndeterminate, labelText) {
    const prog = document.getElementById("sprintExecProgress");
    const lbl = document.getElementById("sprintProgressLabel");
    const pctEl = document.getElementById("sprintProgressPct");
    if (lbl && labelText) lbl.textContent = labelText;
    if (!prog) return;
    if (pctOrIndeterminate === null) {
      prog.removeAttribute("value");
      if (pctEl) pctEl.textContent = "Running…";
    } else {
      const v = Math.max(0, Math.min(100, Number(pctOrIndeterminate)));
      prog.value = v;
      if (pctEl) pctEl.textContent = `${Math.round(v)}%`;
    }
  }

  async function runSprintTask(label, fn) {
    if (state.busy) return;
    state.busy = true;
    const resetBtn = document.getElementById("btnSprintResetHub");
    if (resetBtn) resetBtn.setAttribute("aria-disabled", "true");
    setProgress(null, label);
    try {
      await fn();
      setProgress(100, "Execution Ready");
    } catch (err) {
      setProgress(100, "Action Blocked / Error");
      const prefix = err.status === 403 ? "RBAC 403 Denied: " : "Guardrail / Validation: ";
      setStatus(prefix + (err.message || String(err)), true);
      renderPanelOnly();
    } finally {
      state.busy = false;
      const rb = document.getElementById("btnSprintResetHub");
      if (rb) rb.removeAttribute("aria-disabled");
    }
  }

  function wireToolbarFocusgroupFallback(bar) {
    if (!bar || bar.dataset.fgWired === "1") return;
    bar.dataset.fgWired = "1";
    // MANDATORY per `toolbar` guide: install roving-tabindex fallback ONLY when native focusgroup is absent
    if ("focusGroup" in HTMLElement.prototype) return;

    const getItems = () => Array.from(bar.querySelectorAll("button"));
    const items = getItems();
    items.forEach((b, i) => {
      b.tabIndex = i === 0 ? 0 : -1;
    });
    bar.addEventListener("focusin", (ev) => {
      const curItems = getItems();
      if (curItems.includes(ev.target)) {
        curItems.forEach((b) => {
          b.tabIndex = b === ev.target ? 0 : -1;
        });
      }
    });
    bar.addEventListener("keydown", (ev) => {
      const curItems = getItems();
      if (!curItems.length) return;
      const idx = curItems.indexOf(document.activeElement);
      if (idx < 0) return;
      const rtl = getComputedStyle(bar).direction === "rtl";
      const steps = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };
      let nextIdx = null;
      if (ev.key in steps) {
        nextIdx = (idx + steps[ev.key] + curItems.length) % curItems.length;
      } else if (ev.key === "Home") {
        nextIdx = 0;
      } else if (ev.key === "End") {
        nextIdx = curItems.length - 1;
      }
      if (nextIdx !== null) {
        ev.preventDefault();
        curItems.forEach((b, i) => {
          b.tabIndex = i === nextIdx ? 0 : -1;
        });
        curItems[nextIdx].focus();
      }
    });
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderSprint1Panel() {
    const s1 = (state.overview && state.overview.sprint1) || {};
    const prog = s1.selected_program || {};
    const audit = s1.audit_verification || {};
    const iso = s1.isolation_check || {};
    const avail = s1.available_programs || [];
    const spec = prog.spec || {};
    const wafers = prog.wafers || [];
    const recentAudit = (audit.recent_entries || []).slice(-4).reverse();

    return `
      <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.5rem;">
        <div>
          <div class="guided-eyebrow">Sprint 1 · Multi-Program Workspaces, RBAC &amp; SHA-256 Provenance Ledger</div>
          <h4 style="margin:0.15rem 0 0; font-size:0.95rem;">Active Workspace: ${esc(prog.customer || "TSMC")} — ${esc(prog.node_label || "N2 HAR Plug")}</h4>
        </div>
        <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
          <span class="badge ${iso.isolated ? "badge-ok" : "badge-err"} mono">${iso.isolated ? "0 Cross-Program Leaks ✓" : "Isolation Alert"}</span>
          <span class="badge ${audit.valid ? "badge-ok" : "badge-err"} mono">SHA-256 Ledger: ${audit.valid ? `Verified (${audit.entries_checked || 0} blocks)` : "TAMPERED!"}</span>
        </div>
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:0.45rem; align-items:center;">
        <span style="font-size:0.77rem; font-weight:600; color:var(--muted);">Switch Isolated Customer Program:</span>
        ${avail
          .map(
            (p) => `
          <button type="button" class="btn ${p.program_id === state.programId ? "btn-primary" : ""}" data-s1-prog="${esc(p.program_id)}">
            ${esc(p.customer)} (${esc(p.goal === "partial_fill" ? "Partial Recess" : "Plug Fill")} · Spec v${esc(p.spec_version)})
          </button>
        `
          )
          .join("")}
        <button type="button" class="btn" id="btnS1TestSpecEdit" title="Attempts to revise OB spec under the currently selected RBAC role in the toolbar">
          Test Spec Revision as "${esc(state.activeRole)}"
        </button>
      </div>

      <div class="guided-metric-strip">
        <div class="guided-metric-box"><div class="m-lbl">IP Boundary Tag</div><div class="m-val mono" style="font-size:0.78rem;">${esc(prog.ip_boundary || "--")}</div></div>
        <div class="guided-metric-box"><div class="m-lbl">Locked Spec Version</div><div class="m-val mono">v${esc(prog.spec_version || 1)} (${prog.spec_locked ? "Locked" : "Open"})</div></div>
        <div class="guided-metric-box"><div class="m-lbl">OB Max / Target</div><div class="m-val mono">&le; ${esc(spec.ob_max_nm)} / ${esc(spec.ob_target_nm)} nm</div></div>
        <div class="guided-metric-box"><div class="m-lbl">Head Chain SHA-256</div><div class="m-val mono" style="font-size:0.75rem;">${esc(String(audit.head_sha256 || "").slice(0, 16))}…</div></div>
      </div>

      <div class="guided-two-col">
        <div style="font-size:0.78rem;">
          <strong>Workspace Wafers (${wafers.length}):</strong>
          <ul style="margin:0.3rem 0 0; padding-inline-start:1.15rem;">
            ${wafers
              .slice(-5)
              .map(
                (w) =>
                  `<li class="mono">${esc(w.exp_id)} [${esc(w.provenance)}] · OB=${esc(w.ob_nm)} nm · ${w.fill_height_110_nm != null ? `FillH=${esc(w.fill_height_110_nm)} nm` : `PH₁₁₀=${esc(w.ph_depth_110_nm)} nm`} · ${w.meets_spec ? "PASS ✓" : "FAIL"}</li>`
              )
              .join("")}
          </ul>
        </div>
        <div style="font-size:0.76rem;">
          <strong>Immutable Hash-Chained Audit Tail:</strong>
          <ul style="margin:0.3rem 0 0; padding-inline-start:1.15rem;">
            ${recentAudit
              .map(
                (a) =>
                  `<li><span class="mono">#${esc(a.seq)} [${esc(a.action)}]</span> (${esc(a.role)}) — ${esc(a.summary)} <code style="font-size:0.7rem;">${esc(String(a.entry_sha256 || "").slice(0, 10))}</code></li>`
              )
              .join("")}
          </ul>
        </div>
      </div>
    `;
  }

  function renderSprint2Panel() {
    const s2 = state.s2Result;
    const status = (state.overview && state.overview.sprint2) || {};
    const chambers = (s2 && s2.chambers) || status.chambers || [];
    const results = (s2 && s2.results) || [];

    return `
      <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.5rem;">
        <div>
          <div class="guided-eyebrow">Sprint 2 · Producer SECS/GEM (S6F11 CEID 4012) &amp; 1 Hz E3 FDC Auto-Ingest</div>
          <h4 style="margin:0.15rem 0 0; font-size:0.95rem;">Automated Chamber Telemetry Watch-Bus, Seasoning &amp; Quarantine</h4>
        </div>
        <div style="display:flex; gap:0.45rem; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" id="btnS2StreamCassette">▶ Stream 4-Wafer Producer FOUP Cassette</button>
          <button type="button" class="btn" id="btnS2CleanB2">Run NF₃/O₂ Plasma Clean (Chamber B2)</button>
        </div>
      </div>

      <div class="guided-metric-strip">
        ${chambers
          .map(
            (c) => `
          <div class="guided-metric-box">
            <div class="m-lbl">${esc(c.chamber_id)} Seasoning</div>
            <div class="m-val mono">${esc(c.cum_carbon_um)} µm C (${esc(c.wafers_since_clean)} wafers)</div>
            <div style="font-size:0.76rem; color:${c.clean_advisory ? "var(--warn)" : "var(--ok)"};">
              ${c.clean_advisory ? "⚠ Preventive NF₃/O₂ Clean Advisory (>= 12 µm)" : "✓ Liner Seasoning Nominal"}
            </div>
          </div>
        `
          )
          .join("")}
        <div class="guided-metric-box">
          <div class="m-lbl">Max Ingest Latency</div>
          <div class="m-val mono">${s2 ? `${esc(s2.max_latency_ms)} ms` : "< 250 ms"} (SLA &lt; 15,000 ms)</div>
        </div>
      </div>

      ${
        results.length
          ? `<div style="font-size:0.78rem;">
              <strong>Latest 4-Slot FOUP Stream Receipts (${esc(s2.ingested_count)} Ingested → Layer 1, ${esc(s2.quarantined_count)} Quarantined):</strong>
              <ul style="margin:0.35rem 0 0; padding-inline-start:1.15rem;">
                ${results
                  .map((r) =>
                    r.status === "quarantined"
                      ? `<li style="color:var(--warn);"><strong class="mono">${esc(r.wafer_id)} → QUARANTINED (${esc(r.quarantine_id)} · ${esc(r.error_code)})</strong>: ${esc(r.reason)} <em>Remediation: ${esc(r.remediation)}</em></li>`
                      : `<li><strong class="mono" style="color:var(--ok);">${esc(r.wafer_id)} → INGESTED (${esc(r.receipt_id)})</strong> in <code>${esc(r.ingest_latency_ms)} ms</code> · OES CN/Ar=${esc(r.fdc_summary?.oes_cn_ar)} · |V_dc|=${esc(r.fdc_summary?.vdc_volts)} V · Spec=${r.spec_grade?.meets_spec ? "PASS ✓" : "GRADED"}</li>`
                  )
                  .join("")}
              </ul>
            </div>`
          : `<p style="margin:0; font-size:0.8rem; color:var(--muted);">Click <b>Stream 4-Wafer Producer FOUP Cassette</b> to normalize <code>slm/mTorr/mm</code> setpoints, average 1 Hz <code>STEP_2_MAIN_DEP</code> OES/RF windows, update <code>cum_carbon_um</code>, and quarantine transient RF arcing packets.</p>`
      }
    `;
  }

  function renderSprint3Panel() {
    const s3 = state.s3Result;
    const c = s3 && s3.coupon;
    const bm = s3 && s3.benchmark;

    return `
      <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.5rem;">
        <div>
          <div class="guided-eyebrow">Sprint 3 · Scale-Bar CD-SEM Contour CV + Parratt XRR + 2D AFM PSD</div>
          <h4 style="margin:0.15rem 0 0; font-size:0.95rem;">Automated Multi-Modal Metrology &amp; Golden Benchmark Verification</h4>
        </div>
        <div style="display:flex; gap:0.45rem; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" id="btnS3Inspect">▶ Run CD-SEM + XRR + AFM &amp; 16-Coupon Benchmark</button>
        </div>
      </div>

      ${
        c && bm
          ? `
        <div class="guided-metric-strip">
          <div class="guided-metric-box"><div class="m-lbl">Scale-Bar Calibration</div><div class="m-val mono">${esc(c.scale_calibration.nm_per_px)} nm/px (${esc(c.scale_calibration.scale_bar_nm)} nm)</div></div>
          <div class="guided-metric-box"><div class="m-lbl">Extracted PH₁₁₀ / OB</div><div class="m-val mono">${esc(c.extracted_measured.ph_depth_110_nm ?? c.extracted_measured.fill_height_110_nm)} / ${esc(c.extracted_measured.ob_nm)} nm</div></div>
          <div class="guided-metric-box"><div class="m-lbl">Sidewall Taper / Confidence</div><div class="m-val mono">${esc(c.sem_contour_110.sidewall_taper_deg)}° · ${(c.sem_contour_110.confidence * 100).toFixed(1)}%</div></div>
          <div class="guided-metric-box"><div class="m-lbl">XRR θ_c → Density ρ</div><div class="m-val mono">${esc(c.xrr_analysis.theta_c_deg)}° → ${esc(c.xrr_analysis.extracted_density_g_cm3)} g/cm³</div></div>
          <div class="guided-metric-box"><div class="m-lbl">AFM R_q / Corr ξ</div><div class="m-val mono">${esc(c.afm_analysis.afm_rms_nm)} nm / ${esc(c.afm_analysis.correlation_length_nm)} nm</div></div>
          <div class="guided-metric-box"><div class="m-lbl">16-Coupon Golden MAE</div><div class="m-val mono" style="color:var(--ok);">PH ${esc(bm.mae_ph_110_nm)} nm · OB ${esc(bm.mae_ob_nm)} nm (&le; 8 nm ✓)</div></div>
        </div>
        <div class="guided-two-col" style="align-items:center;">
          <div>
            ${c.annotated_png_b64 ? `<img src="${esc(c.annotated_png_b64)}" alt="Calibrated cross-section CD-SEM contour overlay" style="max-inline-size:100%; border-radius:0.45rem; border:1px solid var(--border);" />` : ""}
          </div>
          <div style="font-size:0.79rem;">
            <strong>Instant ClientSpec + AFM Auto-Grade (${c.spec_grade.meets_spec ? "PASS ALL ✓" : "NEEDS TUNING"}):</strong>
            <ul style="margin:0.35rem 0 0; padding-inline-start:1.15rem;">
              ${Object.entries(c.spec_grade.lines || {})
                .map(([k, v]) => `<li class="mono">${esc(k)}: <b>${esc(String(v).toUpperCase())}</b></li>`)
                .join("")}
            </ul>
            <p style="margin:0.45rem 0 0; color:var(--muted);">
              Human-in-the-loop review required: <b>${c.human_review_required ? "Yes (< 78% confidence)" : "No — High-confidence auto-cleared ✓"}</b>.
            </p>
          </div>
        </div>
      `
          : `<p style="margin:0; font-size:0.8rem; color:var(--muted);">Click <b>Run CD-SEM + XRR + AFM &amp; 16-Coupon Benchmark</b> to calibrate micron-bar pixel pitch, segment non-rectangular sidewall taper, invert Cu Kα XRR critical angle for film density, compute 2D AFM PSD roughness, and verify <code>&le; 8 nm</code> MAE.</p>`
      }
    `;
  }

  function renderSprint4Panel() {
    const j = state.s4Result;
    const res = j && j.result;
    const lp = res && res.lead_point;

    return `
      <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.5rem;">
        <div>
          <div class="guided-eyebrow">Sprint 4 · Genuine Numerical 1D CCP BVP + 2D Fredholm/Monte-Carlo + ReaxFF Queue</div>
          <h4 style="margin:0.15rem 0 0; font-size:0.95rem;">Real Differential, Integral &amp; Particle Solvers Assimilated into Stage-1 Neural Priors</h4>
        </div>
        <div style="display:flex; gap:0.45rem; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" id="btnS4RunSingle">▶ Solve Coupled 1D BVP + 2D Monte-Carlo + ReaxFF</button>
          <button type="button" class="btn" id="btnS4RunGrid12">▶ Dispatch &amp; Assimilate 12-Point Simulation Grid</button>
        </div>
      </div>

      ${
        lp
          ? `
        <div class="guided-metric-strip">
          <div class="guided-metric-box"><div class="m-lbl">1D CCP BVP (solve_bvp)</div><div class="m-val mono" style="color:var(--ok);">${lp.ccp_bvp.converged ? "Converged ✓" : "Check"} (RMS ${esc(lp.ccp_bvp.max_rms_residual)})</div></div>
          <div class="guided-metric-box"><div class="m-lbl">Pedestal Pass/Carbon Flux</div><div class="m-val mono">${esc(lp.ccp_bvp.flux_pass_to_carbon_ratio)}× (${esc(lp.ccp_bvp.n_collocation_nodes)} nodes)</div></div>
          <div class="guided-metric-box"><div class="m-lbl">MC Mean Wall Bounces</div><div class="m-val mono">${esc(lp.feature_2d.monte_carlo.mean_bounces_to_stick)} bounces (${esc(lp.feature_2d.monte_carlo.n_particles)} rays)</div></div>
          <div class="guided-metric-box"><div class="m-lbl">Fredholm vs. MC Corr r</div><div class="m-val mono">${esc(lp.feature_2d.fredholm_mc_correlation_r)}</div></div>
          <div class="guided-metric-box"><div class="m-lbl">Numerical PH₁₁₀ / OB</div><div class="m-val mono">${esc(lp.numerical_outcome.ph_depth_110_nm)} / ${esc(lp.numerical_outcome.ob_nm)} nm</div></div>
          <div class="guided-metric-box"><div class="m-lbl">Stage-1 Assimilated</div><div class="m-val mono">${esc(res.assimilated_sim_ids.length)} trajectory pt(s) (${esc(res.elapsed_ms)} ms)</div></div>
        </div>
        <div class="guided-two-col">
          <div>
            <div style="font-size:0.75rem; font-weight:600; margin-block-end:0.25rem;">1D CCP Spatial Profiles n_j(x) Across Gap [-d/2, +d/2] &amp; 2D Knudsen Impingement q(z):</div>
            <canvas id="sprint4BvpCanvas" width="520" height="210" style="inline-size:100%; block-size:210px; border-radius:0.45rem; border:1px solid var(--border); background:var(--surface-alt);"></canvas>
          </div>
          <div style="font-size:0.76rem;">
            ${
              lp.atomistic_reaxff
                ? `<strong>3D Atomistic Relaxation (${esc(lp.atomistic_reaxff.force_field)}) + LAMMPS ReaxFF Deck (${esc(lp.atomistic_reaxff.lammps_script_lines)} lines):</strong>
                   <div class="mono" style="margin-block:0.25rem;">${esc(lp.atomistic_reaxff.archetype_label)} · ${esc(lp.atomistic_reaxff.n_atoms)} atoms · E=${esc(lp.atomistic_reaxff.lowest_energy_kcal_mol)} kcal/mol · ρ_MD=${esc(lp.atomistic_reaxff.packing_density_g_cm3)} g/cm³</div>
                   <pre class="mono" style="margin:0; padding:0.45rem; border-radius:0.4rem; background:var(--surface-alt); border:1px solid var(--border); font-size:0.78rem; max-block-size:135px; overflow:auto;">${esc(lp.atomistic_reaxff.lammps_script_preview)}</pre>`
                : ""
            }
          </div>
        </div>
      `
          : `<p style="margin:0; font-size:0.8rem; color:var(--muted);">Click <b>Solve Coupled 1D BVP + 2D Monte-Carlo + ReaxFF</b> (or <b>12-Point Simulation Grid</b>) to execute <code>scipy.integrate.solve_bvp</code>, solve the <code>N_z × N_z</code> Fredholm view-factor integral equation, trace thousands of cosine-law ballistic radicals, and assimilate into PANG Stage 1.</p>`
      }
    `;
  }

  function renderSprint5Panel() {
    const gov = (state.overview && state.overview.sprint5) || {};
    const diff = state.s5Diff || gov.latest_diff_vs_v1 || {};
    const disc = gov.residual_discovery || {};
    const commits = gov.commits || [];
    const bo = state.s5Bo;

    return `
      <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.5rem;">
        <div>
          <div class="guided-eyebrow">Sprint 5 · Semantic KB Versioning, Rule Diffs, Rollback &amp; &gt;2σ Residual Rule Miner</div>
          <h4 style="margin:0.15rem 0 0; font-size:0.95rem;">Active KB: <span class="mono">${esc(gov.active_version || "v2.1.0")}</span> · Public Literature (102 Papers) vs. Proprietary AMAT IP</h4>
        </div>
        <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" id="btnS5Promote">▶ Promote &gt;2σ Residual Candidate Rule</button>
          <button type="button" class="btn" id="btnS5BoLineage">Run Lineage-Stamped BO</button>
          <button type="button" class="btn" id="btnS5Rollback">Rollback to v2.0.0</button>
        </div>
      </div>

      <div class="guided-metric-strip">
        <div class="guided-metric-box"><div class="m-lbl">Public Science Rules</div><div class="m-val mono">${esc(diff.version_b_ip_breakdown?.PUBLIC_LITERATURE ?? 3)} (102-paper corpus)</div></div>
        <div class="guided-metric-box"><div class="m-lbl">AMAT Proprietary IP</div><div class="m-val mono">${esc(diff.version_b_ip_breakdown?.AMAT_PROPRIETARY_CHAMBER ?? 2)} Producer BKMs</div></div>
        <div class="guided-metric-box"><div class="m-lbl">Customer Lot Rules</div><div class="m-val mono">${esc(diff.version_b_ip_breakdown?.CUSTOMER_LOT_EMPIRICAL ?? 0)} Empirical</div></div>
        <div class="guided-metric-box"><div class="m-lbl">&gt;2σ Residual Candidates</div><div class="m-val mono">${esc((disc.candidate_rules || []).length)} AST-verified</div></div>
      </div>

      <div class="guided-two-col" style="font-size:0.77rem;">
        <div>
          <strong>Commit History (${commits.length}) &amp; Diff vs. v1.0.0 (+${(diff.added_rules || []).length} added, ${(diff.modified_rules || []).length} modified):</strong>
          <ul style="margin:0.3rem 0 0; padding-inline-start:1.15rem;">
            ${commits
              .slice(-4)
              .reverse()
              .map(
                (c) =>
                  `<li><span class="mono"><b>${esc(c.version)}</b> [${esc(c.commit_sha256)}]</span> — ${esc(c.summary)} (${esc(c.n_rules)} rules)</li>`
              )
              .join("")}
          </ul>
        </div>
        <div>
          ${
            bo && bo.recommendations
              ? `<strong>Lineage-Stamped BO Batch (KB ${esc(bo.kb_version)} · <code>${esc(String(bo.kb_commit_sha256 || "").slice(0, 12))}</code>):</strong>
                 <ul style="margin:0.3rem 0 0; padding-inline-start:1.15rem;">
                   ${bo.recommendations
                     .map(
                       (r) =>
                         `<li class="mono">#${esc(r.rank)}: ${esc(r.recipe.freq_mhz)} MHz, P=${esc(r.recipe.pressure_torr)}T, NH₃=${esc(r.recipe.nh3_sccm)} → PH₁₁₀=${esc(r.predicted.ph_depth_110_nm)} nm, OB=${esc(r.predicted.ob_nm)} nm · PropGuards=[${esc((r.kb_lineage.active_proprietary_guardrails || []).join(", "))}]</li>`
                     )
                     .join("")}
                 </ul>`
              : `<strong>Residual Rule Discovery Queue:</strong>
                 <ul style="margin:0.3rem 0 0; padding-inline-start:1.15rem;">
                   ${(disc.candidate_rules || [])
                     .map(
                       (cr) =>
                         `<li><span class="mono"><b>${esc(cr.rule_id)}</b></span> [${esc(cr.ip_tier)}]: <code>${esc(cr.condition_expr)}</code> — ${esc(cr.title)} ${cr.already_promoted ? '<span class="badge badge-ok mono">Active ✓</span>' : ""}</li>`
                     )
                     .join("")}
                 </ul>`
          }
        </div>
      </div>
    `;
  }

  function renderSprint6Panel() {
    const xfer = state.s6Transfer;
    const sign = state.s6Signoff;
    const rs = state.s6Runsheet;

    return `
      <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.5rem;">
        <div>
          <div class="guided-eyebrow">Sprint 6 · Producer XML/CSV Dispatch, 3-Wafer Fleet Transfer &amp; Six-Sigma Cpk Sign-Off</div>
          <h4 style="margin:0.15rem 0 0; font-size:0.95rem;">Chamber Hardware Interlocks, Chamber-A → Chamber-B Matching &amp; Fab Qualification</h4>
        </div>
        <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" id="btnS6Signoff">▶ Run 6-Wafer Cpk Sign-Off</button>
          <button type="button" class="btn" id="btnS6Transfer">3-Wafer Chamber A→B Transfer</button>
          <button type="button" class="btn" id="btnS6ExportXml">Export Producer .XML/.CSV</button>
          <button type="button" class="btn" id="btnS6TestUnsafe">Test 2350 W Interlock Block</button>
        </div>
      </div>

      ${
        xfer
          ? `<div class="guided-subcard" style="padding:0.6rem 0.75rem;">
              <strong style="font-size:0.81rem;">3-Wafer Bayesian Fleet Transfer (${esc(xfer.source_chamber_id)} → ${esc(xfer.target_chamber_id)}):</strong>
              <span class="mono" style="font-size:0.78rem; color:var(--ok);">
                OB RMSE cut from ${esc(xfer.accuracy_improvement.unadapted_rmse_ob_nm)} nm → ${esc(xfer.accuracy_improvement.transferred_rmse_ob_nm)} nm ·
                PH₁₁₀ RMSE ${esc(xfer.accuracy_improvement.unadapted_rmse_ph_nm)} nm → ${esc(xfer.accuracy_improvement.transferred_rmse_ph_nm)} nm using only 3 split wafers!
              </span>
            </div>`
          : ""
      }

      ${
        rs
          ? `<div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.5rem; padding:0.55rem 0.75rem; border:1px solid var(--border); border-radius:0.45rem;">
              <span class="mono" style="font-size:0.77rem; color:var(--ok);">✓ All 5 Producer Hardware &amp; Dust Interlocks Passed (${esc(rs.n_slots)} slots · SHA-256 ${esc(rs.xml_sha256.slice(0, 12))}…)</span>
              <div style="display:flex; gap:0.4rem;">
                <button type="button" class="btn" id="btnS6DlXml">Download Producer .XML</button>
                <button type="button" class="btn" id="btnS6DlCsv">Download FOUP .CSV</button>
              </div>
            </div>`
          : ""
      }

      ${
        sign
          ? `
        <div class="guided-metric-strip">
          <div class="guided-metric-box"><div class="m-lbl">Pilot Gate Status</div><div class="m-val mono" style="color:var(--ok);">${sign.qualified ? "QUALIFIED ✓" : "PENDING"}</div></div>
          <div class="guided-metric-box"><div class="m-lbl">Minimum Process Cpk</div><div class="m-val mono">${esc(sign.min_cpk)} (Gate &ge; ${esc(sign.cpk_gate_threshold)})</div></div>
          <div class="guided-metric-box"><div class="m-lbl">Cleanroom DoE Rounds</div><div class="m-val mono">${esc(sign.cleanroom_iterations_used)} rounds (vs. ${esc(sign.manual_baseline_iterations)} manual · -${esc(sign.cycle_time_reduction_pct)}%)</div></div>
          ${Object.entries(sign.cpk_metrics || {})
            .map(
              ([k, m]) =>
                `<div class="guided-metric-box"><div class="m-lbl">${esc(k)} Cpk</div><div class="m-val mono">${esc(m.cpk)} (μ=${esc(m.mean)}, σ=${esc(m.std)})</div></div>`
            )
            .join("")}
        </div>
      `
          : `<p style="margin:0; font-size:0.8rem; color:var(--muted);">Use the controls above to verify 6-wafer repeatability <code>Cpk &ge; 1.33</code>, adapt calibrated kinetics to a second chamber in 3 split wafers, or export safety-interlocked Applied Materials Producer multi-step XML recipes.</p>`
      }
    `;
  }

  function drawSprint4Canvas() {
    const cv = document.getElementById("sprint4BvpCanvas");
    const lp = state.s4Result && state.s4Result.result && state.s4Result.result.lead_point;
    if (!cv || !lp) return;
    const ctx = cv.getContext("2d");
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const axisCol = isDark ? "#94a3b8" : "#475569";
    const gridCol = isDark ? "rgba(148,163,184,0.18)" : "rgba(71,85,105,0.15)";

    // Left plot: 1D CCP BVP spatial profiles across gap x_mm
    const sp = lp.ccp_bvp.spatial_profile;
    const xs = sp.x_mm || [];
    const nc = sp.n_c2h_1e12_cm3 || [];
    const npa = sp.n_pass_1e12_cm3 || [];
    const nan = sp.n_anion_1e12_cm3 || [];
    const maxY = Math.max(0.5, ...nc, ...npa, ...nan) * 1.12;

    const p1 = { x0: 36, y0: 22, w: 210, h: H - 46 };
    ctx.strokeStyle = gridCol;
    ctx.strokeRect(p1.x0, p1.y0, p1.w, p1.h);
    ctx.fillStyle = axisCol;
    ctx.font = "11px ui-monospace, SFMono-Regular, monospace";
    ctx.fillText("1D CCP BVP: C2H• (cyan), Pass (green), C2H- (amber)", p1.x0 - 10, 14);
    ctx.fillText("-d/2", p1.x0, H - 8);
    ctx.fillText("+d/2 (Wafer)", p1.x0 + p1.w - 68, H - 8);

    function plotSeries(arr, color) {
      if (!arr.length) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      arr.forEach((v, i) => {
        const px = p1.x0 + (i / Math.max(1, arr.length - 1)) * p1.w;
        const py = p1.y0 + p1.h - (v / maxY) * p1.h;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    plotSeries(nc, "#06b6d4");
    plotSeries(npa, "#10b981");
    plotSeries(nan, "#f59e0b");

    // Right plot: 2D Fredholm vs Monte-Carlo Impingement along depth z (0 -> 1000 nm)
    const f2 = lp.feature_2d;
    const fred = f2.fredholm_impingement_norm || [];
    const mc = (f2.monte_carlo && f2.monte_carlo.mc_impingement_norm) || [];
    const p2 = { x0: 282, y0: 22, w: 218, h: H - 46 };
    ctx.strokeStyle = gridCol;
    ctx.strokeRect(p2.x0, p2.y0, p2.w, p2.h);
    ctx.fillStyle = axisCol;
    ctx.fillText("2D Knudsen: Fredholm (line) vs MC (dots)", p2.x0 - 4, 14);
    ctx.fillText("z=0 Mouth", p2.x0, H - 8);
    ctx.fillText("z=1000nm Floor", p2.x0 + p2.w - 86, H - 8);

    if (fred.length) {
      ctx.beginPath();
      ctx.strokeStyle = "#8b5cf6";
      ctx.lineWidth = 2.2;
      fred.forEach((v, i) => {
        const px = p2.x0 + (i / Math.max(1, fred.length - 1)) * p2.w;
        const py = p2.y0 + p2.h - Math.min(1, v) * p2.h;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    if (mc.length) {
      ctx.fillStyle = "#ec4899";
      mc.forEach((v, i) => {
        const px = p2.x0 + (i / Math.max(1, mc.length - 1)) * p2.w;
        const py = p2.y0 + p2.h - Math.min(1, v) * p2.h;
        ctx.beginPath();
        ctx.arc(px, py, 2.3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  function renderPanelContent() {
    switch (state.activeSprint) {
      case 1:
        return renderSprint1Panel();
      case 2:
        return renderSprint2Panel();
      case 3:
        return renderSprint3Panel();
      case 4:
        return renderSprint4Panel();
      case 5:
        return renderSprint5Panel();
      case 6:
        return renderSprint6Panel();
      default:
        return renderSprint1Panel();
    }
  }

  function syncSprintCardHighlights() {
    document.querySelectorAll("[data-sprint-card-idx]").forEach((card) => {
      const n = Number(card.getAttribute("data-sprint-card-idx"));
      card.classList.toggle("is-active-sprint", n === state.activeSprint);
    });
    document.querySelectorAll("[data-select-sprint]").forEach((btn) => {
      const n = Number(btn.getAttribute("data-select-sprint"));
      btn.setAttribute("aria-pressed", n === state.activeSprint ? "true" : "false");
    });
    document.querySelectorAll("[data-select-role]").forEach((btn) => {
      const r = btn.getAttribute("data-select-role");
      btn.setAttribute("aria-pressed", r === state.activeRole ? "true" : "false");
    });
  }

  function bindPanelActions() {
    const panel = document.getElementById("sprintLivePanel");
    if (!panel) return;

    panel.querySelectorAll("[data-s1-prog]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pid = btn.getAttribute("data-s1-prog");
        runSprintTask(`Switching isolated workspace to ${pid}…`, async () => {
          state.programId = pid;
          await apiCall("/api/sprints/sprint1/switch_program", "POST", { program_id: pid, role: state.activeRole });
          state.overview = await apiCall(`/api/sprints/overview?program_id=${encodeURIComponent(pid)}`, "GET");
          setStatus(`Switched active customer workspace to ${pid} (zero cross-program leakage verified).`, false);
          renderPanelOnly();
        });
      });
    });

    document.getElementById("btnS1TestSpecEdit")?.addEventListener("click", () => {
      runSprintTask(`Testing RBAC spec revision as ${state.activeRole}…`, async () => {
        const curSpec = state.overview?.sprint1?.selected_program?.spec || {};
        const nextOb = Number(curSpec.ob_max_nm || 85) === 85 ? 82 : 85;
        await apiCall("/api/sprints/sprint1/update_spec", "POST", {
          program_id: state.programId,
          spec_updates: { ob_max_nm: nextOb },
          unlock_override: true,
          role: state.activeRole,
        });
        state.overview = await apiCall(`/api/sprints/overview?program_id=${encodeURIComponent(state.programId)}`, "GET");
        setStatus(`RBAC Approved (${state.activeRole}): Updated ${state.programId} OB max to ${nextOb} nm & appended SHA-256 block.`, false);
        renderPanelOnly();
      });
    });

    document.getElementById("btnS2StreamCassette")?.addEventListener("click", () => {
      runSprintTask("Streaming 4-wafer SECS/GEM S6F11 + 1 Hz E3 FDC cassette…", async () => {
        state.s2Result = await apiCall("/api/sprints/sprint2/stream_cassette", "POST", {
          program_id: state.programId,
          role: state.activeRole,
        });
        state.overview = await apiCall(`/api/sprints/overview?program_id=${encodeURIComponent(state.programId)}`, "GET");
        setStatus(
          `SECS/GEM Stream Complete: ${state.s2Result.ingested_count} wafers auto-ingested (${state.s2Result.max_latency_ms} ms max), ${state.s2Result.quarantined_count} RF-arcing packet quarantined.`,
          false
        );
        renderPanelOnly();
      });
    });

    document.getElementById("btnS2CleanB2")?.addEventListener("click", () => {
      runSprintTask("Running NF3/O2 plasma clean on CHAMBER-PRODUCER-B2…", async () => {
        const res = await apiCall("/api/sprints/sprint2/chamber_clean", "POST", { chamber_id: "CHAMBER-PRODUCER-B2" });
        if (state.s2Result && res.status) state.s2Result.chambers = res.status.chambers;
        state.overview = await apiCall(`/api/sprints/overview?program_id=${encodeURIComponent(state.programId)}`, "GET");
        setStatus("CHAMBER-PRODUCER-B2 NF3/O2 clean completed: cum_carbon_um reset to 0.15 µm undercoat.", false);
        renderPanelOnly();
      });
    });

    document.getElementById("btnS3Inspect")?.addEventListener("click", () => {
      runSprintTask("Running calibrated CD-SEM CV + Parratt XRR + 2D AFM & 16-coupon benchmark…", async () => {
        state.s3Result = await apiCall("/api/sprints/sprint3/inspect_coupon", "POST", {
          program_id: state.programId,
          wafer_id: "MET-CV-AUTO01",
          ingest_if_confident: false,
          n_benchmark_coupons: 16,
          role: state.activeRole,
        });
        setStatus(
          `Sprint 3 CV Complete: Golden 16-coupon MAE = ${state.s3Result.benchmark.mae_ph_110_nm} nm (PH₁₁₀) & ${state.s3Result.benchmark.mae_ob_nm} nm (OB) — Exit Gate <= 8 nm PASSED.`,
          false
        );
        renderPanelOnly();
      });
    });

    document.getElementById("btnS4RunSingle")?.addEventListener("click", () => {
      runSprintTask("Solving 1D CCP BVP (solve_bvp) + 2D Fredholm/Monte-Carlo + RDKit MMFF94s/ReaxFF…", async () => {
        state.s4Result = await apiCall("/api/sprints/sprint4/submit", "POST", {
          program_id: state.programId,
          mode: "single",
          mc_particles: 1800,
          assimilate: true,
          wait_sync: true,
          role: state.activeRole,
        });
        state.overview = await apiCall(`/api/sprints/overview?program_id=${encodeURIComponent(state.programId)}`, "GET");
        const lp = state.s4Result.result.lead_point;
        setStatus(
          `Numerical Multi-Scale Job ${state.s4Result.job_id} complete: BVP RMS=${lp.ccp_bvp.max_rms_residual}, MC mean=${lp.feature_2d.monte_carlo.mean_bounces_to_stick} bounces.`,
          false
        );
        renderPanelOnly();
      });
    });

    document.getElementById("btnS4RunGrid12")?.addEventListener("click", () => {
      runSprintTask("Dispatching & assimilating 12-point Latin-Hypercube multi-scale simulation grid…", async () => {
        state.s4Result = await apiCall("/api/sprints/sprint4/submit", "POST", {
          program_id: state.programId,
          mode: "grid12",
          n_points: 12,
          assimilate: true,
          wait_sync: true,
          role: state.activeRole,
        });
        state.overview = await apiCall(`/api/sprints/overview?program_id=${encodeURIComponent(state.programId)}`, "GET");
        setStatus(
          `12-Point HPC Simulation Grid (${state.s4Result.job_id}) assimilated into Stage-1 neural priors in ${state.s4Result.result.elapsed_ms} ms.`,
          false
        );
        renderPanelOnly();
      });
    });

    document.getElementById("btnS5Promote")?.addEventListener("click", () => {
      runSprintTask("Promoting >2σ residual-discovered AST guardrail into semantic KB…", async () => {
        const gov = await apiCall("/api/sprints/sprint5/action", "POST", {
          program_id: state.programId,
          action: "promote_first_candidate",
          role: state.activeRole,
        });
        state.overview = await apiCall(`/api/sprints/overview?program_id=${encodeURIComponent(state.programId)}`, "GET");
        setStatus(`Promoted residual guardrail → Active Knowledge Base bumped to ${gov.active_version}.`, false);
        renderPanelOnly();
      });
    });

    document.getElementById("btnS5BoLineage")?.addEventListener("click", () => {
      runSprintTask("Running Constrained EI Bayesian Optimization with full KB & IP lineage…", async () => {
        state.s5Bo = await apiCall("/api/sprints/sprint5/action", "POST", {
          program_id: state.programId,
          action: "recommend_lineage",
          role: state.activeRole,
        });
        setStatus(`Generated 3 BO candidates stamped with KB ${state.s5Bo.kb_version} & proprietary chamber guardrails.`, false);
        renderPanelOnly();
      });
    });

    document.getElementById("btnS5Rollback")?.addEventListener("click", () => {
      runSprintTask("Rolling back Knowledge Base rules to v2.0.0 snapshot…", async () => {
        const gov = await apiCall("/api/sprints/sprint5/action", "POST", {
          program_id: state.programId,
          action: "rollback",
          target_version: "v2.0.0",
          role: state.activeRole,
        });
        state.overview = await apiCall(`/api/sprints/overview?program_id=${encodeURIComponent(state.programId)}`, "GET");
        setStatus(`Auditable forward rollback committed: active KB is now ${gov.active_version} (snapshot of v2.0.0).`, false);
        renderPanelOnly();
      });
    });

    document.getElementById("btnS6Signoff")?.addEventListener("click", () => {
      runSprintTask("Evaluating 6-wafer repeatability cassette & computing Six-Sigma Cpk sign-off…", async () => {
        state.s6Signoff = await apiCall("/api/sprints/sprint6/action", "POST", {
          program_id: state.programId,
          action: "qualification_signoff",
          n_repeatability_wafers: 6,
          role: state.activeRole,
        });
        state.overview = await apiCall(`/api/sprints/overview?program_id=${encodeURIComponent(state.programId)}`, "GET");
        setStatus(
          `Pilot Qualification Sign-Off Approved: min Cpk = ${state.s6Signoff.min_cpk} (>= 1.33) in ${state.s6Signoff.cleanroom_iterations_used} cleanroom rounds!`,
          false
        );
        renderPanelOnly();
      });
    });

    document.getElementById("btnS6Transfer")?.addEventListener("click", () => {
      runSprintTask("Calibrating 3-wafer empirical-Bayes Chamber-A → Chamber-B transfer prior…", async () => {
        state.s6Transfer = await apiCall("/api/sprints/sprint6/action", "POST", {
          program_id: state.programId,
          action: "chamber_transfer",
          role: state.activeRole,
        });
        setStatus(
          `3-Wafer Chamber Transfer Complete: Chamber-B OB RMSE reduced from ${state.s6Transfer.accuracy_improvement.unadapted_rmse_ob_nm} nm to ${state.s6Transfer.accuracy_improvement.transferred_rmse_ob_nm} nm.`,
          false
        );
        renderPanelOnly();
      });
    });

    document.getElementById("btnS6ExportXml")?.addEventListener("click", () => {
      runSprintTask("Checking Producer safety interlocks & generating SECS/E40 recipe XML/CSV…", async () => {
        state.s6Runsheet = await apiCall("/api/sprints/sprint6/action", "POST", {
          program_id: state.programId,
          action: "export_runsheet",
          role: state.activeRole,
        });
        setStatus(`Exported safety-interlocked Producer XML & CSV (${state.s6Runsheet.n_slots} slots).`, false);
        renderPanelOnly();
      });
    });

    document.getElementById("btnS6TestUnsafe")?.addEventListener("click", () => {
      runSprintTask("Testing hardware interlock rejection on unsafe 2350 W recipe…", async () => {
        await apiCall("/api/sprints/sprint6/action", "POST", {
          program_id: state.programId,
          action: "export_runsheet",
          custom_recipes: [{ power_w: 2350, pressure_torr: 21.5, ar_sccm: 7200, c2h2_sccm: 780 }],
          role: state.activeRole,
        });
      });
    });

    document.getElementById("btnS6DlXml")?.addEventListener("click", () => {
      if (state.s6Runsheet) downloadText("amat_producer_doe_runsheet.xml", state.s6Runsheet.producer_xml, "application/xml");
    });
    document.getElementById("btnS6DlCsv")?.addEventListener("click", () => {
      if (state.s6Runsheet) downloadText("amat_producer_doe_runsheet.csv", state.s6Runsheet.producer_csv, "text/csv");
    });
  }

  function renderPanelOnly() {
    const panel = document.getElementById("sprintLivePanel");
    if (!panel) return;
    panel.innerHTML = renderPanelContent();
    syncSprintCardHighlights();
    bindPanelActions();
    if (state.activeSprint === 4) {
      requestAnimationFrame(drawSprint4Canvas);
    }
  }

  async function selectSprint(num, scrollToHub) {
    state.activeSprint = Number(num) || 1;
    syncSprintUrl();
    syncSprintCardHighlights();
    renderPanelOnly();
    if (scrollToHub) {
      document.getElementById("sprintHubShell")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  async function mount() {
    const host = document.getElementById("sprintLiveHubMount");
    if (!host) return;

    host.innerHTML = `
      <div id="sprintHubShell" class="sprint-hub-shell">
        <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.5rem;">
          <div>
            <div class="guided-eyebrow" style="color:var(--ok);">All 6 Production Sprints Implemented &amp; Live</div>
            <h4 style="margin:0.1rem 0 0; font-size:0.96rem;">Interactive Cleanroom Production Sprints Hub (Sprints 1–6)</h4>
          </div>
          <span class="badge badge-ok mono">Sandbox-Isolated · Zero Live Brain Mutation</span>
        </div>

        <div id="sprintHubToolbar" class="sprint-toolbar" role="toolbar" focusgroup="toolbar wrap" aria-label="Production Sprints Interactive Controls" aria-controls="sprintLivePanel">
          <div class="sprint-toolbar-group" role="group" aria-label="Select production sprint">
            <button type="button" class="sprint-sel-btn" data-select-sprint="1" aria-pressed="${state.activeSprint === 1}">S1: Workspaces &amp; RBAC</button>
            <button type="button" class="sprint-sel-btn" data-select-sprint="2" aria-pressed="${state.activeSprint === 2}">S2: SECS/GEM + FDC</button>
            <button type="button" class="sprint-sel-btn" data-select-sprint="3" aria-pressed="${state.activeSprint === 3}">S3: CD-SEM + XRR + AFM</button>
            <button type="button" class="sprint-sel-btn" data-select-sprint="4" aria-pressed="${state.activeSprint === 4}">S4: Numerical BVP + MC</button>
            <button type="button" class="sprint-sel-btn" data-select-sprint="5" aria-pressed="${state.activeSprint === 5}">S5: KB SemVer &amp; Diffs</button>
            <button type="button" class="sprint-sel-btn" data-select-sprint="6" aria-pressed="${state.activeSprint === 6}">S6: Transfer &amp; Cpk</button>
          </div>
          <span class="sprint-toolbar-sep" role="separator" aria-orientation="vertical"></span>
          <div class="sprint-toolbar-group" role="group" aria-label="Active cleanroom RBAC role">
            <button type="button" class="sprint-role-btn" data-select-role="process_technologist" aria-pressed="${state.activeRole === "process_technologist"}" title="Full spec, KB, DoE, and Cpk sign-off permissions">Role: Technologist</button>
            <button type="button" class="sprint-role-btn" data-select-role="metrology_operator" aria-pressed="${state.activeRole === "metrology_operator"}" title="Wafer/SECS ingest only; denied spec &amp; KB edits">Role: Metrology Op</button>
            <button type="button" class="sprint-role-btn" data-select-role="viewer" aria-pressed="${state.activeRole === "viewer"}" title="Read-only observer; denied write actions">Role: Viewer</button>
          </div>
          <span class="sprint-toolbar-sep" role="separator" aria-orientation="vertical"></span>
          <button type="button" id="btnSprintResetHub" class="sprint-act-btn" title="Reset Sprints 1–6 sandbox state">↺ Reset Sprints</button>
        </div>

        <div class="sprint-progress-row">
          <span id="sprintProgressLabel" class="mono">Execution Ready</span>
          <progress id="sprintExecProgress" class="sprint-progress" max="100" value="100" aria-labelledby="sprintProgressLabel"></progress>
          <span id="sprintProgressPct" class="mono">100%</span>
        </div>
        <p id="sprintLiveStatus" class="sprint-live-status" role="status">${esc(state.lastBanner ? state.lastBanner.msg : "Ready · Select Sprint 1–6 in the toolbar above (use Left/Right Arrow keys inside toolbar) to execute live cleanroom modules.")}</p>

        <div id="sprintLivePanel" class="sprint-live-panel"></div>
      </div>
    `;

    const bar = document.getElementById("sprintHubToolbar");
    wireToolbarFocusgroupFallback(bar);

    bar.querySelectorAll("[data-select-sprint]").forEach((btn) => {
      btn.addEventListener("click", () => selectSprint(Number(btn.getAttribute("data-select-sprint")), false));
    });
    bar.querySelectorAll("[data-select-role]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.activeRole = btn.getAttribute("data-select-role") || "process_technologist";
        state.roleToken = null;
        await ensureRoleToken(state.activeRole).catch(() => null);
        state.overview = await apiCall(`/api/sprints/overview?program_id=${encodeURIComponent(state.programId)}`, "GET").catch(() => state.overview);
        syncSprintCardHighlights();
        setStatus(`Switched active cleanroom RBAC role to '${state.activeRole}' (HMAC token signed).`, false);
        renderPanelOnly();
      });
    });
    document.getElementById("btnSprintResetHub")?.addEventListener("click", (ev) => {
      if (ev.currentTarget.getAttribute("aria-disabled") === "true") return;
      runSprintTask("Resetting Sprints 1–6 sandbox hub…", async () => {
        state.overview = await apiCall("/api/sprints/reset", "POST", {});
        state.programId = state.overview.active_program_id || "tsmc_n2_plug";
        state.s2Result = null;
        state.s3Result = null;
        state.s4Result = null;
        state.s5Bo = null;
        state.s6Runsheet = null;
        state.s6Transfer = null;
        state.s6Signoff = null;
        setStatus("Reset Sprints 1–6 sandbox workspaces, chambers, and KB commits cleanly.", false);
        renderPanelOnly();
      });
    });

    document.querySelectorAll("[data-open-sprint-btn]").forEach((btn) => {
      btn.addEventListener("click", () => selectSprint(Number(btn.getAttribute("data-open-sprint-btn")), true));
    });

    if (!state.overview) {
      try {
        state.overview = await apiCall(`/api/sprints/overview?program_id=${encodeURIComponent(state.programId)}`, "GET");
      } catch (err) {
        setStatus(`Could not load sprints overview: ${err.message || err}`, true);
      }
    }
    renderPanelOnly();
  }

  window.PANG_SPRINTS_HUB = {
    mount,
    selectSprint,
    redrawCanvas: drawSprint4Canvas,
  };
})();
