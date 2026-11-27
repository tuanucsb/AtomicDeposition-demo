/* ==========================================================================
 * Guided 8-Step Product Workflow Controller (`static/guided_workflow.js`)
 *
 * Implements:
 *   - Mode toggle between Clean Guided Product Flow (Steps 0–8) & Full 6-Tab Workbench
 *   - Accessible Popover Toggletips (`popover="hint"`, `interestfor`, `popovertarget`)
 *   - Interactive Step 0 (4-Layer Pyramid + 6-Sprint Product Roadmap) through Step 8
 *   - High-DPI Process Mechanism Figures (Step 4B Cross-Sections & Regime Map, Step 8 Trajectory)
 *   - Works seamlessly on both Live FastAPI Server (`127.0.0.1:8765`) & Static Bundle
 * ========================================================================== */
(() => {
  "use strict";

  const IS_STATIC = Boolean(window.WM_BACKEND);
  const STEP_ORDER = ["0", "1", "2", "3", "4A", "4B", "5", "6", "7", "8"];

  let wfState = null;
  let activeStep = "0";
  let tipSeq = 0;
  const ownedToggletipTriggers = new WeakSet();

  const qs = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (v) => esc(v).replace(/`([^`]+)`/g, "<code>$1</code>");

  function toast(msg) {
    if (window.PANGStudioBridge && window.PANGStudioBridge.showToast) {
      window.PANGStudioBridge.showToast(msg);
      return;
    }
    const el = qs("#toastBanner");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 4800);
  }

  // ------------------------------------------------------------------------
  // Modern Popover Hint & Toggletip Wiring (`interest-triggered-tooltips`)
  // ------------------------------------------------------------------------
  (function installPopoverHintListenersOnce() {
    if (typeof document === "undefined") return;

    // Where `popover="hint"` is unsupported and defaults to `"manual"`, switch toggletips
    // to `"auto"` inside capturing `beforetoggle` so click-opened toggletips light-dismiss.
    const probe = document.createElement("div");
    probe.popover = "hint";
    if (probe.popover !== "hint") {
      document.addEventListener(
        "beforetoggle",
        (ev) => {
          const target = ev.target;
          if (!target || typeof target.getAttribute !== "function") return;
          const isToggletip =
            target.getAttribute("popover") === "hint" &&
            target.id &&
            document.querySelector(`[popovertarget="${CSS.escape(target.id)}"]`);
          if (ev.newState === "open" && isToggletip) {
            target.popover = "auto";
          }
        },
        true
      );
    }

    // Sync `aria-expanded` from capturing `toggle` listener (`toggle` does not bubble).
    document.addEventListener(
      "toggle",
      (ev) => {
        const pop = ev.target;
        if (!pop || !pop.id) return;
        const isOpen = ev.newState === "open" || (pop.matches && pop.matches(":popover-open"));
        qsa(`[interestfor="${CSS.escape(pop.id)}"]`).forEach((trig) => {
          if (ownedToggletipTriggers.has(trig)) {
            trig.setAttribute("aria-expanded", isOpen ? "true" : "false");
          }
        });
      },
      true
    );

    // Lightweight offline-safe hover/focus fallback when native `interestForElement` is absent
    if (typeof HTMLButtonElement !== "undefined" && !("interestForElement" in HTMLButtonElement.prototype)) {
      let hideTimer = null;
      let currentPop = null;

      const openHint = (btn) => {
        const id = btn.getAttribute("interestfor");
        if (!id) return;
        const pop = document.getElementById(id);
        if (!pop || typeof pop.showPopover !== "function") return;
        clearTimeout(hideTimer);
        if (currentPop && currentPop !== pop) {
          try { currentPop.hidePopover(); } catch (_) { /* ignore */ }
        }
        try {
          pop.showPopover({ source: btn });
        } catch (_) {
          try { pop.showPopover(); } catch (_2) { /* ignore */ }
        }
        btn.classList.add("interest-source");
        pop.classList.add("interest-target");
        currentPop = pop;
      };

      const scheduleClose = (btn, pop) => {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          if (btn) btn.classList.remove("interest-source");
          if (pop) {
            pop.classList.remove("interest-target");
            try { pop.hidePopover(); } catch (_) { /* ignore */ }
          }
          if (currentPop === pop) currentPop = null;
        }, 160);
      };

      document.addEventListener("pointerover", (ev) => {
        const trig = ev.target && ev.target.closest ? ev.target.closest("[interestfor]") : null;
        if (trig) {
          openHint(trig);
          return;
        }
        const insidePop = ev.target && ev.target.closest ? ev.target.closest(".term-popover") : null;
        if (insidePop && insidePop === currentPop) {
          clearTimeout(hideTimer);
        }
      });

      document.addEventListener("pointerout", (ev) => {
        const trig = ev.target && ev.target.closest ? ev.target.closest("[interestfor]") : null;
        if (trig) {
          const pop = document.getElementById(trig.getAttribute("interestfor") || "");
          scheduleClose(trig, pop);
          return;
        }
        const insidePop = ev.target && ev.target.closest ? ev.target.closest(".term-popover") : null;
        if (insidePop) {
          const owner = insidePop.id ? document.querySelector(`[interestfor="${CSS.escape(insidePop.id)}"]`) : null;
          scheduleClose(owner, insidePop);
        }
      });

      document.addEventListener("focusin", (ev) => {
        const trig = ev.target && ev.target.closest ? ev.target.closest("[interestfor]") : null;
        if (trig) openHint(trig);
      });

      document.addEventListener("focusout", (ev) => {
        const trig = ev.target && ev.target.closest ? ev.target.closest("[interestfor]") : null;
        if (trig) {
          const pop = document.getElementById(trig.getAttribute("interestfor") || "");
          scheduleClose(trig, pop);
        }
      });
    }
  })();

  function wireHintPopovers(rootEl = document) {
    rootEl.querySelectorAll("[interestfor]").forEach((trig) => {
      const id = trig.getAttribute("interestfor");
      if (!id) return;
      const hint = document.getElementById(id);
      if (!hint || hint.getAttribute("popover") !== "hint") return;

      const trigName = (
        trig.getAttribute("aria-label") ||
        trig.textContent ||
        trig.getAttribute("title") ||
        ""
      ).replace(/\s+/g, " ").trim();
      const hintText = (hint.textContent || "").replace(/\s+/g, " ").trim();
      if (trigName && trigName === hintText) return;

      if (!hint.hasAttribute("role")) {
        hint.setAttribute("role", "tooltip");
      }

      if (!trigName) {
        if (!trig.hasAttribute("aria-labelledby")) {
          trig.setAttribute("aria-labelledby", id);
        }
      } else if (trig.getAttribute("popovertarget") === id || trig.getAttribute("commandfor") === id) {
        if (!trig.hasAttribute("aria-expanded")) {
          const openNow = Boolean(hint.matches && hint.matches(":popover-open"));
          trig.setAttribute("aria-expanded", openNow ? "true" : "false");
          ownedToggletipTriggers.add(trig);
        }
      } else if (!trig.hasAttribute("aria-describedby")) {
        trig.setAttribute("aria-describedby", id);
      }
    });
  }

  function tip(glossaryKey, customLabel) {
    const g = (wfState && wfState.glossary && wfState.glossary[glossaryKey]) || null;
    const label = customLabel || (g ? g.term : glossaryKey);
    if (!g) return esc(label);
    tipSeq += 1;
    const popId = `gtip-${glossaryKey}-${tipSeq}`;
    return `<span class="term-wrap"><span class="term-text">${esc(label)}</span><button type="button" class="term-tip-btn" interestfor="${popId}" popovertarget="${popId}" popovertargetaction="show" aria-label="Definition of ${esc(g.term)}">?</button><div id="${popId}" popover="hint" class="term-popover"><div class="term-popover-inner"><div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;"><strong>${esc(g.term)}</strong><span class="badge mono">${esc(g.category)}</span></div><p>${esc(g.definition)}</p></div></div></span>`;
  }

  // ------------------------------------------------------------------------
  // API Helper (Supports Live Server + Static Browser Bundle)
  // ------------------------------------------------------------------------
  async function wfCall(path, method = "GET", body = null, isFormData = false) {
    if (IS_STATIC && window.WM_BACKEND && typeof window.WM_BACKEND.handle === "function") {
      return window.WM_BACKEND.handle(path, body);
    }
    const opts = { method };
    if (body !== null) {
      if (isFormData) {
        opts.body = body;
      } else {
        opts.headers = { "Content-Type": "application/json" };
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return data;
  }

  async function runAction(btn, fn) {
    const orig = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Working…";
    }
    try {
      await fn();
    } catch (err) {
      toast(`Action error: ${err.message || err}`);
    } finally {
      if (btn && btn.isConnected) {
        btn.disabled = false;
        btn.textContent = orig;
      }
    }
  }

  function syncGuidedUrl(mode, stepId) {
    try {
      const u = new URL(window.location.href);
      if (mode === "workbench") {
        u.searchParams.set("mode", "workbench");
        u.searchParams.delete("step");
        u.searchParams.delete("sprint");
        const selTab = document.querySelector('.tablist-scroller [role="tab"][aria-selected="true"]');
        if (selTab && selTab.id) {
          u.searchParams.set("tab", selTab.id.replace(/^tab-/, ""));
        }
      } else {
        u.searchParams.set("mode", "guided");
        u.searchParams.set("step", stepId || activeStep || "0");
        u.searchParams.delete("tab");
        if ((stepId || activeStep) !== "0") {
          u.searchParams.delete("sprint");
        }
      }
      window.history.replaceState(null, "", u.pathname + u.search + u.hash);
    } catch (_err) { /* ignore */ }
  }

  // ------------------------------------------------------------------------
  // View Mode Switcher (Guided Product Flow vs. Full 6-Tab Workbench)
  // ------------------------------------------------------------------------
  function setInterfaceMode(mode, opts = {}) {
    const guidedEl = qs("#guidedProductStudio");
    const benchEl = qs("#advancedWorkbenchWrapper");
    const advHdr = qs("#advancedHeaderControls");
    const btnGuided = qs("#btnModeGuided");
    const btnBench = qs("#btnModeWorkbench");
    const isGuided = mode !== "workbench";

    if (guidedEl) guidedEl.hidden = !isGuided;
    if (benchEl) benchEl.hidden = isGuided;
    if (advHdr) advHdr.style.display = isGuided ? "none" : "inline-flex";
    if (btnGuided) btnGuided.setAttribute("aria-pressed", isGuided ? "true" : "false");
    if (btnBench) btnBench.setAttribute("aria-pressed", isGuided ? "false" : "true");

    if (!opts.skipUrl) {
      syncGuidedUrl(isGuided ? "guided" : "workbench", activeStep);
    }

    if (!isGuided && window.PANGStudioBridge) {
      const hasGuidedRuns = Boolean(wfState && wfState.session && (wfState.session.loaded_dataset_id || Number(wfState.session.current_round || 0) > 0));
      if ((opts.preferSandbox || hasGuidedRuns) && typeof window.PANGStudioBridge.switchWorkspace === "function") {
        window.PANGStudioBridge.switchWorkspace("sandbox");
      } else if (typeof window.PANGStudioBridge.refreshWorkbench === "function") {
        window.PANGStudioBridge.refreshWorkbench();
      }
      requestAnimationFrame(() => {
        window.PANGStudioBridge.drawAllCanvases();
      });
    } else if (isGuided) {
      requestAnimationFrame(drawStepCanvases);
    }
  }

  function updateStepperBar() {
    const done = new Set((wfState && wfState.session && wfState.session.completed_steps) || ["0"]);
    qsa("[data-guided-step]").forEach((btn) => {
      const s = btn.getAttribute("data-guided-step");
      const isCurrent = s === activeStep;
      if (isCurrent) {
        btn.setAttribute("aria-current", "step");
      } else {
        btn.removeAttribute("aria-current");
      }
      const isDone = done.has(s) && s !== "0";
      btn.classList.toggle("is-done", isDone);
      const dot = btn.querySelector(".step-dot");
      if (dot) {
        dot.textContent = isDone && !isCurrent ? "✓" : s;
      }
    });
  }

  function goToStep(stepId, opts = {}) {
    activeStep = STEP_ORDER.includes(stepId) ? stepId : "0";
    if (!opts.skipUrl) {
      syncGuidedUrl("guided", activeStep);
    }
    updateStepperBar();
    renderCurrentStep();
  }

  // ------------------------------------------------------------------------
  // Step Renderers (Steps 0 through 8)
  // ------------------------------------------------------------------------
  function passFailBadge(status) {
    if (status === "pass") return '<span class="badge badge-ok mono">PASS</span>';
    if (status === "fail") return '<span class="badge badge-err mono">FAIL</span>';
    return '<span class="badge mono">N/A</span>';
  }

  function renderStepExplainer(stepKey) {
    const ex = (wfState && wfState.explanations && wfState.explanations[stepKey]) || null;
    if (!ex) return "";
    const dives = ex.deep_dives || [];
    const accId = `explainAcc-${stepKey}`;
    return `
      <div class="step-explainer-box">
        <div class="step-explainer-top">
          <p class="step-explainer-heading">${esc(ex.banner_title)}</p>
          <span class="badge mono">Step ${esc(stepKey)} Context &amp; Guide</span>
        </div>
        <p class="explain-prose">${fmt(ex.what_happens)}</p>
        <div class="explain-howto-callout">
          <strong>What to do on this screen:</strong> ${fmt(ex.how_to_use)}
        </div>
        ${
          dives.length
            ? `
          <div class="explain-accordion" id="${accId}" aria-label="Step ${esc(stepKey)} technical Q and A">
            ${
              dives.length > 1
                ? `<button type="button" class="btn explain-toggle-all-btn" data-toggle-explain-acc="${accId}" aria-expanded="false">
                    <span class="lbl-expand">Expand all ${dives.length} deep-dive explanations</span>
                    <span class="lbl-collapse">Collapse all deep-dive explanations</span>
                  </button>`
                : ""
            }
            ${dives
              .map(
                (d, idx) => `
              <details ${idx === 0 && stepKey === "0" ? "open" : ""}>
                <summary>${esc(d.q)}</summary>
                <p class="explain-answer">${fmt(d.a)}</p>
              </details>
            `
              )
              .join("")}
          </div>
        `
            : ""
        }
      </div>
    `;
  }

  function renderStep0Intro() {
    const layers = wfState.intro.pyramid_layers || [];
    const sprints = wfState.intro.product_sprints || [];
    const conv = wfState.session.converged;

    return `
      <div class="guided-step-header">
        <div>
          <div class="guided-eyebrow">Step 0 · Product Overview &amp; Decision Architecture</div>
          <h2 class="guided-title">Self-Service PECVD Gap-Fill Qualification — Built Around the 4-Layer Decision Pyramid</h2>
          <p class="guided-lead">
            Designed for an Applied Materials ${tip("ccp", "PECVD")} Process Technologist to take a customer requirement (such as TSMC N2 ${tip("har", "HAR")} carbon gap-fill) from failing baseline coupons to a 100% spec-compliant recipe without waiting weeks across separate Simulation, ML, and Metrology queues.
          </p>
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          <span class="badge ${conv ? "badge-ok" : "badge-warn"} mono">${conv ? `Qualified: ${esc(wfState.session.winning_wafer_id)}` : "Sandbox Isolated · Live Data Protected"}</span>
          <button type="button" id="btnStartGuidedStep1" class="btn btn-primary">Start TSMC Qualification Demo (Step 1) →</button>
        </div>
      </div>

      ${renderStepExplainer("0")}

      <div class="guided-two-col">
        <div class="guided-subcard">
          <h3 style="margin:0; font-size:0.98rem;">How the 4-Layer Decision Pyramid Works (${tip("sandbox_s1", "Rule s1 Safe")})</h3>
          <p style="margin:0; font-size:0.81rem; color:var(--muted);">
            Hover, focus, or click any <b>?</b> badge for plain-English definitions. Each layer feeds the layer above it automatically:
          </p>
          <div class="pyramid-stack" style="margin-block-start:0.35rem;">
            ${layers
              .map(
                (L) => `
              <div class="pyramid-tier-card" data-tier="${L.tier}">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:0.4rem;">
                  <strong style="font-size:0.84rem;">${esc(L.name)}</strong>
                  <span class="badge mono">Layer ${L.tier}</span>
                </div>
                <div style="font-size:0.8rem; margin-block-start:0.22rem;">${esc(L.short)}</div>
                ${L.io_flow ? `<div class="mono" style="font-size:0.78rem; color:var(--muted); margin-block-start:0.2rem;">${esc(L.io_flow)}</div>` : ""}
                <div style="font-size:0.78rem; color:var(--brand); margin-block-start:0.2rem;">↳ ${esc(L.replaces)}</div>
              </div>
            `
              )
              .join("")}
          </div>
        </div>

        <div class="guided-subcard">
          <h3 style="margin:0; font-size:0.98rem;">8-Step Closed-Loop Customer Qualification Flow</h3>
          <ol style="margin:0.2rem 0 0; padding-inline-start:1.25rem; font-size:0.82rem; display:flex; flex-direction:column; gap:0.42rem;">
            <li><b>Client Requirement Spec:</b> Lock TSMC's dual-CD ${tip("ph_depth", "PH >= 985 nm")}, ${tip("overburden", "OB <= 85 nm")}, crack-free, ${tip("film_density", "ρ >= 1.80 g/cm³")} target.</li>
            <li><b>Load Experimental Data:</b> Load the prebuilt 8-wafer Producer baseline lot (or upload cleanroom <code>.csv</code>/<code>.json</code>) and auto-grade (<code>0/8</code> pass).</li>
            <li><b>Select Knowledge Base Version:</b> Choose KB version (<code>v1.0</code>–<code>v2.1</code>), distinguish Public Literature vs. Proprietary AMAT IP, and inspect Chemistry &amp; Physics equations.</li>
            <li><b>AI Triage, Simulations &amp; Mechanism Figures (4A &amp; 4B):</b> Run/load coupled CCP + ${tip("knudsen", "Knudsen")} + 3D ${tip("reaxff", "a-C:H:N")} simulations and view visual process figures.</li>
            <li><b>Bayesian Optimization:</b> Run ${tip("constrained_ei", "Constrained EI")} to suggest the next 3-wafer cleanroom batch.</li>
            <li><b>Ingest New Results:</b> Load Round-1 metrology (<code>OB=65.8 nm</code> vs. <code>ρ=1.77</code> trade-off) and auto-grade every TSMC criterion.</li>
            <li><b>Update Knowledge Base:</b> Promote the newly discovered Trim × Temperature crosslinking rule into <code>KB v2.2</code>.</li>
            <li><b>Iterate Until Target Met:</b> Run Round 2 (<code>Steps 4–6</code>) to hit <b>100% TSMC Spec Compliance</b> (<code>TSMC-R2-W1</code>)!</li>
          </ol>
          <div style="margin-block-start:0.5rem; display:flex; gap:0.5rem; flex-wrap:wrap;">
            <button type="button" id="btnIntroGoStep1Bottom" class="btn btn-primary">Begin Step 1: TSMC Requirement Spec →</button>
            <button type="button" id="btnIntroOpenWorkbench" class="btn">Explore 6-Tab Workbench</button>
          </div>
        </div>
      </div>

      <div id="productSprintsSection" class="guided-subcard" style="border:0; border-block-start:1px solid var(--border); border-radius:0; padding:1rem 0 0; background:transparent;">
        <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.5rem;">
          <div>
            <div class="guided-eyebrow">Engineering Productization Plan · All 6 Sprints Implemented</div>
            <h3 style="margin:0.15rem 0 0; font-size:1rem;">6-Sprint Cleanroom Production Suite (Click Any Sprint to Run Live)</h3>
          </div>
          <span class="badge badge-ok mono">6 / 6 Sprints Built &amp; Verified ✓</span>
        </div>
        <div class="sprint-grid">
          ${sprints
            .map(
              (sp, idx) => `
            <div class="sprint-card" data-sprint-card-idx="${idx + 1}">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:0.35rem;">
                <span class="badge badge-ok mono">${esc(sp.sprint)} ✓</span>
                <span style="font-size:0.78rem; color:var(--muted);">${esc(sp.owner)}</span>
              </div>
              <h4>${esc(sp.title)}</h4>
              <div style="font-size:0.8rem;">${esc(sp.goal)}</div>
              <ul>
                ${sp.deliverables.map((d) => `<li>${fmt(d)}</li>`).join("")}
              </ul>
              <div class="mono" style="font-size:0.78rem; color:var(--ok); margin-block-start:auto; padding-block-start:0.3rem; border-block-start:1px dashed var(--border);">
                Exit Gate: ${fmt(sp.exit_criteria)}
              </div>
              <button type="button" class="btn" data-open-sprint-btn="${idx + 1}" style="margin-block-start:0.45rem;">
                ▶ Open Live Sprint ${idx + 1} Module
              </button>
            </div>
          `
            )
            .join("")}
        </div>
        <div id="sprintLiveHubMount"></div>
      </div>
    `;
  }

  function renderStep1Spec() {
    const s1 = wfState.step1_spec;
    const spec = s1.active_spec;
    const presets = Object.values(s1.presets || {});

    return `
      <div class="guided-step-header">
        <div>
          <div class="guided-eyebrow">Step 1 of 8 · Client Requirement Specification</div>
          <h2 class="guided-title">Define the Customer Acceptance Target (TSMC Gap-Fill Demand)</h2>
          <p class="guided-lead">
            Every wafer, simulation, and Bayesian Optimization acquisition score is graded line-by-line against this ${tip("har", "Dual-CD HAR")} specification. Select a TSMC program preset or customize the exact acceptance numbers below.
          </p>
        </div>
        <span class="badge badge-ok mono">Active Goal: ${esc(s1.goal === "partial_fill" ? "Partial Recessed Fill" : "Seamless Plug Fill")}</span>
      </div>

      ${renderStepExplainer("1")}

      <div class="guided-two-col">
        ${presets
          .map((p) => {
            const selected = s1.selected_preset === p.preset_id;
            return `
            <div class="guided-subcard ${selected ? "is-selected" : ""}">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:0.4rem;">
                <span class="badge ${selected ? "badge-ok" : ""} mono">${esc(p.client)} DEMAND</span>
                ${selected ? '<span class="badge badge-ok mono">Selected ✓</span>' : ""}
              </div>
              <h3 style="margin:0; font-size:0.96rem;">${esc(p.program)}</h3>
              <p style="margin:0; font-size:0.8rem; color:var(--muted);">${esc(p.summary)}</p>
              <div style="font-size:0.76rem; color:var(--warn); background:var(--surface); padding:0.45rem 0.6rem; border-radius:0.4rem; border:1px solid var(--border);">
                <b>Why this spec is hard:</b> ${esc(p.why_hard)}
              </div>
              <button type="button" class="btn ${selected ? "" : "btn-primary"}" data-select-preset="${esc(p.preset_id)}">
                ${selected ? "Active Preset ✓ (Re-apply)" : `Use ${esc(p.client)} Preset`}
              </button>
            </div>
          `;
          })
          .join("")}
      </div>

      <div class="guided-subcard" style="background:var(--surface);">
        <h3 style="margin:0; font-size:0.95rem;">Active Acceptance Thresholds: ${esc(spec.name)}</h3>
        <div class="guided-metric-strip">
          <div class="guided-metric-box">
            <div class="m-lbl">${tip("ph_depth", "Min Plug Depth PH₁₁₀/₂₂₅")}</div>
            <div class="m-val mono">&ge; ${esc(spec.ph_min_nm)} nm</div>
          </div>
          <div class="guided-metric-box">
            <div class="m-lbl">${tip("overburden", "Max Planar Overburden")}</div>
            <div class="m-val mono">&le; ${esc(spec.ob_max_nm)} nm</div>
          </div>
          <div class="guided-metric-box">
            <div class="m-lbl">${tip("keyhole_void", "Keyhole / Seam Void")}</div>
            <div class="m-val mono">0 nm (Void-Free)</div>
          </div>
          <div class="guided-metric-box">
            <div class="m-lbl">${tip("film_density", "Min XRR Film Density")}</div>
            <div class="m-val mono">&ge; ${esc(spec.density_min_g_cm3 ?? 1.80)} g/cm³</div>
          </div>
          <div class="guided-metric-box">
            <div class="m-lbl">${tip("griffith_crack", "Delamination Cracks")}</div>
            <div class="m-val mono">${spec.crack_allowed ? "Allowed" : "Zero Allowed"}</div>
          </div>
          <div class="guided-metric-box">
            <div class="m-lbl">${tip("dust_nodule", "Particle Nodules")} / ${tip("afm_rq", "AFM R_q")}</div>
            <div class="m-val mono">No / &le; ${esc(s1.afm_rq_max_nm)} nm</div>
          </div>
        </div>

        <details class="guided-details">
          <summary>Customize Spec Numbers Manually (Optional)</summary>
          <div class="form-grid" style="margin-block-start:0.65rem;">
            <label class="full">Specification Name
              <input id="wfSpecName" type="text" value="${esc(spec.name)}" />
            </label>
            <label>Min Penetration Depth PH₁₁₀ &amp; PH₂₂₅ (nm)
              <input id="wfSpecPhMin" type="number" step="5" min="600" max="1000" value="${esc(spec.ph_min_nm)}" />
            </label>
            <label>Max Planar Overburden Cap OB (nm)
              <input id="wfSpecObMax" type="number" step="5" min="35" max="300" value="${esc(spec.ob_max_nm)}" />
            </label>
            <label>Min XRR Film Density ρ (g/cm³)
              <input id="wfSpecDensity" type="number" step="0.01" min="1.40" max="2.30" value="${esc(spec.density_min_g_cm3 ?? 1.80)}" />
            </label>
            <label>Max Inline AFM Roughness R_q (nm)
              <input id="wfSpecAfm" type="number" step="0.05" min="0.5" max="5.0" value="${esc(s1.afm_rq_max_nm)}" />
            </label>
          </div>
          <button type="button" id="btnSaveCustomWfSpec" class="btn btn-primary">Save Custom Spec Thresholds</button>
        </details>
      </div>

      <div class="guided-footer-nav">
        <button type="button" class="btn" data-nav-step="0">← Back to Intro &amp; Pyramid</button>
        <button type="button" id="btnLockStep1Next" class="btn btn-primary">Lock TSMC Spec &amp; Continue to Step 2 (Load Data) →</button>
      </div>
    `;
  }

  function renderWaferGradingTable(wafers, captionText) {
    if (!wafers || !wafers.length) {
      return `<div style="padding:0.9rem; border:1px dashed var(--border); border-radius:0.5rem; color:var(--muted); font-size:0.84rem;">No experimental wafers loaded yet. Click <b>Load Preloaded Baseline Dataset</b> above (or upload a CSV/JSON file) to grade wafers against TSMC's spec.</div>`;
    }
    return `
      <div tabindex="0" role="region" aria-label="${esc(captionText)}" class="table-wrapper" style="max-block-size:340px;">
        <table>
          <caption>${esc(captionText)}</caption>
          <thead>
            <tr>
              <th scope="col">Wafer ID</th>
              <th scope="col">Recipe (RF / N:C / T / Trim)</th>
              <th scope="col">PH₁₁₀ (nm)</th>
              <th scope="col">PH₂₂₅ (nm)</th>
              <th scope="col">OB (nm)</th>
              <th scope="col">Density ρ</th>
              <th scope="col">Crack / Nodule</th>
              <th scope="col">TSMC Gate</th>
              <th scope="col">Primary Bottleneck Diagnosis</th>
            </tr>
          </thead>
          <tbody>
            ${wafers
              .map((w) => {
                const r = w.recipe || {};
                const m = w.measured || {};
                const nc = r.c2h2_sccm ? (r.nh3_sccm / r.c2h2_sccm).toFixed(2) : "--";
                const trimPct = Math.round((r.trim_fraction || 0) * 100);
                const l = w.lines || {};
                return `
                <tr>
                  <th scope="row" class="mono">${esc(w.exp_id)}</th>
                  <td class="mono" style="font-size:0.75rem;">${esc(r.freq_mhz)} MHz · N/C=${nc} · ${esc(r.temp_c)}°C · Trim ${trimPct}%</td>
                  <td class="mono">${m.ph_depth_110_nm ?? "--"} ${passFailBadge(l.ph_110 || l.fill_height)}</td>
                  <td class="mono">${m.ph_depth_225_nm ?? "--"} ${passFailBadge(l.ph_225 || l.fill_height)}</td>
                  <td class="mono">${m.ob_nm ?? "--"} ${passFailBadge(l.ob)}</td>
                  <td class="mono">${m.film_density_g_cm3 ?? "--"} ${l.density ? passFailBadge(l.density) : ""}</td>
                  <td class="mono">${m.crack_detected ? "Crack!" : "Clean"} / ${m.nodule_defect ? "Nodule!" : "Clean"}</td>
                  <td>${w.meets_spec ? '<span class="badge badge-ok mono">PASS ALL ✓</span>' : `<span class="badge badge-err mono">FAIL (${esc((w.failed_lines || []).join(", "))})</span>`}</td>
                  <td style="font-size:0.76rem; color:var(--muted); max-inline-size:290px;">${esc(w.notes || "")}</td>
                </tr>
              `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderStep2LoadData() {
    const s2 = wfState.step2_data;
    const bs = s2.baseline_summary || { count: 0, pass_count: 0, wafers: [] };

    return `
      <div class="guided-step-header">
        <div>
          <div class="guided-eyebrow">Step 2 of 8 · Load Experimental Screening Data</div>
          <h2 class="guided-title">Load Prebuilt Cleanroom Screening Lot (or Upload Your Own Dataset)</h2>
          <p class="guided-lead">
            Load the preloaded Applied Materials Producer® screening dataset with 1 click, or upload a cleanroom <code>.csv</code> / <code>.json</code> file. Layer 1 automatically grades every wafer line-by-line against Step 1's TSMC specification.
          </p>
        </div>
        <span class="badge ${bs.pass_count > 0 ? "badge-ok" : "badge-warn"} mono">
          ${bs.count ? `${bs.pass_count} / ${bs.count} Wafers Pass TSMC Spec` : "Awaiting Dataset Selection"}
        </span>
      </div>

      ${renderStepExplainer("2")}

      <div class="guided-three-col">
        ${(s2.available_lots || [])
          .map((lot, idx) => {
            const active = s2.loaded_dataset_id === lot.dataset_id;
            return `
            <div class="guided-subcard ${active ? "is-selected" : ""}">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:0.35rem;">
                <span class="badge ${idx === 0 ? "badge-ok" : ""} mono">${idx === 0 ? "Recommended Preloaded Lot" : "Stress-Test Lot"}</span>
                <span class="mono" style="font-size:0.76rem;">${lot.wafer_count} Wafers</span>
              </div>
              <h3 style="margin:0; font-size:0.92rem;">${esc(lot.title)}</h3>
              <p style="margin:0; font-size:0.78rem; color:var(--muted);">${esc(lot.description)}</p>
              <button type="button" class="btn ${active ? "" : "btn-primary"}" style="margin-block-start:auto;" data-load-lot="${esc(lot.dataset_id)}">
                ${active ? "Loaded ✓ (Reload Clean Copy)" : `Load ${lot.wafer_count}-Wafer Preloaded Dataset`}
              </button>
            </div>
          `;
          })
          .join("")}

        <div class="guided-subcard">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="badge mono">Custom Cleanroom File</span>
            <span class="mono" style="font-size:0.76rem;">.CSV / .JSON</span>
          </div>
          <h3 style="margin:0; font-size:0.92rem;">Upload Customer / Lab Metrology File</h3>
          <p style="margin:0; font-size:0.78rem; color:var(--muted);">
            Ingests wafer recipes, cross-section SEM depths, ${tip("overburden", "OB")}, inline OES <code>CN/Ar</code>, XRR density, and ${tip("afm_rq", "AFM R_q")} into the isolated guided sandbox.
          </p>
          <label for="wfUploadInput" style="font-size:0.77rem; font-weight:600; margin-block-start:auto;">Select .csv or .json dataset:
            <input id="wfUploadInput" type="file" accept=".csv,.json" style="margin-block-start:0.25rem; inline-size:100%; font-size:0.76rem;" />
          </label>
        </div>
      </div>

      <div class="guided-subcard" style="background:var(--surface);">
        <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.5rem;">
          <h3 style="margin:0; font-size:0.95rem;">
            Automatic TSMC Criteria Grading Scorecard ${s2.loaded_dataset_title ? `· ${esc(s2.loaded_dataset_title)}` : ""}
          </h3>
          ${bs.count ? `<span class="mono" style="font-size:0.78rem; color:var(--muted);">Best Baseline Fill: <b>${bs.best_ph_110_nm} nm</b> · Lowest Baseline OB: <b>${bs.lowest_ob_nm} nm</b></span>` : ""}
        </div>
        ${renderWaferGradingTable(bs.wafers, "Baseline Experimental Wafers Graded Line-by-Line Against TSMC Spec")}
      </div>

      <div class="guided-footer-nav">
        <button type="button" class="btn" data-nav-step="1">← Back to Step 1 (TSMC Spec)</button>
        <button type="button" id="btnStep2Next" class="btn btn-primary">
          ${bs.count ? "Continue to Step 3 (Select Knowledge Base) →" : "Load Recommended 8-Wafer Baseline & Continue to Step 3 →"}
        </button>
      </div>
    `;
  }

  function renderGuidedConfigSearchResults(res) {
    if (!res || !res.papers || !res.papers.length) {
      return `<div style="padding:0.75rem; border:1px dashed var(--border); border-radius:0.45rem; font-size:0.8rem; color:var(--muted);">No matching papers found for this keyword filter. Clear the filter or select another configuration preset above.</div>`;
    }
    const rows = (res.matched_dataset_rows || []).slice(0, 5);
    return `
      <div class="config-summary-banner">
        <div><b>Configuration:</b> <span class="mono">${esc(res.config_summary)}</span></div>
        <div class="mono">Top <b>${esc(res.returned_paper_count)}</b> of <b>${esc(res.total_matching_papers)}</b> papers · <b>${esc((res.matched_dataset_rows || []).length)}</b> benchmark rows</div>
      </div>
      <div class="config-ranked-grid">
        ${res.papers
          .map((p) => {
            const fid = p.regime_fidelity || "analogous_extrapolated";
            const fidCls = fid === "exact_pecvd_har" ? "is-exact-regime" : fid === "direct_subsystem" ? "is-direct-subsystem" : "is-extrapolated";
            const fidLbl = fid === "exact_pecvd_har" ? "Exact PECVD/HAR" : fid === "direct_subsystem" ? "Direct Subsystem" : "Analogous Regime";
            return `
            <div class="config-paper-card ${fidCls}">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:0.35rem;">
                <span class="match-score-pill mono">${esc(p.relevance_score)}% Match</span>
                <span class="badge ${fid === "exact_pecvd_har" ? "badge-ok" : ""} mono">${esc(fidLbl)}</span>
              </div>
              <div style="font-weight:600; line-height:1.3;">
                <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)} ↗</a>
              </div>
              <div class="mono" style="font-size:0.76rem; color:var(--muted);">${esc(p.citation)}</div>
              <div style="font-size:0.75rem; color:var(--muted);">${esc(p.takeaway)}</div>
              <div class="match-reason-row">
                ${(p.matched_reasons || []).map((r) => `<span class="match-reason-tag">✓ ${esc(r)}</span>`).join("")}
                ${(p.extrapolation_notes || []).map((w) => `<span class="match-warn-tag">⚠ ${esc(w)}</span>`).join("")}
              </div>
            </div>`;
          })
          .join("")}
      </div>
      ${
        rows.length
          ? `<details class="guided-details" style="margin-block-start:0.55rem;">
              <summary>View ${rows.length} Linked Quantitative Benchmark Rows (${esc(res.config_summary.split("·")[0].trim())})</summary>
              <div style="display:flex; flex-direction:column; gap:0.35rem; margin-block-start:0.45rem; font-size:0.75rem;">
                ${rows
                  .map(
                    (r) => `
                  <div style="padding:0.42rem 0.6rem; border-radius:0.4rem; background:var(--surface-alt); border:1px solid var(--border); display:flex; justify-content:space-between; gap:0.5rem; flex-wrap:wrap;">
                    <span><b class="mono">${esc(r.row_label)}</b> <span class="badge mono">${esc(r.provenance)}</span> — <span class="mono">${esc(r.metrics_summary)}</span></span>
                    <span style="color:var(--muted);">${esc(r.source_ref)}</span>
                  </div>`
                  )
                  .join("")}
              </div>
            </details>`
          : ""
      }
    `;
  }

  function renderStep3KnowledgeBase() {
    const s3 = wfState.step3_kb;
    const arch = s3.architecture || {};

    return `
      <div class="guided-step-header">
        <div>
          <div class="guided-eyebrow">Step 3 of 8 · Versioned Knowledge Base, IP Provenance &amp; Physics/Chemistry</div>
          <h2 class="guided-title">Select Knowledge Base Version &amp; Inspect How Chemistry + Physics Enter the Model</h2>
          <p class="guided-lead">
            Choose which Knowledge Base snapshot governs calibration and optimization. Notice how the platform strictly separates <b>Public Peer-Reviewed Science</b>, <b>Proprietary AMAT Chamber IP</b>, and <b>Customer Lot Data</b>.
          </p>
        </div>
        <span class="badge badge-ok mono">Active: ${esc(s3.kb_version_label)} (${(s3.active_rules || []).length} Active Causal Rules)</span>
      </div>

      ${renderStepExplainer("3")}

      <div class="guided-three-col">
        ${(s3.versions || [])
          .map((v) => {
            const active = s3.selected_kb_key === v.key;
            return `
            <div class="guided-subcard ${active ? "is-selected" : ""}">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:0.35rem;">
                <span class="badge ${v.recommended ? "badge-ok" : ""} mono">${esc(v.badge)}</span>
                <span class="mono" style="font-size:0.76rem;">${v.proprietary_rule_ids.length} Prop. Rules</span>
              </div>
              <h3 style="margin:0; font-size:0.93rem;">${esc(v.title)}</h3>
              <p style="margin:0; font-size:0.78rem; color:var(--muted);">${esc(v.summary)}</p>
              <div style="font-size:0.76rem; color:var(--brand); margin-block-start:auto;">Impact: ${esc(v.expected_impact)}</div>
              <button type="button" class="btn ${active ? "" : "btn-primary"}" data-select-kb="${esc(v.key)}">
                ${active ? `Selected: ${esc(v.kb_version)} ✓` : `Select ${esc(v.kb_version)}`}
              </button>
            </div>
          `;
          })
          .join("")}
      </div>

      <div class="guided-subcard" style="background:var(--surface);">
        <h3 style="margin:0; font-size:0.96rem;">Explicit Knowledge Source Distinction (Public Science vs. Proprietary IP vs. Customer Data)</h3>
        <div class="guided-three-col">
          ${(arch.knowledge_distinction || [])
            .map(
              (col, i) => `
            <div class="guided-subcard" style="border-inline-start:3px solid ${i === 0 ? "var(--brand)" : i === 1 ? "var(--warn)" : "var(--ok)"};">
              <span class="badge ${i === 1 ? "badge-warn" : i === 2 ? "badge-ok" : ""} mono">${esc(col.badge)}</span>
              <strong style="font-size:0.86rem;">${esc(col.source_type)}</strong>
              <div style="font-size:0.76rem; color:var(--muted);">Governance: ${fmt(col.access_scope)}</div>
              <ul style="margin:0.2rem 0 0; padding-inline-start:1.1rem; font-size:0.77rem; display:flex; flex-direction:column; gap:0.28rem;">
                ${col.items.map((it) => `<li>${fmt(it)}</li>`).join("")}
              </ul>
            </div>
          `
            )
            .join("")}
        </div>
      </div>

      <div class="guided-two-col">
        <div class="guided-subcard">
          <h3 style="margin:0; font-size:0.95rem;">How Chemistry Is Incorporated (${tip("hcn_scavenging", "HCN Scavenging")}, ${tip("beta_eff", "β_eff")} &amp; ${tip("reaxff", "sp²/C=N Bonding")})</h3>
          ${(arch.chemistry_incorporation || [])
            .map(
              (c) => `
            <div style="padding:0.55rem 0.65rem; border-radius:0.45rem; background:var(--surface); border:1px solid var(--border);">
              <div style="font-weight:700; font-size:0.81rem;">${esc(c.stage)}</div>
              <div class="mono" style="font-size:0.76rem; color:var(--brand); margin-block:0.18rem;">${esc(c.reaction)}</div>
              <div style="font-size:0.77rem; color:var(--muted);">${fmt(c.mechanism)}</div>
              <div style="font-size:0.76rem; margin-block-start:0.2rem;"><b>Model Coupling:</b> ${fmt(c.model_coupling)}</div>
            </div>
          `
            )
            .join("")}
        </div>

        <div class="guided-subcard">
          <h3 style="margin:0; font-size:0.95rem;">How Physics Is Incorporated (${tip("vhf_27mhz", "VHF Sheath")}, ${tip("knudsen", "Knudsen")}, ${tip("thiele", "Thiele Φ")} &amp; ${tip("ded_trim", "Trim")})</h3>
          ${(arch.physics_incorporation || [])
            .map(
              (p) => `
            <div style="padding:0.55rem 0.65rem; border-radius:0.45rem; background:var(--surface); border:1px solid var(--border);">
              <div style="font-weight:700; font-size:0.81rem;">${esc(p.stage)}</div>
              <div class="mono" style="font-size:0.76rem; color:var(--brand); margin-block:0.18rem;">${esc(p.equation)}</div>
              <div style="font-size:0.77rem; color:var(--muted);">${fmt(p.mechanism)}</div>
              <div style="font-size:0.76rem; margin-block-start:0.2rem;"><b>Model Coupling:</b> ${fmt(p.model_coupling)}</div>
            </div>
          `
            )
            .join("")}
        </div>
      </div>

      <details class="guided-details">
        <summary>Inspect All ${(s3.active_rules || []).length} Active AST-Validated Rules in ${esc(s3.kb_version_label)}</summary>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:0.55rem; margin-block-start:0.6rem;">
          ${(s3.active_rules || [])
            .map(
              (r) => `
            <div style="padding:0.55rem; border:1px solid var(--border); border-radius:0.45rem; background:var(--surface); font-size:0.76rem;">
              <div style="display:flex; justify-content:space-between; gap:0.3rem;">
                <strong>${esc(r.title)}</strong>
                <span class="badge ${r.guidance === "favor" ? "badge-ok" : "badge-warn"} mono">${esc(r.guidance)}</span>
              </div>
              <div class="mono" style="color:var(--brand); font-size:0.76rem; margin-block:0.2rem;">if (${esc(r.condition_expr)})</div>
              <div style="color:var(--muted);">${esc(r.description)}</div>
            </div>
          `
            )
            .join("")}
        </div>
      </details>

      <div class="guided-subcard" style="background:var(--surface);">
        <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.5rem;">
          <div>
            <div class="guided-eyebrow">Searchable Configuration Knowledge Base (${esc((s3.kb_stats && s3.kb_stats.public_papers) || 102)} Papers · ${esc((s3.kb_stats && s3.kb_stats.benchmark_datasets) || 10)} Datasets)</div>
            <h3 style="margin:0.15rem 0 0; font-size:0.96rem;">For This Type of Configuration, Here Are the Most Relevant Papers &amp; Benchmarks</h3>
          </div>
          <span id="wfStep3SearchStatus" role="status" aria-live="polite" class="badge badge-ok mono">Ranked by Regime Match %</span>
        </div>

        <search id="wfStep3ConfigSearch" class="config-search-landmark" aria-label="Search relevant papers for your target process configuration">
          <div class="config-preset-bar" role="group" aria-label="Guided configuration search presets">
            ${(s3.search_presets || [])
              .map(
                (pr, idx) => `
              <button type="button" class="config-preset-chip" data-wf-cfg-preset="${esc(pr.preset_id)}" aria-pressed="${idx === 0 ? "true" : "false"}">
                ${esc(pr.label)}
              </button>`
              )
              .join("")}
          </div>
          <form id="wfConfigSearchForm" style="display:flex; flex-wrap:wrap; gap:0.5rem; align-items:flex-end; margin-block-end:0.6rem;">
            <label for="wfStep3KeywordInput" style="flex:1; min-inline-size:240px; font-size:0.75rem; font-weight:600; color:var(--muted); display:flex; flex-direction:column; gap:0.2rem;">
              Optional Keyword / Precursor / Diagnostic Filter
              <input id="wfStep3KeywordInput" type="search" placeholder="e.g. NH3, graphitic N, pulsed CCP, AFM, Bosanquet…" autocorrect="off" autocapitalize="none" spellcheck="false" style="padding:0.36rem 0.55rem; border-radius:0.4rem; border:1px solid var(--border); background:var(--surface-alt); color:var(--text); font-size:0.8rem;" />
            </label>
            <button type="submit" class="btn btn-primary">Search Configuration Literature</button>
          </form>
        </search>

        <div id="wfStep3ConfigResultsBox">
          ${renderGuidedConfigSearchResults(s3.default_config_search)}
        </div>
      </div>

      <div class="guided-footer-nav">
        <button type="button" class="btn" data-nav-step="2">← Back to Step 2 (Load Data)</button>
        <button type="button" id="btnStep3Next" class="btn btn-primary">Confirm ${esc(s3.kb_version_label)} &amp; Continue to Step 4A (AI &amp; Simulations) →</button>
      </div>
    `;
  }

  function renderStep4ASimulations() {
    const s4 = wfState.step4_sim_and_understanding;
    const cards = s4.simulation_cards || [];
    const und = s4.understanding || {};

    return `
      <div class="guided-step-header">
        <div>
          <div class="guided-eyebrow">Step 4A of 8 · AI Optimization Strategy &amp; Multi-Scale Simulation Campaign</div>
          <h2 class="guided-title">AI Selects Optimization Strategy &amp; Gathers Missing Physics via Multi-Scale Simulations</h2>
          <p class="guided-lead">
            Before cutting expensive patterned 300 mm wafers, the AI identifies unmeasured regions (cyclic ${tip("ded_trim", "Ar/NH₃ Trim")} selectivity and high-NH₃ ${tip("reaxff", "a-C:H:N")} density limits) and assimilates coupled <b>CCP Plasma + Ballistic Knudsen + 3D Molecular</b> simulations.
          </p>
        </div>
        <span class="badge ${cards.length ? "badge-ok" : "badge-warn"} mono">${cards.length} Coupled Simulations Assimilated</span>
      </div>

      ${renderStepExplainer("4A")}

      <div class="guided-two-col">
        <div class="guided-subcard">
          <div class="guided-eyebrow">AI Strategy Selection</div>
          <h3 style="margin:0; font-size:0.95rem;">Why Bayesian Optimization + Multi-Scale Sim Was Selected</h3>
          <p style="margin:0; font-size:0.81rem;">${esc(und.ai_strategy || "")}</p>
          <ul style="margin:0.2rem 0 0; padding-inline-start:1.15rem; font-size:0.78rem; color:var(--muted); display:flex; flex-direction:column; gap:0.28rem;">
            <li><b>Gap 1 (Zero Trim Data in Baseline):</b> All 8 baseline wafers had <code>trim_fraction = 0%</code>; feature-scale simulations quantify how 12–24% trim shaves ${tip("overburden", "OB")} below 85 nm.</li>
            <li><b>Gap 2 (Bulk Density vs. NH₃ Passivation):</b> Callable 3D RDKit <code>MMFF94s</code> / ReaxFF nanoclusters predict when excess <code>NH₃</code> drops ${tip("film_density", "ρ")} below 1.80 g/cm³.</li>
            <li><b>Acquisition Function:</b> ${tip("constrained_ei", "Constrained EI")} × ${tip("gp_discrepancy", "Matérn-5/2 GP")} uncertainty.</li>
          </ul>
          <button type="button" id="btnLoadPrebuiltSims" class="btn btn-primary" style="margin-block-start:auto;">
            ${cards.length ? "↻ Reload 6-Run Prebuilt Multi-Scale Simulation Pack" : "⚡ Load Prebuilt 6-Run Multi-Scale Simulation Pack (Demo)"}
          </button>
        </div>

        <div class="guided-subcard">
          <div class="guided-eyebrow">Live Callable Platform Simulator</div>
          <h3 style="margin:0; font-size:0.95rem;">Run a New Coupled CCP + Knudsen + 3D Molecular Simulation Live</h3>
          <p style="margin:0; font-size:0.78rem; color:var(--muted);">
            In production (and live right here!), adjust any chamber knob below to execute all 3 simulation scales in &lt; 0.4s and assimilate the result directly into the Brain:
          </p>
          <div class="form-grid" style="margin:0.25rem 0;">
            <label>RF Frequency (MHz)
              <select id="wfSimFreq">
                <option value="27.12" selected>27.12 MHz (VHF Low-Sheath)</option>
                <option value="13.56">13.56 MHz (Conventional HF)</option>
              </select>
            </label>
            <label>NH₃ Passivation Flow (sccm)
              <input id="wfSimNh3" type="number" min="150" max="250" step="5" value="222" />
            </label>
            <label>Pedestal Temperature (°C)
              <input id="wfSimTemp" type="number" min="530" max="580" step="2" value="565" />
            </label>
            <label>Cyclic Ar/NH₃ Trim (%)
              <input id="wfSimTrimPct" type="number" min="0" max="35" step="2" value="21" />
            </label>
          </div>
          <button type="button" id="btnRunLiveCustomSim" class="btn">▶ Run Live Multi-Scale Simulation &amp; Assimilate</button>
        </div>
      </div>

      <div class="guided-subcard" style="background:var(--surface);">
        <h3 style="margin:0; font-size:0.95rem;">Assimilated Multi-Scale Simulation Matrix (Plasma → Knudsen Feature → 3D Atomistic Network)</h3>
        ${
          !cards.length
            ? `<div style="padding:0.85rem; border:1px dashed var(--border); border-radius:0.5rem; font-size:0.82rem; color:var(--muted);">Click <b>⚡ Load Prebuilt 6-Run Multi-Scale Simulation Pack</b> above (or run a live custom simulation) to populate the multi-scale table.</div>`
            : `
          <div tabindex="0" role="region" aria-label="Multi-scale simulation results" class="table-wrapper" style="max-block-size:310px;">
            <table>
              <caption>Coupled Chamber CCP + Ballistic Knudsen Feature + 3D a-C:H:N Molecular Simulations</caption>
              <thead>
                <tr>
                  <th scope="col">Sim ID</th>
                  <th scope="col">Simulation Purpose</th>
                  <th scope="col">Recipe</th>
                  <th scope="col">CCP E_i / β_eff / Φ₁₁₀</th>
                  <th scope="col">Knudsen PH₁₁₀ / OB</th>
                  <th scope="col">3D Molecular Formula &amp; ρ</th>
                </tr>
              </thead>
              <tbody>
                ${cards
                  .map((c) => {
                    const r = c.recipe;
                    const p = c.ccp_plasma;
                    const f = c.knudsen_feature;
                    const m = c.molecular_3d;
                    return `
                    <tr>
                      <th scope="row" class="mono">${esc(c.sim_tag)}</th>
                      <td style="font-size:0.78rem;">${esc(c.purpose)}</td>
                      <td class="mono" style="font-size:0.76rem;">${r.freq_mhz} MHz · NH₃=${r.nh3_sccm} · ${r.temp_c}°C · Trim ${Math.round((r.trim_fraction || 0) * 100)}%</td>
                      <td class="mono" style="font-size:0.75rem;">${p.ion_energy_ev} eV · β=${p.beta_eff} · Φ=${p.thiele_110}</td>
                      <td class="mono" style="font-size:0.76rem;"><b>PH=${f.ph_depth_110_nm} nm</b> · OB=${f.ob_nm} nm</td>
                      <td class="mono" style="font-size:0.76rem;">${esc(m.formula)} (${m.num_atoms} at) · ρ=${m.predicted_density_g_cm3} g/cm³</td>
                    </tr>
                  `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        `
        }
      </div>

      <div class="guided-footer-nav">
        <button type="button" class="btn" data-nav-step="3">← Back to Step 3 (Knowledge Base)</button>
        <button type="button" id="btnStep4ANext" class="btn btn-primary">
          ${cards.length ? "Continue to Step 4B (Process Summary & Mechanism Figures) →" : "Load Simulation Pack & Continue to Step 4B →"}
        </button>
      </div>
    `;
  }

  function renderStep4BUnderstanding() {
    const und = wfState.step4_sim_and_understanding.understanding || {};
    const th = und.calibrated_theta || {};

    return `
      <div class="guided-step-header">
        <div>
          <div class="guided-eyebrow">Step 4B of 8 · Current Process Understanding &amp; Mechanism Figures</div>
          <h2 class="guided-title">${esc(und.headline || "Mechanistic Summary of Current PECVD Process Window")}</h2>
          <p class="guided-lead">
            Synthesized from your loaded wafers, ${esc(wfState.step3_kb.kb_version_label)} rules, ${tip("map_theta", "Bayesian MAP θ̂")} calibration, and multi-scale simulations.
          </p>
        </div>
        <span class="badge badge-ok mono">Round ${wfState.session.current_round} Understanding</span>
      </div>

      ${renderStepExplainer("4B")}

      <div class="guided-subcard" style="background:var(--surface);">
        <h3 style="margin:0; font-size:0.95rem;">Key Quantitative Takeaways</h3>
        <ol style="margin:0.2rem 0 0; padding-inline-start:1.25rem; font-size:0.83rem; display:flex; flex-direction:column; gap:0.38rem;">
          ${(und.key_findings || []).map((f) => `<li>${esc(f)}</li>`).join("")}
        </ol>
        <div class="mono" style="font-size:0.76rem; color:var(--muted); padding-block-start:0.4rem; border-block-start:1px dashed var(--border);">
          Calibrated Kinetics θ̂: β_c0=${th.beta_c0?.toFixed?.(4) ?? "--"} · k_pass=${th.k_pass?.toFixed?.(2) ?? "--"} · γ_rec=${th.gamma_rec?.toFixed?.(3) ?? "--"} · y_iece=${th.y_iece?.toFixed?.(2) ?? "--"} · ob_scale=${th.ob_scale?.toFixed?.(2) ?? "--"} · crack_OB=${th.crack_thresh_ob?.toFixed?.(0) ?? "--"} nm
        </div>
      </div>

      <div class="guided-two-col">
        <figure class="guided-figure">
          <strong style="font-size:0.86rem;">Figure 1 · How the Process Works Inside a 110 nm × 1000 nm HAR Via</strong>
          <canvas id="guidedFigCrossSection" width="680" height="370" role="img" aria-label="Three cross-sectional trench diagrams comparing 13.56 MHz keyhole pinch-off, 27.12 MHz single-step high overburden, and 27.12 MHz plus NH3 passivation plus 22 percent cyclic trim achieving void-free fill with 64 nm overburden"></canvas>
          <figcaption>
            Left-to-right mechanism progression: (A) 13.56 MHz high sheath energy causes top-corner cusping &amp; buried keyhole void; (B) 27.12 MHz + NH₃ opens ballistic bounce (<code>β_eff = 0.0068</code>) but exceeds the 85 nm OB cap; (C) 22% cyclic Ar/NH₃ mouth trim shaves top OB to ~64 nm while bottom-up growth seals seamlessly at 996 nm.
          </figcaption>
        </figure>

        <figure class="guided-figure">
          <strong style="font-size:0.86rem;">Figure 2 · Quantitative Operating Window (NH₃/C₂H₂ Ratio vs. Cyclic Trim %)</strong>
          <canvas id="guidedFigRegimeMap" width="680" height="370" role="img" aria-label="2D process regime map of NH3 to C2H2 flow ratio versus cyclic Ar NH3 trim percentage showing pinch-off failure zone, overburden above 85 nm zone, low-density film zone, baseline wafers, simulations, and the TSMC sweet-spot target window"></canvas>
          <figcaption>
            Maps every baseline wafer (red ×), multi-scale simulation (blue ◇), and active DoE wafer (● / ★) against physical failure boundaries and the emerald TSMC N2 target sweet spot (<code>N/C ∈ [0.33, 0.37]</code>, <code>Trim ∈ [18%, 26%]</code>).
          </figcaption>
        </figure>
      </div>

      <div class="guided-footer-nav">
        <button type="button" class="btn" data-nav-step="4A">← Back to Step 4A (Simulations)</button>
        <button type="button" data-nav-step="5" class="btn btn-primary">Continue to Step 5 (Run Bayesian Optimization) →</button>
      </div>
    `;
  }

  function renderStep5Optimize() {
    const nextRound = Number(wfState.session.current_round || 0) + 1;
    const latest = wfState.step5_optimization.latest_batch;
    const hasCurrentRoundPlan = latest && Number(latest.round) === nextRound;
    const cands = hasCurrentRoundPlan ? latest.candidates : (latest ? latest.candidates : []);

    return `
      <div class="guided-step-header">
        <div>
          <div class="guided-eyebrow">Step 5 of 8 · Active Bayesian Optimization</div>
          <h2 class="guided-title">Propose Round ${nextRound} Cleanroom Experiment Batch (${tip("constrained_ei", "Constrained EI")} + Diversity)</h2>
          <p class="guided-lead">
            Combines calibrated physics + ${tip("gp_discrepancy", "Matérn-5/2 GP")} posterior uncertainty + ${esc(wfState.step3_kb.kb_version_label)} rules to select 3 diverse recipes maximizing probability of hitting TSMC's spec while resolving remaining epistemic uncertainty.
          </p>
        </div>
        <div style="display:flex; gap:0.45rem; flex-wrap:wrap;">
          <button type="button" id="btnRunWfBo" class="btn btn-primary">
            ${hasCurrentRoundPlan ? `Re-Run Bayesian Optimizer (Round ${nextRound})` : `Run Bayesian Optimization for Round ${nextRound}`}
          </button>
          ${cands.length ? `<button type="button" id="btnExportWfBoCsv" class="btn">Export Run-Sheet (.csv)</button>` : ""}
        </div>
      </div>

      ${renderStepExplainer("5")}

      ${
        !cands.length
          ? `<div class="guided-subcard"><p style="margin:0; font-size:0.85rem; color:var(--muted);">Click <b>Run Bayesian Optimization for Round ${nextRound}</b> above to generate the 3-wafer cleanroom DoE run-sheet with logged UUID prediction IDs.</p></div>`
          : `
        <div class="guided-three-col">
          ${cands
            .map((c) => {
              const r = c.recipe;
              const p = c.predicted;
              const nc = (r.nh3_sccm / Math.max(1, r.c2h2_sccm)).toFixed(3);
              return `
              <div class="guided-subcard is-selected">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:0.35rem;">
                  <span class="badge badge-ok mono">${esc(c.wafer_slot_id)} · #${c.rank}</span>
                  <span class="badge mono">${esc(c.exploration_role)}</span>
                </div>
                <div class="mono" style="font-size:0.78rem; padding:0.45rem 0.55rem; border-radius:0.4rem; background:var(--surface); border:1px solid var(--border);">
                  <b>${r.freq_mhz} MHz</b> · ${r.power_w} W · Gap ${r.gap_mils} mil · ${r.pressure_torr} Torr<br/>
                  Ar ${r.ar_sccm} · C₂H₂ ${r.c2h2_sccm} · NH₃ ${r.nh3_sccm} (<b>N/C=${nc}</b>)<br/>
                  Temp <b>${r.temp_c} °C</b> · Trim <b>${Math.round((r.trim_fraction || 0) * 100)}%</b> · Dep ${r.dep_time_s}s
                </div>
                <div style="font-size:0.8rem;">
                  <div>Pred PH₁₁₀: <b>${p.ph_depth_110_nm} ± ${p.ph_depth_110_std} nm</b></div>
                  <div>Pred OB: <b>${p.ob_nm} ± ${p.ob_std} nm</b> · Pred ρ: <b>${p.film_density_g_cm3} g/cm³</b></div>
                  <div style="color:var(--ok); font-weight:700; margin-block-start:0.15rem;">Predicted P(Meets TSMC Spec): ${(p.p_meets_spec * 100).toFixed(0)}%</div>
                </div>
                <div style="font-size:0.78rem; color:var(--muted); margin-block-start:auto;">
                  <b>Why BO picked this wafer:</b> ${esc(c.rationale)}
                </div>
                <div class="mono" style="font-size:0.76rem; color:var(--muted);">Logged UUID: ${esc(c.suggestion_id || "pending")}</div>
              </div>
            `;
            })
            .join("")}
        </div>
      `
      }

      <div class="guided-footer-nav">
        <button type="button" class="btn" data-nav-step="4B">← Back to Step 4B (Figures)</button>
        <button type="button" id="btnStep5Next" class="btn btn-primary">
          ${hasCurrentRoundPlan ? `Approve Run-Sheet & Continue to Step 6 (Ingest Round ${nextRound} Results) →` : `Generate Round ${nextRound} Batch & Continue to Step 6 →`}
        </button>
      </div>
    `;
  }

  function renderStep6IngestResults() {
    const curRound = Number(wfState.session.current_round || 0);
    const targetRound = wfState.session.converged ? curRound : curRound + 1;
    const latestRound = wfState.step6_results.latest_round;
    const hasRoundResults = latestRound && Number(latestRound.round) >= 1;

    return `
      <div class="guided-step-header">
        <div>
          <div class="guided-eyebrow">Step 6 of 8 · Cleanroom Metrology Ingestion &amp; Auto-Grading</div>
          <h2 class="guided-title">Ingest New Experiment Results &amp; Check Against TSMC Target Criteria</h2>
          <p class="guided-lead">
            Load the cleanroom SEM / XRR / OES / AFM results for the proposed 3-wafer DoE batch. The platform grades every line of TSMC's spec, audits predictions against logged UUIDs, and recalibrates ${tip("map_theta", "θ̂")} + ${tip("gp_discrepancy", "GP")} residuals.
          </p>
        </div>
        ${
          !wfState.session.converged
            ? `<button type="button" id="btnIngestPrebuiltRound" class="btn btn-primary">Load &amp; Auto-Grade Round ${targetRound} Cleanroom Results (3 Wafers)</button>`
            : `<span class="badge badge-ok mono">Qualified Winner Found: ${esc(wfState.session.winning_wafer_id)} ✓</span>`
        }
      </div>

      ${renderStepExplainer("6")}

      ${
        hasRoundResults
          ? `
        <div class="guided-subcard ${latestRound.summary.pass_count > 0 ? "is-pass" : ""}" style="background:var(--surface);">
          <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.5rem;">
            <h3 style="margin:0; font-size:0.98rem;">${esc(latestRound.label)} · ${latestRound.summary.pass_count} / ${latestRound.summary.count} Wafers Meet All TSMC Criteria</h3>
            <span class="badge ${latestRound.summary.pass_count > 0 ? "badge-ok" : "badge-warn"} mono">
              ${latestRound.summary.pass_count > 0 ? "100% TSMC SPEC MET ✓" : "Near-Miss Trade-Off Discovered → See Step 7"}
            </span>
          </div>
          ${renderWaferGradingTable(latestRound.summary.wafers, `${latestRound.label} Line-by-Line TSMC Scorecard`)}
        </div>
      `
          : `<div class="guided-subcard"><p style="margin:0; font-size:0.84rem; color:var(--muted);">Click <b>Load &amp; Auto-Grade Round ${targetRound} Cleanroom Results</b> above to ingest the new 3-wafer experimental split.</p></div>`
      }

      <details class="guided-details">
        <summary>Or Enter a Custom Cleanroom Wafer Measurement Manually (Optional)</summary>
        <div class="form-grid" style="margin-block-start:0.6rem;">
          <label>Wafer ID <input id="wfCustExpId" type="text" value="TSMC-CUST-01" /></label>
          <label>RF Frequency (MHz) <input id="wfCustFreq" type="number" step="0.01" value="27.12" /></label>
          <label>Measured PH₁₁₀ (nm) <input id="wfCustPh110" type="number" step="1" value="995" /></label>
          <label>Measured PH₂₂₅ (nm) <input id="wfCustPh225" type="number" step="1" value="997" /></label>
          <label>Measured Planar OB (nm) <input id="wfCustOb" type="number" step="1" value="66" /></label>
          <label>Measured XRR Density ρ (g/cm³) <input id="wfCustRho" type="number" step="0.01" value="1.84" /></label>
        </div>
        <button type="button" id="btnIngestCustomSingleWafer" class="btn">Ingest Custom Wafer &amp; Grade vs. TSMC Spec</button>
      </details>

      <div class="guided-footer-nav">
        <button type="button" class="btn" data-nav-step="5">← Back to Step 5 (Bayesian Optimize)</button>
        <button type="button" id="btnStep6Next" class="btn btn-primary">
          ${
            !hasRoundResults
              ? `Ingest Round ${targetRound} Results & Continue →`
              : wfState.session.converged
              ? "Target Met! Continue to Step 8 (Qualification Sign-Off) →"
              : "Continue to Step 7 (Inspect Discovery & Update Knowledge Base) →"
          }
        </button>
      </div>
    `;
  }

  function renderStep7UpdateKB() {
    const s7 = wfState.step7_kb_update || {};
    const rule = s7.candidate_rule || {};

    return `
      <div class="guided-step-header">
        <div>
          <div class="guided-eyebrow">Step 7 of 8 · Closed-Loop Knowledge Base Governance</div>
          <h2 class="guided-title">Inspect New Experimental Discovery &amp; Update Knowledge Base (If Needed)</h2>
          <p class="guided-lead">
            Whenever new cleanroom wafers reveal an unmodeled physical or chemical coupling, the platform surfaces a candidate AST rule so your team's proprietary Knowledge Base compounds across rounds (<code>KB v2.1 → KB v2.2</code>).
          </p>
        </div>
        <span class="badge ${s7.already_promoted ? "badge-ok" : s7.needed ? "badge-warn" : "badge-ok"} mono">
          Current KB: ${esc(wfState.step3_kb.kb_version_label)}
        </span>
      </div>

      ${renderStepExplainer("7")}

      <div class="guided-subcard ${s7.already_promoted ? "is-pass" : s7.needed ? "is-selected" : ""}" style="background:var(--surface);">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:0.45rem; flex-wrap:wrap;">
          <strong style="font-size:0.95rem;">Residual &amp; Mechanism Diagnosis</strong>
          <span class="badge ${s7.needed ? "badge-warn" : "badge-ok"} mono">
            ${s7.already_promoted ? "Promoted to KB v2.2 ✓" : s7.needed ? "New Cleanroom Coupling Detected" : "Model Calibrated Within ±1.2σ"}
          </span>
        </div>
        <p style="margin:0; font-size:0.84rem;">${esc(s7.diagnosis || "")}</p>

        <div style="padding:0.75rem 0.85rem; border-radius:0.5rem; background:var(--surface-alt); border:1px solid var(--border);">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:0.4rem;">
            <strong style="font-size:0.86rem;">${esc(rule.title || "")}</strong>
            <span class="badge badge-ok mono">${esc(rule.rule_id || "PROP-TSMC-06")}</span>
          </div>
          <div class="mono" style="font-size:0.76rem; color:var(--brand); margin-block:0.25rem;">
            AST Condition: if (${esc(rule.condition_expr || "")}) → favor (ΔPH₁₁₀ +18 nm, ΔOB −18 nm)
          </div>
          <div style="font-size:0.79rem; color:var(--muted);">${esc(rule.description || "")}</div>
        </div>

        <div style="display:flex; gap:0.55rem; flex-wrap:wrap;">
          <button type="button" id="btnPromoteRound1Rule" class="btn btn-primary" ${s7.already_promoted ? "disabled" : ""}>
            ${s7.already_promoted ? "✓ Rule PROP-TSMC-06 Active in KB v2.2" : "✓ Promote Rule PROP-TSMC-06 into Knowledge Base (Upgrade → KB v2.2)"}
          </button>
          <button type="button" id="btnSkipKbUpdate" class="btn">Keep Current KB Without Promoting</button>
        </div>
      </div>

      <div class="guided-footer-nav">
        <button type="button" class="btn" data-nav-step="6">← Back to Step 6 (Ingested Results)</button>
        <button type="button" data-nav-step="8" class="btn btn-primary">Continue to Step 8 (Iterate Steps 4–6 to Convergence) →</button>
      </div>
    `;
  }

  function renderStep8Convergence() {
    const s8 = wfState.step8_convergence || {};
    const conv = Boolean(s8.converged);
    const win = s8.winning_wafer;
    const traj = s8.trajectory || [];
    const spec = wfState.step1_spec.active_spec;

    return `
      <div class="guided-step-header">
        <div>
          <div class="guided-eyebrow">Step 8 of 8 · Closed-Loop Convergence &amp; Qualification Sign-Off</div>
          <h2 class="guided-title">
            ${conv ? `Target Met! ${esc(win.exp_id)} Satisfies 100% of TSMC N2 Requirements in ${s8.current_round} DoE Rounds` : "Convergence Loop: Iterate Steps 4 → 6 Until All TSMC Criteria Pass"}
          </h2>
          <p class="guided-lead">
            ${
              conv
                ? "Starting from 0/8 passing baseline coupons, the closed-loop pyramid (KB + Multi-Scale Sim + Bayesian Optimization + Auto-Grading) converged to a repeatably spec-compliant cleanroom recipe."
                : "Round 1 solved seamless bottom-up fill (993.8 nm) and low overburden (65.8 nm) on separate splits, and Step 7 encoded the Trim × Temperature density rule into KB v2.2. Run Round 2 now to hit all TSMC criteria simultaneously!"
            }
          </p>
        </div>
        <span class="badge ${conv ? "badge-ok" : "badge-warn"} mono" style="font-size:0.82rem;">
          ${conv ? "GATE: QUALIFIED ✓" : `GATE: ITERATE ROUND ${(s8.current_round || 0) + 1}`}
        </span>
      </div>

      ${renderStepExplainer("8")}

      ${
        !conv
          ? `
        <div class="guided-subcard is-selected">
          <h3 style="margin:0; font-size:0.96rem;">Next Iteration Ready (${esc(wfState.step3_kb.kb_version_label)} Active)</h3>
          <p style="margin:0; font-size:0.82rem; color:var(--muted);">
            You can either step through Round ${(s8.current_round || 0) + 1} manually (` + "`Step 4B → Step 5 → Step 6`" + `) or execute the next closed-loop iteration (` + "`BO Suggest → Cleanroom Ingest → TSMC Spec Check`" + `) automatically with 1 click:
          </p>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap; margin-block-start:0.25rem;">
            <button type="button" id="btnAutoFinishConvergence" class="btn btn-primary">⚡ Run Round ${(s8.current_round || 0) + 1} Loop (Steps 4–6) to Convergence Now</button>
            <button type="button" data-nav-step="4B" class="btn">↻ Step Through Round ${(s8.current_round || 0) + 1} Manually (Go to Step 4B)</button>
          </div>
        </div>
      `
          : `
        <div class="guided-subcard is-pass">
          <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.5rem;">
            <div>
              <div class="guided-eyebrow" style="color:var(--ok);">TSMC N2 Qualification Certificate · ${esc(wfState.step3_kb.kb_version_label)}</div>
              <h3 style="margin:0.15rem 0 0; font-size:1.05rem;">Qualified Chamber Recipe: ${esc(win.exp_id)} (Applied Materials Producer® 27.12 MHz Cyclic DED)</h3>
            </div>
            <div style="display:flex; gap:0.45rem; flex-wrap:wrap;">
              <button type="button" id="btnExportQualJson" class="btn btn-primary">Export Qualification Sign-Off (.json)</button>
              <button type="button" id="btnOpenBenchFromWin" class="btn">Inspect in 6-Tab Workbench</button>
            </div>
          </div>

          <div class="guided-metric-strip">
            <div class="guided-metric-box">
              <div class="m-lbl">PH₁₁₀ (Spec &ge; ${spec.ph_min_nm} nm)</div>
              <div class="m-val mono" style="color:var(--ok);">${win.measured.ph_depth_110_nm} nm ✓</div>
            </div>
            <div class="guided-metric-box">
              <div class="m-lbl">PH₂₂₅ (Spec &ge; ${spec.ph_min_nm} nm)</div>
              <div class="m-val mono" style="color:var(--ok);">${win.measured.ph_depth_225_nm} nm ✓</div>
            </div>
            <div class="guided-metric-box">
              <div class="m-lbl">Planar OB (Spec &le; ${spec.ob_max_nm} nm)</div>
              <div class="m-val mono" style="color:var(--ok);">${win.measured.ob_nm} nm ✓</div>
            </div>
            <div class="guided-metric-box">
              <div class="m-lbl">XRR Density (Spec &ge; ${spec.density_min_g_cm3 ?? 1.80})</div>
              <div class="m-val mono" style="color:var(--ok);">${win.measured.film_density_g_cm3} g/cm³ ✓</div>
            </div>
            <div class="guided-metric-box">
              <div class="m-lbl">AFM R_q (Spec &le; ${wfState.step1_spec.afm_rq_max_nm} nm)</div>
              <div class="m-val mono" style="color:var(--ok);">${win.measured.afm_rms_nm} nm ✓</div>
            </div>
            <div class="guided-metric-box">
              <div class="m-lbl">Cracks / Nodules</div>
              <div class="m-val mono" style="color:var(--ok);">None / None ✓</div>
            </div>
          </div>

          <div class="mono" style="font-size:0.78rem; padding:0.55rem 0.7rem; border-radius:0.45rem; background:var(--surface); border:1px solid var(--border);">
            <b>Locked Producer Recipe (${esc(win.exp_id)}):</b> RF = ${win.recipe.freq_mhz} MHz · Power = ${win.recipe.power_w} W · Gap = ${win.recipe.gap_mils} mils · Pressure = ${win.recipe.pressure_torr} Torr · Ar = ${win.recipe.ar_sccm} sccm · C₂H₂ = ${win.recipe.c2h2_sccm} sccm · NH₃ = ${win.recipe.nh3_sccm} sccm (N/C = ${(win.recipe.nh3_sccm / win.recipe.c2h2_sccm).toFixed(3)}) · Chuck T = ${win.recipe.temp_c} °C · Cyclic Ar/NH₃ Trim = ${Math.round((win.recipe.trim_fraction || 0) * 100)}% · Dep Time = ${win.recipe.dep_time_s} s
          </div>
        </div>
      `
      }

      <div class="guided-two-col">
        <figure class="guided-figure">
          <strong style="font-size:0.86rem;">Round-by-Round Convergence Trajectory (PH₁₁₀ Fill Rise &amp; Overburden Drop)</strong>
          <canvas id="guidedFigTrajectory" width="660" height="300" role="img" aria-label="Line chart of round-by-round best 110 nm penetration depth rising above 985 nm and planar overburden dropping below 85 nm from Baseline Round 0 through Round 2"></canvas>
          <figcaption>
            Tracks best penetration depth <code>PH₁₁₀</code> (emerald, target &ge; ${spec.ph_min_nm} nm) and lowest planar overburden <code>OB</code> (amber, target &le; ${spec.ob_max_nm} nm) across each round.
          </figcaption>
        </figure>

        <div class="guided-subcard" style="background:var(--surface);">
          <h3 style="margin:0; font-size:0.94rem;">Campaign Progression Summary</h3>
          <div tabindex="0" role="region" aria-label="Round progression summary" class="table-wrapper">
            <table>
              <caption>Qualification Rounds Summary</caption>
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Wafers</th>
                  <th scope="col">Best PH₁₁₀</th>
                  <th scope="col">Lowest OB</th>
                  <th scope="col">TSMC Pass</th>
                </tr>
              </thead>
              <tbody>
                ${
                  traj.length
                    ? traj
                        .map(
                          (t) => `
                    <tr>
                      <th scope="row">${esc(t.label)}</th>
                      <td class="mono">${t.count}</td>
                      <td class="mono">${t.best_ph_110_nm} nm</td>
                      <td class="mono">${t.lowest_ob_nm ?? "--"} nm</td>
                      <td><span class="badge ${t.pass_count > 0 ? "badge-ok" : "badge-warn"} mono">${t.pass_count} / ${t.count}</span></td>
                    </tr>
                  `
                        )
                        .join("")
                    : `<tr><td colspan="5" style="color:var(--muted);">No rounds ingested yet — run Steps 2–6 or click Auto-Run above.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="guided-footer-nav">
        <button type="button" class="btn" data-nav-step="7">← Back to Step 7 (Knowledge Base Update)</button>
        <button type="button" id="btnStep8ResetReplay" class="btn">↺ Reset &amp; Replay Guided TSMC Demo from Step 0</button>
      </div>
    `;
  }

  // ------------------------------------------------------------------------
  // High-DPI Canvas Renderers for Step 4B & Step 8 Figures
  // ------------------------------------------------------------------------
  function setupHiDpiCanvas(canvas, logicalW, logicalH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = rect.width > 40 ? rect.width : logicalW;
    const h = Math.round((w / logicalW) * logicalH);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return { ctx, w, h, dark };
  }

  function drawCrossSectionFigure() {
    const canvas = qs("#guidedFigCrossSection");
    if (!canvas || !wfState) return;
    const items = wfState.step4_sim_and_understanding.understanding.figure1_cross_sections || [];
    if (!items.length) return;
    const { ctx, w, h, dark } = setupHiDpiCanvas(canvas, 680, 370);

    const bg = dark ? "#0f172a" : "#ffffff";
    const textCol = dark ? "#e2e8f0" : "#0f172a";
    const mutedCol = dark ? "#94a3b8" : "#475569";
    const oxideCol = dark ? "#1e293b" : "#dbeafe";
    const carbonCol = dark ? "#38bdf8" : "#0284c7";
    const carbonPassCol = dark ? "#34d399" : "#059669";
    const voidCol = dark ? "#ef4444" : "#dc2626";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const colW = w / 3;
    const topFieldY = 96;
    const floorY = h - 54;
    const trenchH = floorY - topFieldY;
    const obScale = 0.22; // nm -> px

    // Dashed TSMC OB <= 85 nm reference line across all 3 panels
    const obCapY = topFieldY - 85 * obScale;
    ctx.save();
    ctx.strokeStyle = dark ? "#fbbf24" : "#b45309";
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(14, obCapY);
    ctx.lineTo(w - 14, obCapY);
    ctx.stroke();
    ctx.fillStyle = dark ? "#fbbf24" : "#b45309";
    ctx.font = "600 10.5px ui-monospace, SFMono-Regular, monospace";
    ctx.fillText("TSMC Max OB Cap (85 nm)", 16, obCapY - 5);
    ctx.restore();

    items.forEach((it, idx) => {
      const cx = colW * (idx + 0.5);
      const halfMold = Math.min(34, colW * 0.16);
      const blockHalf = colW * 0.41;
      const isPass = idx === 2;
      const fillCol = isPass ? carbonPassCol : carbonCol;

      // Header titles
      ctx.fillStyle = textCol;
      ctx.font = "700 11.5px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(it.title, cx, 22);
      ctx.fillStyle = mutedCol;
      ctx.font = "10.5px system-ui, sans-serif";
      ctx.fillText(it.subtitle, cx, 37);

      // SiO2 Mold Blocks (Left & Right)
      ctx.fillStyle = oxideCol;
      ctx.fillRect(cx - blockHalf, topFieldY, blockHalf - halfMold, trenchH);
      ctx.fillRect(cx + halfMold, topFieldY, blockHalf - halfMold, trenchH);
      ctx.fillRect(cx - blockHalf, floorY, blockHalf * 2, 12);

      // Carbon Overburden on Top Planar Field
      const obPx = Math.min(54, it.ob_nm * obScale);
      ctx.fillStyle = fillCol;
      ctx.fillRect(cx - blockHalf, topFieldY - obPx, blockHalf - halfMold + (idx === 0 ? 12 : idx === 1 ? 5 : 1), obPx);
      ctx.fillRect(cx + halfMold - (idx === 0 ? 12 : idx === 1 ? 5 : 1), topFieldY - obPx, blockHalf - halfMold + (idx === 0 ? 12 : idx === 1 ? 5 : 1), obPx);

      // Carbon Fill Inside the 110 nm HAR Via
      ctx.fillStyle = fillCol;
      ctx.fillRect(cx - halfMold, topFieldY, halfMold * 2, trenchH);

      // Keyhole Void if void_width_nm > 0
      if (it.void_width_nm > 0.5) {
        const voidHalfPx = Math.max(4, (it.void_width_nm / 110) * halfMold);
        const sealY = topFieldY + Math.max(0.18, Math.min(0.86, it.ph_110_nm / 1000)) * trenchH;
        const voidBotY = floorY - 12;
        if (voidBotY > sealY + 6) {
          ctx.fillStyle = bg;
          ctx.beginPath();
          ctx.ellipse(cx, (sealY + voidBotY) * 0.5, voidHalfPx, (voidBotY - sealY) * 0.46, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = voidCol;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      } else {
        // Bridge top cap cleanly for seamless plug
        ctx.fillStyle = fillCol;
        ctx.fillRect(cx - halfMold, topFieldY - obPx * 0.82, halfMold * 2, obPx * 0.85);
      }

      // Trim / Ion Flux Arrows on Panel C
      if (idx === 2) {
        ctx.strokeStyle = dark ? "#fbbf24" : "#d97706";
        ctx.lineWidth = 1.4;
        [-halfMold - 8, halfMold + 8].forEach((dx) => {
          ctx.beginPath();
          ctx.moveTo(cx + dx, topFieldY - obPx - 14);
          ctx.lineTo(cx + dx * 0.65, topFieldY - 2);
          ctx.stroke();
        });
      }

      // Bottom Readout Strip
      ctx.fillStyle = isPass ? (dark ? "#34d399" : "#047857") : voidCol;
      ctx.font = "700 10.5px ui-monospace, SFMono-Regular, monospace";
      ctx.fillText(`PH=${it.ph_110_nm}nm · OB=${it.ob_nm}nm`, cx, h - 24);
      ctx.fillStyle = mutedCol;
      ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
      ctx.fillText(`β_eff=${it.beta_eff} · ρ=${it.density_g_cm3} g/cm³`, cx, h - 9);
    });
    ctx.textAlign = "start";
  }

  function drawRegimeMapFigure() {
    const canvas = qs("#guidedFigRegimeMap");
    if (!canvas || !wfState) return;
    const map = wfState.step4_sim_and_understanding.understanding.figure2_regime_map;
    if (!map) return;
    const { ctx, w, h, dark } = setupHiDpiCanvas(canvas, 680, 370);

    const bg = dark ? "#0f172a" : "#ffffff";
    const textCol = dark ? "#e2e8f0" : "#0f172a";
    const mutedCol = dark ? "#94a3b8" : "#475569";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const pad = { l: 56, r: 22, t: 26, b: 46 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;
    const xMin = map.x_axis.min;
    const xMax = map.x_axis.max;
    const yMin = map.y_axis.min;
    const yMax = map.y_axis.max;
    const sx = (v) => pad.l + ((v - xMin) / (xMax - xMin)) * pw;
    const sy = (v) => pad.t + ph - ((v - yMin) / (yMax - yMin)) * ph;

    // Zone 1: Left Low-N/C Keyhole Pinch-Off Zone (N/C < 0.30)
    ctx.fillStyle = dark ? "rgba(239, 68, 68, 0.14)" : "rgba(220, 38, 38, 0.09)";
    ctx.fillRect(sx(xMin), pad.t, sx(0.30) - sx(xMin), ph);

    // Zone 2: Bottom Low-Trim Excess Overburden Zone (Trim < 14%)
    ctx.fillStyle = dark ? "rgba(245, 158, 11, 0.13)" : "rgba(217, 119, 6, 0.09)";
    ctx.fillRect(sx(0.30), sy(14), sx(xMax) - sx(0.30), sy(0) - sy(14));

    // Zone 3: Far-Right Excess-NH3 Soft Film Zone (N/C > 0.385)
    ctx.fillStyle = dark ? "rgba(168, 85, 247, 0.14)" : "rgba(147, 51, 234, 0.08)";
    ctx.fillRect(sx(0.385), pad.t, sx(xMax) - sx(0.385), sy(14) - pad.t);

    // Target Sweet-Spot Box
    const sb = map.sweet_spot_box;
    const bx = sx(sb.nc_min);
    const by = sy(sb.trim_max);
    const bw = sx(sb.nc_max) - bx;
    const bh = sy(sb.trim_min) - by;
    ctx.fillStyle = dark ? "rgba(52, 211, 153, 0.20)" : "rgba(16, 185, 129, 0.15)";
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = dark ? "#34d399" : "#059669";
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);

    // Zone Labels
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.fillStyle = dark ? "#f87171" : "#b91c1c";
    ctx.fillText("Mouth Pinch-Off", sx(0.21), pad.t + 18);
    ctx.fillText("(β_eff too high)", sx(0.21), pad.t + 31);

    ctx.fillStyle = dark ? "#fbbf24" : "#b45309";
    ctx.fillText(`OB > ${map.ob_cap_nm} nm (Insufficient Mouth Trim)`, sx(0.31), sy(4));

    ctx.fillStyle = dark ? "#c084fc" : "#7e22ce";
    ctx.fillText("ρ < 1.80 (-NH₂", sx(0.388), pad.t + 18);
    ctx.fillText("Dilution)", sx(0.388), pad.t + 31);

    ctx.fillStyle = dark ? "#34d399" : "#047857";
    ctx.font = "700 10.5px system-ui, sans-serif";
    ctx.fillText("TSMC Target Window", bx + 6, by + 15);

    // Axes & Ticks
    ctx.strokeStyle = dark ? "#334155" : "#94a3b8";
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.l, pad.t, pw, ph);

    ctx.fillStyle = mutedCol;
    ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
    [0.20, 0.25, 0.30, 0.35, 0.40, 0.44].forEach((xv) => {
      const px = sx(xv);
      ctx.fillText(xv.toFixed(2), px - 12, pad.t + ph + 15);
    });
    [0, 10, 20, 30].forEach((yv) => {
      const py = sy(yv);
      ctx.fillText(`${yv}%`, pad.l - 30, py + 4);
    });

    ctx.fillStyle = textCol;
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillText(map.x_axis.label, pad.l + pw * 0.28, h - 8);
    ctx.save();
    ctx.translate(15, pad.t + ph * 0.72);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(map.y_axis.label, 0, 0);
    ctx.restore();

    // Plot Points
    (map.points || []).forEach((pt) => {
      const px = sx(Math.max(xMin, Math.min(xMax, pt.nc_ratio)));
      const py = sy(Math.max(yMin, Math.min(yMax, pt.trim_pct)));
      ctx.save();
      if (pt.kind === "simulation") {
        ctx.fillStyle = dark ? "#38bdf8" : "#0284c7";
        ctx.beginPath();
        ctx.moveTo(px, py - 5);
        ctx.lineTo(px + 5, py);
        ctx.lineTo(px, py + 5);
        ctx.lineTo(px - 5, py);
        ctx.closePath();
        ctx.fill();
      } else if (pt.kind === "winner") {
        ctx.fillStyle = dark ? "#34d399" : "#059669";
        ctx.beginPath();
        ctx.arc(px, py, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = textCol;
        ctx.font = "700 10px ui-monospace, SFMono-Regular, monospace";
        ctx.fillText(pt.id, px + 8, py - 5);
      } else if (pt.kind === "round_wafer") {
        ctx.fillStyle = dark ? "#fbbf24" : "#d97706";
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = dark ? "#f87171" : "#dc2626";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px - 4, py - 4);
        ctx.lineTo(px + 4, py + 4);
        ctx.moveTo(px + 4, py - 4);
        ctx.lineTo(px - 4, py + 4);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawTrajectoryFigure() {
    const canvas = qs("#guidedFigTrajectory");
    if (!canvas || !wfState) return;
    const traj = wfState.step8_convergence.trajectory || [];
    const { ctx, w, h, dark } = setupHiDpiCanvas(canvas, 660, 300);

    const bg = dark ? "#0f172a" : "#ffffff";
    const textCol = dark ? "#e2e8f0" : "#0f172a";
    const mutedCol = dark ? "#94a3b8" : "#475569";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (!traj.length) {
      ctx.fillStyle = mutedCol;
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText("Load baseline data (Step 2) & run rounds to plot qualification trajectory.", 36, h / 2);
      return;
    }

    const pad = { l: 54, r: 54, t: 28, b: 44 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;
    const n = traj.length;
    const sx = (i) => (n === 1 ? pad.l + pw / 2 : pad.l + (i / (n - 1)) * pw);
    const syPh = (v) => pad.t + ph - ((Math.max(850, Math.min(1005, v)) - 850) / 155) * ph;
    const syOb = (v) => pad.t + ph - ((Math.max(40, Math.min(180, v)) - 40) / 140) * ph;

    ctx.strokeStyle = dark ? "#334155" : "#cbd5e1";
    ctx.strokeRect(pad.l, pad.t, pw, ph);

    // Spec lines
    const specPh = wfState.step1_spec.active_spec.ph_min_nm;
    const specOb = wfState.step1_spec.active_spec.ob_max_nm;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = dark ? "#34d399" : "#059669";
    ctx.beginPath();
    ctx.moveTo(pad.l, syPh(specPh));
    ctx.lineTo(pad.l + pw, syPh(specPh));
    ctx.stroke();

    ctx.strokeStyle = dark ? "#fbbf24" : "#d97706";
    ctx.beginPath();
    ctx.moveTo(pad.l, syOb(specOb));
    ctx.lineTo(pad.l + pw, syOb(specOb));
    ctx.stroke();
    ctx.restore();

    // PH line
    ctx.strokeStyle = dark ? "#34d399" : "#059669";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    traj.forEach((t, i) => {
      const x = sx(i);
      const y = syPh(t.best_ph_110_nm);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // OB line
    ctx.strokeStyle = dark ? "#fbbf24" : "#d97706";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    traj.forEach((t, i) => {
      const x = sx(i);
      const y = syOb(t.lowest_ob_nm || 120);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    traj.forEach((t, i) => {
      const x = sx(i);
      const y1 = syPh(t.best_ph_110_nm);
      const y2 = syOb(t.lowest_ob_nm || 120);
      ctx.fillStyle = dark ? "#34d399" : "#059669";
      ctx.beginPath();
      ctx.arc(x, y1, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "700 10.5px ui-monospace, SFMono-Regular, monospace";
      ctx.fillText(`PH ${t.best_ph_110_nm}nm`, x - 28, y1 - 9);

      ctx.fillStyle = dark ? "#fbbf24" : "#d97706";
      ctx.beginPath();
      ctx.arc(x, y2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(`OB ${t.lowest_ob_nm}nm`, x - 26, y2 + 16);

      ctx.fillStyle = textCol;
      ctx.font = "600 10.5px system-ui, sans-serif";
      ctx.fillText(`Round ${t.round}`, x - 20, pad.t + ph + 20);
    });
  }

  function drawStepCanvases() {
    drawCrossSectionFigure();
    drawRegimeMapFigure();
    drawTrajectoryFigure();
  }

  // ------------------------------------------------------------------------
  // Render Active Step & Bind Interactive Controls
  // ------------------------------------------------------------------------
  function renderCurrentStep() {
    const mount = qs("#guidedStageMount");
    if (!mount || !wfState) return;

    let html = "";
    switch (activeStep) {
      case "0": html = renderStep0Intro(); break;
      case "1": html = renderStep1Spec(); break;
      case "2": html = renderStep2LoadData(); break;
      case "3": html = renderStep3KnowledgeBase(); break;
      case "4A": html = renderStep4ASimulations(); break;
      case "4B": html = renderStep4BUnderstanding(); break;
      case "5": html = renderStep5Optimize(); break;
      case "6": html = renderStep6IngestResults(); break;
      case "7": html = renderStep7UpdateKB(); break;
      case "8": html = renderStep8Convergence(); break;
      default: html = renderStep0Intro();
    }
    mount.innerHTML = html;
    wireHintPopovers(mount);
    bindStepEvents(mount);
    requestAnimationFrame(drawStepCanvases);
  }

  function downloadBlob(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bindStepEvents(mount) {
    mount.querySelectorAll("[data-nav-step]").forEach((btn) => {
      btn.addEventListener("click", () => goToStep(btn.getAttribute("data-nav-step")));
    });

    // Expand / Collapse All deep-dive accordions (`accordion` guide: sync `aria-expanded` from items)
    mount.querySelectorAll("[data-toggle-explain-acc]").forEach((btn) => {
      const acc = document.getElementById(btn.getAttribute("data-toggle-explain-acc") || "");
      if (!acc) return;
      const syncBtn = () => {
        const items = Array.from(acc.querySelectorAll(":scope > details"));
        const allOpen = items.length > 0 && items.every((d) => d.open);
        btn.setAttribute("aria-expanded", allOpen ? "true" : "false");
      };
      syncBtn();
      btn.addEventListener("click", () => {
        const expand = btn.getAttribute("aria-expanded") !== "true";
        acc.querySelectorAll(":scope > details").forEach((d) => {
          d.open = expand;
        });
        syncBtn();
      });
      acc.addEventListener("toggle", syncBtn, { capture: true });
    });

    // Step 0 buttons
    qs("#btnStartGuidedStep1")?.addEventListener("click", () => goToStep("1"));
    qs("#btnIntroGoStep1Bottom")?.addEventListener("click", () => goToStep("1"));
    qs("#btnIntroOpenWorkbench")?.addEventListener("click", () => setInterfaceMode("workbench"));
    if (activeStep === "0" && window.PANG_SPRINTS_HUB && typeof window.PANG_SPRINTS_HUB.mount === "function") {
      window.PANG_SPRINTS_HUB.mount();
    }

    // Step 1 buttons
    mount.querySelectorAll("[data-select-preset]").forEach((btn) => {
      btn.addEventListener("click", () =>
        runAction(btn, async () => {
          const pid = btn.getAttribute("data-select-preset");
          wfState = await wfCall("/api/workflow/step1_spec", "POST", { preset_id: pid });
          toast(`Applied client specification preset: ${pid}`);
          renderCurrentStep();
          updateStepperBar();
        })
      );
    });

    qs("#btnSaveCustomWfSpec")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        const customSpec = {
          name: qs("#wfSpecName")?.value || "Custom TSMC Spec",
          ph_min_nm: Number(qs("#wfSpecPhMin")?.value || 985),
          ob_max_nm: Number(qs("#wfSpecObMax")?.value || 85),
          ob_target_nm: Math.min(50, Number(qs("#wfSpecObMax")?.value || 85) - 10),
          density_min_g_cm3: Number(qs("#wfSpecDensity")?.value || 1.80),
        };
        const afmMax = Number(qs("#wfSpecAfm")?.value || 1.60);
        wfState = await wfCall("/api/workflow/step1_spec", "POST", {
          preset_id: "tsmc_n2_plug",
          custom_spec: customSpec,
          afm_rq_max_nm: afmMax,
        });
        toast("Saved custom acceptance thresholds.");
        renderCurrentStep();
        updateStepperBar();
      })
    );

    qs("#btnLockStep1Next")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        const curPreset = wfState.step1_spec.selected_preset;
        if (curPreset !== "custom") {
          wfState = await wfCall("/api/workflow/step1_spec", "POST", { preset_id: curPreset });
        }
        goToStep("2");
      })
    );

    // Step 2 buttons
    mount.querySelectorAll("[data-load-lot]").forEach((btn) => {
      btn.addEventListener("click", () =>
        runAction(btn, async () => {
          const did = btn.getAttribute("data-load-lot");
          wfState = await wfCall("/api/workflow/step2_load_data", "POST", { dataset_id: did });
          toast(`Loaded dataset (${wfState.step2_data.baseline_summary.count} wafers) & graded against TSMC spec.`);
          renderCurrentStep();
          updateStepperBar();
        })
      );
    });

    qs("#wfUploadInput")?.addEventListener("change", async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      try {
        if (IS_STATIC) {
          const txt = await file.text();
          wfState = await wfCall("/api/workflow/step2_upload", "POST", { filename: file.name, content: txt });
        } else {
          const fd = new FormData();
          fd.append("file", file);
          wfState = await wfCall("/api/workflow/step2_upload", "POST", fd, true);
        }
        toast(`Uploaded ${file.name} into Guided Sandbox.`);
        renderCurrentStep();
        updateStepperBar();
      } catch (err) {
        toast(`Upload failed: ${err.message}`);
      }
    });

    qs("#btnStep2Next")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        if (!wfState.step2_data.baseline_summary.count) {
          wfState = await wfCall("/api/workflow/step2_load_data", "POST", { dataset_id: "amat_producer_baseline_8" });
          toast("Loaded prebuilt 8-wafer Producer baseline lot.");
        }
        goToStep("3");
      })
    );

    // Step 3 buttons
    let wfActiveConfigPreset = "tsmc_vhf_plug_trim";
    let wfStatusTimer = null;
    const runGuidedStep3Search = async () => {
      const qVal = (qs("#wfStep3KeywordInput") && qs("#wfStep3KeywordInput").value.trim()) || "";
      const res = await wfCall("/api/knowledge_base/search", "POST", {
        preset_id: wfActiveConfigPreset || undefined,
        query: qVal,
        top_k: 6,
      });
      const box = qs("#wfStep3ConfigResultsBox");
      if (box) box.innerHTML = renderGuidedConfigSearchResults(res);
      clearTimeout(wfStatusTimer);
      wfStatusTimer = setTimeout(() => {
        const stEl = qs("#wfStep3SearchStatus");
        if (stEl) stEl.textContent = `${res.total_matching_papers} papers · ${(res.matched_dataset_rows || []).length} rows`;
      }, 280);
    };

    mount.querySelectorAll("[data-wf-cfg-preset]").forEach((chip) => {
      chip.addEventListener("click", () => {
        wfActiveConfigPreset = chip.getAttribute("data-wf-cfg-preset") || "";
        mount.querySelectorAll("[data-wf-cfg-preset]").forEach((c) => {
          c.setAttribute("aria-pressed", String(c === chip));
        });
        runGuidedStep3Search();
      });
    });

    qs("#wfStep3KeywordInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        runGuidedStep3Search();
      }
    });

    qs("#wfConfigSearchForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      runGuidedStep3Search();
    });

    mount.querySelectorAll("[data-select-kb]").forEach((btn) => {
      btn.addEventListener("click", () =>
        runAction(btn, async () => {
          const key = btn.getAttribute("data-select-kb");
          wfState = await wfCall("/api/workflow/step3_select_kb", "POST", { kb_key: key });
          toast(`Activated ${wfState.step3_kb.kb_version_label} & recalibrated Brain.`);
          renderCurrentStep();
          updateStepperBar();
        })
      );
    });

    qs("#btnStep3Next")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        wfState = await wfCall("/api/workflow/step3_select_kb", "POST", {
          kb_key: wfState.step3_kb.selected_kb_key,
        });
        goToStep("4A");
      })
    );

    // Step 4A buttons
    qs("#btnLoadPrebuiltSims")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        wfState = await wfCall("/api/workflow/step4_simulate", "POST", { mode: "preload_pack" });
        toast("Assimilated 6 multi-scale CCP + Knudsen + 3D Molecular simulations.");
        renderCurrentStep();
        updateStepperBar();
      })
    );

    qs("#btnRunLiveCustomSim")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        const customRecipe = {
          freq_mhz: Number(qs("#wfSimFreq")?.value || 27.12),
          nh3_sccm: Number(qs("#wfSimNh3")?.value || 222),
          temp_c: Number(qs("#wfSimTemp")?.value || 565),
          trim_fraction: Number(qs("#wfSimTrimPct")?.value || 21) / 100.0,
        };
        wfState = await wfCall("/api/workflow/step4_simulate", "POST", {
          mode: "custom",
          custom_recipe: customRecipe,
          custom_purpose: `Live Probe (${customRecipe.freq_mhz}MHz, NH3=${customRecipe.nh3_sccm}, Trim=${Math.round(customRecipe.trim_fraction * 100)}%)`,
        });
        toast("Executed live CCP + Knudsen + 3D MMFF94s simulation & updated Brain!");
        renderCurrentStep();
        updateStepperBar();
      })
    );

    qs("#btnStep4ANext")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        if (!wfState.step4_sim_and_understanding.simulation_count) {
          wfState = await wfCall("/api/workflow/step4_simulate", "POST", { mode: "preload_pack" });
        }
        goToStep("4B");
      })
    );

    // Step 5 buttons
    qs("#btnRunWfBo")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        wfState = await wfCall("/api/workflow/step5_optimize", "POST", { batch_size: 3 });
        toast("Bayesian Optimization proposed 3 diverse cleanroom wafers with logged UUIDs.");
        renderCurrentStep();
        updateStepperBar();
      })
    );

    qs("#btnExportWfBoCsv")?.addEventListener("click", () => {
      const b = wfState.step5_optimization.latest_batch;
      if (!b || !b.candidates) return;
      const header = "slot_id,suggestion_id,role,freq_mhz,power_w,gap_mils,pressure_torr,ar_sccm,c2h2_sccm,nh3_sccm,temp_c,trim_fraction,dep_time_s,pred_ph110_nm,pred_ob_nm,pred_density,p_meets_spec";
      const rows = b.candidates.map((c) => {
        const r = c.recipe;
        const p = c.predicted;
        return [c.wafer_slot_id, c.suggestion_id, `"${c.exploration_role}"`, r.freq_mhz, r.power_w, r.gap_mils, r.pressure_torr, r.ar_sccm, r.c2h2_sccm, r.nh3_sccm, r.temp_c, r.trim_fraction, r.dep_time_s, p.ph_depth_110_nm, p.ob_nm, p.film_density_g_cm3, p.p_meets_spec].join(",");
      });
      downloadBlob(`tsmc_round_${b.round}_doe_runsheet.csv`, [header, ...rows].join("\n"), "text/csv");
    });

    qs("#btnStep5Next")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        const nextRound = Number(wfState.session.current_round || 0) + 1;
        const latest = wfState.step5_optimization.latest_batch;
        if (!latest || Number(latest.round) !== nextRound) {
          wfState = await wfCall("/api/workflow/step5_optimize", "POST", { batch_size: 3 });
        }
        goToStep("6");
      })
    );

    // Step 6 buttons
    qs("#btnIngestPrebuiltRound")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        wfState = await wfCall("/api/workflow/step6_ingest", "POST", {});
        const lr = wfState.step6_results.latest_round;
        toast(`Ingested ${lr.label}: ${lr.summary.pass_count}/${lr.summary.count} wafers pass TSMC spec.`);
        renderCurrentStep();
        updateStepperBar();
      })
    );

    qs("#btnIngestCustomSingleWafer")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        const cw = [
          {
            exp_id: qs("#wfCustExpId")?.value || "TSMC-CUST-01",
            recipe: {
              freq_mhz: Number(qs("#wfCustFreq")?.value || 27.12),
              nh3_sccm: 220,
              c2h2_sccm: 625,
              temp_c: 565,
              trim_fraction: 0.22,
            },
            measured: {
              ph_depth_110_nm: Number(qs("#wfCustPh110")?.value || 995),
              ph_depth_225_nm: Number(qs("#wfCustPh225")?.value || 997),
              ob_nm: Number(qs("#wfCustOb")?.value || 66),
              film_density_g_cm3: Number(qs("#wfCustRho")?.value || 1.84),
              crack_detected: false,
              nodule_defect: false,
              afm_rms_nm: 1.2,
            },
          },
        ];
        wfState = await wfCall("/api/workflow/step6_ingest", "POST", { custom_wafers: cw });
        toast("Ingested custom cleanroom wafer & graded against TSMC spec.");
        renderCurrentStep();
        updateStepperBar();
      })
    );

    qs("#btnStep6Next")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        if (!wfState.step6_results.latest_round || Number(wfState.step6_results.latest_round.round) === 0) {
          wfState = await wfCall("/api/workflow/step6_ingest", "POST", {});
        }
        goToStep(wfState.session.converged ? "8" : "7");
      })
    );

    // Step 7 buttons
    qs("#btnPromoteRound1Rule")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        wfState = await wfCall("/api/workflow/step7_update_kb", "POST", { action: "promote_round1_rule" });
        toast("Promoted Rule PROP-TSMC-06 → Knowledge Base upgraded to KB v2.2!");
        renderCurrentStep();
        updateStepperBar();
      })
    );

    qs("#btnSkipKbUpdate")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        wfState = await wfCall("/api/workflow/step7_update_kb", "POST", { action: "skip" });
        goToStep("8");
      })
    );

    // Step 8 buttons
    qs("#btnAutoFinishConvergence")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        wfState = await wfCall("/api/workflow/step8_converge_loop", "POST", { auto_finish: true });
        toast(`Converged! Winner ${wfState.session.winning_wafer_id} meets 100% of TSMC N2 criteria.`);
        renderCurrentStep();
        updateStepperBar();
      })
    );

    qs("#btnExportQualJson")?.addEventListener("click", () => {
      const payload = {
        exported_at: new Date().toISOString(),
        program: wfState.step1_spec.active_spec.name,
        kb_version: wfState.step3_kb.kb_version_label,
        winning_wafer: wfState.step8_convergence.winning_wafer,
        trajectory: wfState.step8_convergence.trajectory,
      };
      downloadBlob("tsmc_n2_qualification_signoff.json", JSON.stringify(payload, null, 2), "application/json");
    });

    qs("#btnOpenBenchFromWin")?.addEventListener("click", () =>
      setInterfaceMode("workbench", { preferSandbox: true })
    );

    qs("#btnStep8ResetReplay")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        wfState = await wfCall("/api/workflow/reset", "POST", {});
        toast("Guided TSMC qualification demo reset to Step 0.");
        goToStep("0");
      })
    );
  }

  // ------------------------------------------------------------------------
  // Top-Level Initialization
  // ------------------------------------------------------------------------
  function applyUrlRouteState() {
    try {
      const sp = new URL(window.location.href).searchParams;
      const qMode = sp.get("mode");
      const qStep = sp.get("step");
      const qTab = sp.get("tab");
      const qSprint = Number(sp.get("sprint"));
      if (qMode === "workbench") {
        setInterfaceMode("workbench", { skipUrl: true });
        if (qTab && window.PANGStudioBridge && typeof window.PANGStudioBridge.activateTabById === "function") {
          window.PANGStudioBridge.activateTabById(`tab-${qTab}`);
        }
      } else {
        const targetStep = qStep && STEP_ORDER.includes(qStep) ? qStep : activeStep;
        setInterfaceMode("guided", { skipUrl: true });
        goToStep(targetStep, { skipUrl: true });
        if (targetStep === "0" && qSprint >= 1 && qSprint <= 6 && window.PANG_SPRINTS_HUB) {
          window.PANG_SPRINTS_HUB.selectSprint(qSprint, false);
        }
      }
    } catch (_err) { /* ignore */ }
  }

  async function initGuidedStudio() {
    if (!qs("#guidedProductStudio")) return;

    qs("#btnModeGuided")?.addEventListener("click", () => setInterfaceMode("guided"));
    qs("#btnModeWorkbench")?.addEventListener("click", () => setInterfaceMode("workbench"));

    qs("#btnJumpSprints")?.addEventListener("click", () => {
      setInterfaceMode("guided");
      goToStep("0");
      requestAnimationFrame(() => {
        qs("#productSprintsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    qs("#btnGuidedResetTop")?.addEventListener("click", (ev) =>
      runAction(ev.currentTarget, async () => {
        wfState = await wfCall("/api/workflow/reset", "POST", {});
        setInterfaceMode("guided");
        toast("Guided TSMC demo reset cleanly to Step 0.");
        goToStep("0");
      })
    );

    qsa("[data-guided-step]").forEach((btn) => {
      btn.addEventListener("click", () => goToStep(btn.getAttribute("data-guided-step")));
    });

    window.addEventListener("popstate", applyUrlRouteState);

    window.addEventListener("resize", () => {
      if (!qs("#guidedProductStudio")?.hidden) drawStepCanvases();
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (!qs("#guidedProductStudio")?.hidden) drawStepCanvases();
    });

    try {
      wfState = await wfCall("/api/workflow/state", "GET");
      let initStep = "0";
      let initMode = "guided";
      try {
        const sp = new URL(window.location.href).searchParams;
        if (sp.get("step") && STEP_ORDER.includes(sp.get("step"))) {
          initStep = sp.get("step");
        }
        if (sp.get("mode") === "workbench") {
          initMode = "workbench";
        }
      } catch (_err) { /* ignore */ }
      activeStep = initStep;
      updateStepperBar();
      renderCurrentStep();
      if (initMode === "workbench") {
        setInterfaceMode("workbench", { skipUrl: true });
      }
    } catch (err) {
      const mount = qs("#guidedStageMount");
      if (mount) {
        mount.innerHTML = `<div class="guided-subcard"><h3 style="margin:0;">Guided Studio Error</h3><p style="color:var(--err);">${esc(err.message || err)}</p></div>`;
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGuidedStudio);
  } else {
    initGuidedStudio();
  }
})();
