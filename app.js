/* Client-Side Controller for AtomicDeposition PANG Brain Studio
 *
 * 5-Tier Forward Causal DAG Layout (`renderCausalNetwork`):
 *   Layer 0 (x=0.10W): 8 CCP Reactor & Recipe Knobs
 *   Layer 1 (x=0.30W): 4 Gas-Phase CCP Electrodynamics & Chemistry Nodes
 *   Layer 2 (x=0.50W): 2 Inline OES Actinometry & RF 3w Harmonic Nodes
 *   Layer 3 (x=0.70W): 3 Feature-Scale Knudsen (Kn~60-140) & Bonding Nodes
 *   Layer 4 (x=0.90W): 3 Wafer & Cross-Sectional SEM Metrology Outcomes
 */
(() => {
  const IS_STATIC_DEMO = Boolean(window.WM_BACKEND);
  let brainData = null;
  let activeWorkspace = "live"; // "live" | "sandbox"
  let lastSemResult = null;
  let lastSandboxPred = null;
  let kgLastPred = null;
  let wmInlineData = null;
  let wmSweepData = null;
  let wmSweepAsTable = false;
  let wmInlineFrameIdx = 47;
  let wmInlinePlaying = false;
  let molSimData = null;
  let pendingDeleteExpId = null;
  let kbOverviewCache = null;
  let colorProbeEl = null;

  const molView = {
    rx: 0.36,
    ry: 0.62,
    dragging: false,
    lx: 0,
    ly: 0,
    autoSpin: true,
  };

  const kgState = {
    selectedType: "node",     // "node" | "edge"
    selectedNodeId: "nh3_sccm",
    selectedEdgeIdx: -1,
    filterMode: "all",
    figCategory: "all",
    litDomain: "all",
    litSearch: "",
  };

  let tab1HoveredNodeId = "nh3_sccm";
  let kgBoxes = [];
  let kgRenderedEdges = [];
  let tab1Boxes = [];

  const qs = (sel) => document.querySelector(sel);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function showToast(msg) {
    const el = qs("#toastBanner");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.hidden = true; }, 5200);
  }

  function formatApiError(body, status, fallbackMsg = "Request failed") {
    const detail = body && typeof body === "object" ? body.detail : null;
    if (Array.isArray(detail) && detail.length) {
      return detail
        .map((item) => {
          if (!item || typeof item !== "object") return String(item);
          const loc = Array.isArray(item.loc)
            ? item.loc.filter((p) => p !== "body" && p !== "query").join(".")
            : "";
          const msg = item.msg || JSON.stringify(item);
          return loc ? `${loc}: ${msg}` : msg;
        })
        .join("; ");
    }
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
    if (detail && typeof detail === "object") {
      return detail.message ? String(detail.message) : JSON.stringify(detail);
    }
    return `${fallbackMsg} (HTTP ${status || "error"})`;
  }

  async function readJsonSafe(resp) {
    try {
      return await resp.json();
    } catch (_err) {
      return null;
    }
  }

  async function fetchJsonChecked(url, options = {}, fallbackMsg = "Request failed") {
    if (window.WM_BACKEND && typeof window.WM_BACKEND.handle === "function") {
      let parsedBody = {};
      if (typeof options.body === "string" && options.body.trim()) {
        try {
          parsedBody = JSON.parse(options.body);
        } catch (_err) {
          parsedBody = {};
        }
      }
      return await window.WM_BACKEND.handle(url, parsedBody);
    }
    const resp = await fetch(url, options);
    const body = await readJsonSafe(resp);
    if (!resp.ok) {
      throw new Error(formatApiError(body, resp.status, fallbackMsg));
    }
    return body;
  }

  async function withBusyButton(btn, fn) {
    if (!btn) return fn();
    if (btn.disabled || btn.dataset.busy === "1") return undefined;
    btn.dataset.busy = "1";
    btn.disabled = true;
    try {
      return await fn();
    } finally {
      delete btn.dataset.busy;
      btn.disabled = false;
    }
  }

  function debounce(fn, waitMs = 60) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), waitMs);
    };
  }

  // Resolve CSS `light-dark(...)` custom properties through a probe element so Canvas always gets rgb(...)
  function resolveCssColor(varName, fallback) {
    if (!colorProbeEl) {
      colorProbeEl = document.createElement("span");
      colorProbeEl.style.cssText = "position:fixed;left:-9999px;top:-9999px;pointer-events:none;visibility:hidden;";
      document.body.appendChild(colorProbeEl);
    }
    colorProbeEl.style.color = fallback;
    colorProbeEl.style.color = `var(${varName})`;
    const resolved = getComputedStyle(colorProbeEl).color;
    return resolved && !resolved.includes("light-dark") ? resolved : fallback;
  }

  function themePalette() {
    return {
      text: resolveCssColor("--text", "#e2e8f0"),
      muted: resolveCssColor("--muted", "#94a3b8"),
      surface: resolveCssColor("--surface", "#131b2e"),
      surfaceAlt: resolveCssColor("--surface-alt", "#1a2540"),
      border: resolveCssColor("--border", "#28354f"),
      brand: resolveCssColor("--brand", "#38bdf8"),
      ok: resolveCssColor("--ok", "#34d399"),
      warn: resolveCssColor("--warn", "#fbbf24"),
      err: resolveCssColor("--err", "#f87171"),
    };
  }

  function setupHiDpiCanvas(canvas) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return null;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx, w: rect.width, h: rect.height };
  }

  // ------------------------------------------------------------------
  // Accessible Tabs (`tabs` + `hidden="until-found"` + `container: 'nearest'`)
  // ------------------------------------------------------------------
  const tabs = qsa('[role="tab"]');
  const panels = qsa('[role="tabpanel"]');

  function activateTab(selectedTab, moveFocus = false) {
    tabs.forEach((tab, i) => {
      const isSel = tab === selectedTab;
      tab.setAttribute("aria-selected", String(isSel));
      tab.setAttribute("tabindex", isSel ? "0" : "-1");
      tab.toggleAttribute("focusgroupstart", isSel);
      const panel = qs(`[aria-labelledby="${tab.id}"]`) || panels[i];
      if (!panel) return;
      if (isSel) {
        panel.removeAttribute("hidden");
        panel.setAttribute("tabindex", "0");
      } else {
        panel.setAttribute("hidden", "until-found");
        panel.removeAttribute("tabindex");
      }
    });
    selectedTab.scrollIntoView({ block: "nearest", inline: "nearest", container: "nearest" });
    if (moveFocus) selectedTab.focus();
    const benchWrap = qs("#advancedWorkbenchWrapper");
    if (benchWrap && !benchWrap.hidden && selectedTab.id) {
      try {
        const u = new URL(window.location.href);
        u.searchParams.set("mode", "workbench");
        u.searchParams.set("tab", selectedTab.id.replace(/^tab-/, ""));
        u.searchParams.delete("step");
        u.searchParams.delete("sprint");
        window.history.replaceState(null, "", u.pathname + u.search + u.hash);
      } catch (_err) { /* ignore */ }
    }
    requestAnimationFrame(() => {
      drawAllCanvases();
    });
  }

  tabs.forEach((tab, idx) => {
    tab.addEventListener("click", () => activateTab(tab, false));
    tab.addEventListener("keydown", (e) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      let next = idx;
      if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
      if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = tabs.length - 1;
      activateTab(tabs[next], true);
    });
  });

  panels.forEach((panel, idx) => {
    panel.addEventListener("beforematch", () => activateTab(tabs[idx], false));
  });

  // ------------------------------------------------------------------
  // Deferred Post-Interaction Validation & Consistent ARIA Sync
  // (`validate-input-after-interaction`: `aria-invalid`, `data-error`, polite announcer)
  // ------------------------------------------------------------------
  (() => {
    const linkError = (el, shown) => {
      const errorId = el.dataset?.error;
      if (!errorId) return;
      const ids = (el.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter((id) => id && id !== errorId);
      if (shown) ids.push(errorId);
      if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
      else el.removeAttribute("aria-describedby");
    };

    const announcer = document.createElement("div");
    announcer.setAttribute("aria-live", "polite");
    announcer.classList.add("visually-hidden");
    document.body.append(announcer);
    let announceTimer = null;
    let announcedField = null;

    const spokenText = (node) => {
      const copy = node.cloneNode(true);
      copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      copy.querySelectorAll('[role="img"][aria-label]').forEach((n) =>
        n.replaceWith(`${n.getAttribute("aria-label")}: `)
      );
      return copy.textContent.replace(/\s+/g, " ").trim();
    };

    const announceError = (el) => {
      const error = document.getElementById(el.dataset.error);
      if (!error) return;
      const label = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : "";
      clearTimeout(announceTimer);
      announcer.textContent = "";
      announcedField = el;
      announceTimer = setTimeout(() => {
        announcer.textContent = label + spokenText(error);
      }, 500);
    };

    const supportsUserInvalid = CSS.supports("selector(:user-invalid)");
    const dirtyState = new WeakMap();
    const flagged = new WeakSet();
    const announced = new WeakSet();

    const syncAria = (el, announce = false) => {
      if (!el || !el.matches?.("input, select, textarea")) return;
      let invalid = false;
      if (supportsUserInvalid) {
        invalid = el.matches(":user-invalid");
      } else {
        const st = dirtyState.get(el);
        invalid = Boolean(st && st.hasInteracted && st.hasBlurred && el.validity && !el.validity.valid);
        el.classList.toggle("user-invalid-fallback", invalid);
      }
      if (invalid) {
        if (announce && !announced.has(el)) {
          announceError(el);
          announced.add(el);
        }
        el.setAttribute("aria-invalid", "true");
        linkError(el, true);
        flagged.add(el);
      } else if (flagged.has(el) || el.getAttribute("aria-invalid") !== "true") {
        el.setAttribute("aria-invalid", "false");
        linkError(el, false);
        flagged.delete(el);
        announced.delete(el);
        if (announcedField === el) {
          clearTimeout(announceTimer);
          announcer.textContent = "";
        }
      }
    };

    document.querySelectorAll("input, select, textarea").forEach((el) => syncAria(el));
    document.addEventListener(
      "blur",
      (e) => {
        if (!supportsUserInvalid && e.target?.matches?.("input, select, textarea")) {
          const st = dirtyState.get(e.target) || { hasInteracted: false, hasBlurred: false };
          st.hasBlurred = true;
          dirtyState.set(e.target, st);
        }
        syncAria(e.target, true);
      },
      true
    );
    document.addEventListener("input", (e) => {
      if (!supportsUserInvalid && e.target?.matches?.("input, select, textarea")) {
        const st = dirtyState.get(e.target) || { hasInteracted: false, hasBlurred: false };
        st.hasInteracted = true;
        dirtyState.set(e.target, st);
      }
      if (e.target?.hasAttribute?.("aria-invalid")) syncAria(e.target);
    });
    document.addEventListener("change", (e) => syncAria(e.target, true), true);
    document.addEventListener(
      "invalid",
      (e) => {
        if (!supportsUserInvalid && e.target?.matches?.("input, select, textarea")) {
          dirtyState.set(e.target, { hasInteracted: true, hasBlurred: true });
        }
        announced.add(e.target);
        syncAria(e.target);
      },
      true
    );
  })();

  // ------------------------------------------------------------------
  // Native Modal Dialogs + Safari `closedby="any"` Fallback (`dialog` guide)
  // ------------------------------------------------------------------
  function installClosedByFallback(dialogEl) {
    if (!dialogEl || "closedBy" in HTMLDialogElement.prototype) return;
    const outside = (e) => {
      const r = dialogEl.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    dialogEl.addEventListener("pointerdown", (e) => {
      pressedOutside = outside(e);
    });
    dialogEl.addEventListener("pointerup", (e) => {
      if (pressedOutside && outside(e)) dialogEl.close();
      pressedOutside = false;
    });
  }

  const ruleDialog = qs("#ruleDialog");
  const figLightboxDialog = qs("#figLightboxDialog");
  const schemaDialog = qs("#schemaDialog");
  const deleteWaferDialogRef = qs("#deleteWaferDialog");
  installClosedByFallback(ruleDialog);
  installClosedByFallback(figLightboxDialog);
  installClosedByFallback(schemaDialog);
  installClosedByFallback(deleteWaferDialogRef);

  let cachedDataModelCatalog = null;
  async function openDataModelModal(ev) {
    if (!schemaDialog) return;
    const triggerBtn = ev && ev.currentTarget ? ev.currentTarget : null;
    await withBusyButton(triggerBtn, async () => {
      try {
        if (!cachedDataModelCatalog) {
          cachedDataModelCatalog = await fetchJsonChecked(
            "/api/schema/data_model",
            {},
            "Could not load data-model schema"
          );
        }
      } catch (err) {
        showToast(err.message);
        return;
      }
      const cat = cachedDataModelCatalog;
      qs("#schemaDialogMeta").textContent =
        `${cat.schema_id} · ${cat.layer_count} Sub-Models · ${cat.total_typed_fields} Typed Phenomenon Fields · ${cat.csv_columns.length} CSV Columns`;
      qs("#schemaLayersContainer").innerHTML = (cat.layers || [])
        .map(
          (layer, idx) => `
        <div class="rec-card" style="display:flex; flex-direction:column; gap:0.35rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:0.4rem;">
            <strong style="font-size:0.84rem;">${idx + 1}. ${esc(layer.layer_name)}</strong>
            <span class="badge mono">${esc(layer.field_count)} fields</span>
          </div>
          <div style="font-size:0.76rem; color:var(--muted);">${esc(layer.summary)}</div>
          <div class="mono" style="font-size:0.76rem; max-block-size:150px; overflow-y:auto; padding-top:0.25rem; border-top:1px solid var(--border);">
            ${(layer.fields || [])
              .map(
                (f) =>
                  `<div style="padding:0.12rem 0;"><b>${esc(f.name)}</b>: <span style="color:var(--muted)">${esc(f.type)}</span>${f.required ? ' <span class="badge badge-ok" style="font-size:0.76rem;padding:0 0.3rem;">req</span>' : ""}</div>`
              )
              .join("")}
          </div>
        </div>
      `
        )
        .join("");
      schemaDialog.showModal();
    });
  }

  if (qs("#btnOpenSchemaModal")) qs("#btnOpenSchemaModal").addEventListener("click", openDataModelModal);
  if (qs("#btnInspectSchemaInline")) qs("#btnInspectSchemaInline").addEventListener("click", openDataModelModal);
  if (qs("#btnHeaderJumpOpt")) {
    qs("#btnHeaderJumpOpt").addEventListener("click", () => activateTab(qs("#tab-brain"), true));
  }
  if (qs("#btnHeaderWorldJump")) {
    qs("#btnHeaderWorldJump").addEventListener("click", () => activateTab(qs("#tab-knowledge"), true));
  }

  function openFigureLightbox(figId) {
    const figs = (brainData && brainData.figures) || [];
    const fig = figs.find((f) => f.id === figId);
    if (!fig || !figLightboxDialog) return;
    qs("#figLightboxMeta").textContent = `${fig.id.toUpperCase()} · ${fig.citation} · ${fig.license}`;
    qs("#figLightboxTitle").textContent = fig.title;
    const imgEl = qs("#figLightboxImg");
    if (fig.image_url) {
      imgEl.hidden = false;
      imgEl.src = fig.image_url;
      imgEl.alt = fig.title;
      qs("#figLightboxCaption").textContent = fig.caption;
    } else {
      imgEl.hidden = true;
      imgEl.removeAttribute("src");
      imgEl.alt = "";
      qs("#figLightboxCaption").textContent = `${fig.caption} (Publisher copyright: open original source link below to inspect full figure.)`;
    }
    qs("#figLightboxQuant").textContent = fig.quantitative_note || "";
    qs("#figLightboxLink").href = fig.source_url;
    figLightboxDialog.showModal();
  }

  qs("#btnOpenRuleModal").addEventListener("click", () => {
    ruleDialog.returnValue = "";
    ruleDialog.showModal();
  });

  ruleDialog.addEventListener("close", async () => {
    const action = ruleDialog.returnValue;
    ruleDialog.returnValue = "";
    if (action !== "save") return;
    const payload = {
      title: qs("#hrTitle").value.trim() || "Custom Engineer Rule",
      source_node: qs("#hrSource").value,
      target_node: qs("#hrTarget").value,
      polarity: parseInt(qs("#hrPolarity").value, 10),
      guidance: qs("#hrGuidance").value,
      penalty_weight: parseFloat(qs("#hrWeight").value) || 0.65,
      condition_expr: qs("#hrCond").value.trim(),
      ph110_shift: parseFloat(qs("#hrPhShift").value) || 0,
      ob_shift: parseFloat(qs("#hrObShift").value) || 0,
      crack_shift: 0,
      description: qs("#hrDesc").value.trim(),
    };
    await withBusyButton(qs("#btnOpenRuleModal"), async () => {
      try {
        const res = await fetchJsonChecked(
          `/api/ingest/human_rule?workspace=${encodeURIComponent(activeWorkspace)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
          "Rule not saved"
        );
        showToast(`Encoded Human Rule "${res.rule.title}" -> Brain upgraded to v${res.brain_snapshot.brain_version}!`);
        await refreshAll();
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  // ------------------------------------------------------------------
  // Shared High-DPI 5-Tier DAG Renderer + Cubic Bezier Hit-Testing
  // ------------------------------------------------------------------
  const SUBCIRCUIT_NODES = {
    nh3_quad: new Set(["nh3_sccm", "c2h2_sccm", "hcn_passiv", "oes_actinometry", "beta_inv", "top_etch", "stress_state", "dust_margin", "ph_depth", "ob_nm", "crack_risk"]),
    dust_guard: new Set(["pressure_torr", "ar_sccm", "c2h2_sccm", "nh3_sccm", "temp_c", "gap_mils", "power_w", "hcn_passiv", "dust_margin", "rf_harmonics", "ob_nm", "crack_risk"]),
    freq_scale: new Set(["freq_mhz", "power_w", "gap_mils", "pressure_torr", "ne_dissoc", "ion_energy", "rf_harmonics", "hcn_passiv", "beta_inv", "top_etch", "ph_depth", "ob_nm"]),
    inline_sensors: new Set(["freq_mhz", "power_w", "nh3_sccm", "c2h2_sccm", "ne_dissoc", "ion_energy", "hcn_passiv", "dust_margin", "oes_actinometry", "rf_harmonics", "beta_inv", "stress_state"]),
    ob_crack: new Set(["c2h2_sccm", "nh3_sccm", "temp_c", "ion_energy", "rf_harmonics", "top_etch", "stress_state", "dust_margin", "ob_nm", "crack_risk"]),
  };

  function distSqPointToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return (px - x1) ** 2 + (py - y1) ** 2;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return (px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2;
  }

  function hitTestCubicBezier(mx, my, p0x, p0y, c1x, c1y, c2x, c2y, p3x, p3y, threshPx = 7) {
    const minX = Math.min(p0x, c1x, c2x, p3x) - threshPx;
    const maxX = Math.max(p0x, c1x, c2x, p3x) + threshPx;
    const minY = Math.min(p0y, c1y, c2y, p3y) - threshPx;
    const maxY = Math.max(p0y, c1y, c2y, p3y) + threshPx;
    if (mx < minX || mx > maxX || my < minY || my > maxY) return false;

    let prevX = p0x, prevY = p0y;
    const threshSq = threshPx * threshPx;
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, mt = 1 - t;
      const x = mt * mt * mt * p0x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * p3x;
      const y = mt * mt * mt * p0y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * p3y;
      if (distSqPointToSegment(mx, my, prevX, prevY, x, y) <= threshSq) return true;
      prevX = x; prevY = y;
    }
    return false;
  }

  function renderCausalNetwork(canvas, opts) {
    if (!brainData || !canvas) return { boxes: [], renderedEdges: [] };
    const setup = setupHiDpiCanvas(canvas);
    if (!setup) return { boxes: [], renderedEdges: [] };
    const { ctx, w, h } = setup;

    const pal = themePalette();
    const nodes = brainData.causal_graph.nodes;
    const edges = brainData.causal_graph.edges;
    const activations = opts.activations || {};
    const boxH = opts.boxH || 29;
    const maxLayer = Math.max(0, ...nodes.map((n) => n.layer ?? 0));
    const nCols = maxLayer + 1;
    const defaultTitles = ["1. CCP Knobs", "2. Plasma & Chem", "3. OES / RF", "4. Knudsen & Bond", "5. SEM Outcomes"];
    const colW = w / nCols;
    const boxW = Math.max(88, Math.min(opts.maxBoxW || 142, colW - 14));

    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillStyle = pal.muted;
    ctx.textAlign = "center";
    for (let c = 0; c < nCols; c++) {
      ctx.fillText(defaultTitles[c] || `Tier ${c + 1}`, c * colW + colW / 2, 14);
    }

    const boxes = [];
    for (let layerIdx = 0; layerIdx <= maxLayer; layerIdx++) {
      const lnodes = nodes.filter((n) => (n.layer ?? 0) === layerIdx);
      const usableH = h - 28;
      const step = usableH / Math.max(1, lnodes.length);
      lnodes.forEach((n, idx) => {
        const x = layerIdx * colW + (colW - boxW) / 2;
        const y = 24 + idx * step + (step - boxH) / 2;
        boxes.push({ ...n, x, y, w: boxW, h: boxH });
      });
    }
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));

    const activeNodes = new Set();
    const activeEdges = new Set();
    const filterMode = opts.filterMode || "all";

    if (filterMode === "human_only") {
      edges.forEach((e, idx) => {
        if ((e.origin || "").includes("human")) {
          activeEdges.add(idx);
          activeNodes.add(e.source);
          activeNodes.add(e.target);
        }
      });
    } else if (SUBCIRCUIT_NODES[filterMode]) {
      const allowed = SUBCIRCUIT_NODES[filterMode];
      edges.forEach((e, idx) => {
        if (allowed.has(e.source) && allowed.has(e.target)) {
          activeEdges.add(idx);
          activeNodes.add(e.source);
          activeNodes.add(e.target);
        }
      });
    } else if (opts.selectedType === "edge" && opts.selectedEdgeIdx >= 0 && edges[opts.selectedEdgeIdx]) {
      const e = edges[opts.selectedEdgeIdx];
      activeEdges.add(opts.selectedEdgeIdx);
      activeNodes.add(e.source);
      activeNodes.add(e.target);
    } else if (opts.selectedNodeId && byId[opts.selectedNodeId]) {
      activeNodes.add(opts.selectedNodeId);
      const fwd = new Set([opts.selectedNodeId]);
      const bwd = new Set([opts.selectedNodeId]);
      let chg = true;
      while (chg) {
        chg = false;
        edges.forEach((e) => {
          if (fwd.has(e.source) && !fwd.has(e.target)) { fwd.add(e.target); chg = true; }
          if (bwd.has(e.target) && !bwd.has(e.source)) { bwd.add(e.source); chg = true; }
        });
      }
      edges.forEach((e, idx) => {
        if ((fwd.has(e.source) && fwd.has(e.target)) || (bwd.has(e.source) && bwd.has(e.target))) {
          activeEdges.add(idx);
          activeNodes.add(e.source);
          activeNodes.add(e.target);
        }
      });
    }

    const hasFilter = activeNodes.size > 0;
    const renderedEdges = [];

    edges.forEach((e, idx) => {
      const a = byId[e.source], b = byId[e.target];
      if (!a || !b) return;
      const sameCol = Math.abs(a.x - b.x) < 4;
      const x1 = sameCol ? a.x + a.w : a.x + a.w;
      const y1 = a.y + a.h / 2;
      const x2 = sameCol ? b.x + b.w : b.x;
      const y2 = b.y + b.h / 2;
      const c1x = sameCol ? x1 + 22 : (x1 + x2) / 2;
      const c2x = sameCol ? x2 + 22 : (x1 + x2) / 2;
      renderedEdges.push({ idx, edge: e, p0x: x1, p0y: y1, c1x, c1y: y1, c2x, c2y: y2, p3x: x2, p3y: y2 });

      const hi = activeEdges.has(idx);
      const isExactEdge = opts.selectedType === "edge" && opts.selectedEdgeIdx === idx;
      ctx.save();
      ctx.beginPath();
      if (e.polarity < 0) ctx.setLineDash([5, 3.5]);
      ctx.strokeStyle = hi ? (e.polarity > 0 ? pal.ok : pal.warn) : pal.border;
      ctx.globalAlpha = hasFilter ? (hi ? 0.94 : 0.14) : 0.55;
      ctx.lineWidth = isExactEdge ? 3.1 : (hi ? 1.3 + (e.weight || 0.6) * 1.3 : 1.0);
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(c1x, y1, c2x, y2, x2, y2);
      ctx.stroke();

      if (hi) {
        ctx.setLineDash([]);
        ctx.fillStyle = e.polarity > 0 ? pal.ok : pal.warn;
        ctx.beginPath();
        if (sameCol) {
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 + 6, y2 - 3.5);
          ctx.lineTo(x2 + 6, y2 + 3.5);
        } else {
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - 6, y2 - 3.5);
          ctx.lineTo(x2 - 6, y2 + 3.5);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    });

    boxes.forEach((b) => {
      const hi = !hasFilter || activeNodes.has(b.id);
      const isSel = opts.selectedType === "node" && opts.selectedNodeId === b.id;
      const act = activations[b.id];

      ctx.save();
      ctx.globalAlpha = hi ? 1.0 : 0.28;
      ctx.fillStyle = isSel ? pal.surfaceAlt : pal.surface;
      ctx.strokeStyle = isSel ? pal.brand : (hi && hasFilter ? pal.text : pal.border);
      ctx.lineWidth = isSel ? 2.2 : 1.05;
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 6);
      ctx.fill();
      ctx.stroke();

      if (typeof act === "number") {
        let barCol = pal.brand;
        if (b.id === "ph_depth" || b.id === "dust_margin" || b.id === "beta_inv") {
          barCol = act >= 0.62 ? pal.ok : pal.warn;
        } else if (b.id === "crack_risk" || b.id === "ob_nm") {
          barCol = act <= 0.35 ? pal.ok : pal.warn;
        }
        ctx.fillStyle = barCol;
        ctx.globalAlpha = hi ? 0.36 : 0.12;
        ctx.beginPath();
        ctx.roundRect(b.x + 2, b.y + b.h - 4.5, Math.max(5, (b.w - 4) * act), 3, 2);
        ctx.fill();
      }

      ctx.globalAlpha = hi ? 1.0 : 0.42;
      ctx.fillStyle = pal.text;
      ctx.font = isSel ? "600 11px system-ui, sans-serif" : "500 10.8px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const labelTxt = b.label.length > 20 && b.w < 118 ? b.label.slice(0, 18) + "…" : b.label;
      ctx.fillText(labelTxt, b.x + b.w / 2, b.y + b.h / 2 - (typeof act === "number" ? 1.5 : 0));
      ctx.restore();
    });

    return { boxes, renderedEdges };
  }

  // ------------------------------------------------------------------
  // Coupled 3-Panel Physics & Chemistry Mechanism Studio (Tab 0)
  // ------------------------------------------------------------------
  function drawCcpChemistryCanvas(pred) {
    const setup = setupHiDpiCanvas(qs("#ccpChemCanvas"));
    if (!setup || !pred) return;
    const { ctx, w, h } = setup;
    const pal = themePalette();
    const ps = pred.plasma;
    const r = pred.recipe;

    qs("#ccpPanelTag").textContent = `Predicted · T_e ${ps.te_ev}eV · α=${(ps.electronegativity * 100).toFixed(0)}% · η=${ps.dust_margin}x`;

    const chX = 12, chW = w * 0.58 - 18;
    const topElY = 22, botElY = h - 24;
    const gapPx = botElY - topElY;
    const sheathFrac = r.freq_mhz > 20 ? 0.08 : 0.13;
    const shPx = gapPx * sheathFrac;

    // Showerhead top electrode
    ctx.fillStyle = pal.surfaceAlt;
    ctx.strokeStyle = pal.border;
    ctx.fillRect(chX, 6, chW, 16);
    ctx.strokeRect(chX, 6, chW, 16);
    ctx.fillStyle = pal.muted;
    ctx.font = "600 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`Showerhead (${r.freq_mhz} MHz, ${r.gap_mils} mil)`, chX + chW / 2, 17);

    // Top & bottom RF sheaths
    ctx.fillStyle = pal.brand;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(chX, topElY, chW, shPx);
    ctx.fillRect(chX, botElY - shPx, chW, shPx);
    ctx.globalAlpha = 1.0;

    // Bulk quasi-neutral electronegative plasma core
    const bulkY = topElY + shPx;
    const bulkH = gapPx - 2 * shPx;
    ctx.fillStyle = ps.dust_margin < 1.5 ? pal.err : pal.ok;
    ctx.globalAlpha = 0.09;
    ctx.fillRect(chX, bulkY, chW, bulkH);
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = pal.border;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(chX, bulkY, chW, bulkH);
    ctx.setLineDash([]);

    // Convective Argon sweep arrows (thickness scales with Ar flow)
    const nSweep = 3;
    ctx.strokeStyle = pal.brand;
    ctx.lineWidth = 1.2 + (r.ar_sccm - 7000) / 3500;
    for (let i = 0; i < nSweep; i++) {
      const sy = bulkY + ((i + 1) / (nSweep + 1)) * bulkH;
      ctx.beginPath();
      ctx.moveTo(chX + 10, sy);
      ctx.lineTo(chX + chW - 12, sy);
      ctx.stroke();
      ctx.fillStyle = pal.brand;
      ctx.beginPath();
      ctx.moveTo(chX + chW - 8, sy);
      ctx.lineTo(chX + chW - 15, sy - 3.5);
      ctx.lineTo(chX + chW - 15, sy + 3.5);
      ctx.closePath();
      ctx.fill();
    }

    // Trapped C2nH- anions / dust clusters in bulk electrostatic trap
    const dustRisk = Math.max(0, Math.min(1, (1.85 - ps.dust_margin) / 1.1));
    const nClusters = Math.round(4 + 9 * dustRisk);
    const radPx = 2.6 + 5.2 * dustRisk;
    for (let k = 0; k < nClusters; k++) {
      const fx = 0.18 + 0.64 * (((k * 37) % 100) / 100);
      const fy = 0.20 + 0.60 * (((k * 61 + 19) % 100) / 100);
      const px = chX + fx * chW;
      const py = bulkY + fy * bulkH;
      ctx.beginPath();
      ctx.fillStyle = ps.dust_margin < 1.5 ? pal.err : pal.warn;
      ctx.globalAlpha = 0.82;
      ctx.arc(px, py, radPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }

    // Volatile HCN scavenging arrows (green upward/exhaust)
    ctx.fillStyle = pal.ok;
    ctx.font = "600 10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`HCN↑ scav ${ps.hcn_scavenging.toFixed(2)}`, chX + 6, bulkY + 13);
    ctx.fillStyle = ps.dust_margin < 1.5 ? pal.err : pal.muted;
    ctx.fillText(
      ps.dust_margin < 1.5 ? `C₁₂H⁻ Dust Trap! τ_nuc=${ps.tau_nuc_ms}ms` : `Clean Sweep: τ_res=${ps.tau_res_ms}ms < τ_nuc`,
      chX + 6,
      bulkY + bulkH - 6
    );

    // Bottom sheath 0-deg normal Ar+ bombardment arrows
    ctx.strokeStyle = pal.warn;
    ctx.lineWidth = 1.3;
    for (let j = 1; j <= 4; j++) {
      const ix = chX + (j / 5) * chW;
      ctx.beginPath();
      ctx.moveTo(ix, botElY - shPx + 2);
      ctx.lineTo(ix, botElY - 2);
      ctx.stroke();
    }
    ctx.fillStyle = pal.text;
    ctx.textAlign = "right";
    ctx.fillText(`E_i=${ps.ion_energy_ev}eV`, chX + chW - 4, botElY - 4);

    // Heated 550 C Pedestal
    ctx.fillStyle = pal.surfaceAlt;
    ctx.strokeStyle = pal.border;
    ctx.fillRect(chX, botElY, chW, 18);
    ctx.strokeRect(chX, botElY, chW, 18);
    ctx.fillStyle = pal.text;
    ctx.textAlign = "center";
    ctx.fillText(`Heated Chuck (${r.temp_c} °C · |V_dc|=${ps.vdc_volts}V)`, chX + chW / 2, botElY + 12);

    // Right sub-panel: Predicted Inline OES Emission Spectrum Bars
    const ox = w * 0.60, ow = w - ox - 10;
    const oyTop = 26, oyBot = h - 28, oh = oyBot - oyTop;
    ctx.strokeStyle = pal.border;
    ctx.beginPath();
    ctx.moveTo(ox, oyTop);
    ctx.lineTo(ox, oyBot);
    ctx.lineTo(ox + ow, oyBot);
    ctx.stroke();

    ctx.fillStyle = pal.muted;
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Predicted OES Lines (rel.)", ox + ow / 2, 15);

    const lines = [
      { lbl: "CN 388", val: Math.min(1.0, ps.oes_cn_ar * 1.15), col: pal.ok },
      { lbl: "CH 430", val: Math.min(1.0, 0.48 * ps.gamma_c2hx), col: pal.brand },
      { lbl: "C₂ 516", val: Math.min(1.0, ps.oes_c2_ch * 0.95), col: pal.err },
      { lbl: "Hα 656", val: Math.min(1.0, 0.36 * ps.gamma_h_nhx), col: pal.ok },
      { lbl: "Ar 750", val: 0.78, col: pal.muted },
    ];
    const bw = Math.max(10, (ow - 24) / lines.length - 6);
    lines.forEach((ln, idx) => {
      const bx = ox + 8 + idx * ((ow - 12) / lines.length);
      const bh = Math.max(4, ln.val * (oh - 12));
      ctx.fillStyle = ln.col;
      ctx.fillRect(bx, oyBot - bh, bw, bh);
      ctx.fillStyle = pal.muted;
      ctx.font = "500 9.5px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(ln.lbl.split(" ")[0], bx + bw / 2, oyBot + 11);
      ctx.fillText(ln.lbl.split(" ")[1], bx + bw / 2, oyBot + 21);
    });
  }

  function drawKnudsenDepthCanvas(pred) {
    const setup = setupHiDpiCanvas(qs("#knudsenDepthCanvas"));
    if (!setup || !pred) return;
    const { ctx, w, h } = setup;
    const pal = themePalette();
    const ps = pred.plasma;
    const p = pred.pang_posterior;
    const dp = pred.depth_profile;
    const bounces = Math.round(1 / Math.max(0.001, ps.beta_eff));
    qs("#knudsenPanelTag").textContent = `Predicted · 1/β ≈ ${bounces} bounces · Kn=${ps.knudsen_110}`;

    // Left 42%: Non-Rectangular Tapered 110nm Cross-Section + Ballistic Knudsen Ray Bounces
    const hx = w * 0.20, hw = 34, topY = 36, botY = h - 24;
    const depthPx = botY - topY;
    const obPx = Math.min(26, p.ob_nm * 0.11);
    const halfTop = (hw / 2) * 1.07;
    const halfMid = hw / 2;
    const halfBot = (hw / 2) * 0.86;

    // Dielectric block + carved non-rectangular tapered RIE hole
    ctx.fillStyle = pal.surfaceAlt;
    ctx.strokeStyle = pal.border;
    ctx.fillRect(10, topY, w * 0.40 - 10, depthPx + 6);
    ctx.strokeRect(10, topY, w * 0.40 - 10, depthPx + 6);

    const traceMoldPath = () => {
      ctx.beginPath();
      ctx.moveTo(hx - halfTop, topY);
      ctx.quadraticCurveTo(hx - halfMid, topY + depthPx * 0.16, hx - halfBot, botY - 4);
      ctx.quadraticCurveTo(hx, botY + 2, hx + halfBot, botY - 4);
      ctx.quadraticCurveTo(hx + halfMid, topY + depthPx * 0.16, hx + halfTop, topY);
      ctx.closePath();
    };
    ctx.fillStyle = "#080d18";
    traceMoldPath();
    ctx.fill();

    // Carbon fill inside tapered 110nm feature
    ctx.fillStyle = pal.brand;
    ctx.globalAlpha = 0.36;
    traceMoldPath();
    ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = pal.border;
    traceMoldPath();
    ctx.stroke();

    // Curved overburden cap with entrance crown/recess
    const crownPx = p.void_width_110_nm > 0.5 ? 3.2 : -2.2;
    ctx.fillStyle = pal.brand;
    ctx.globalAlpha = 0.76;
    ctx.beginPath();
    ctx.moveTo(10, topY);
    ctx.lineTo(10, topY - obPx);
    ctx.quadraticCurveTo(hx - halfTop * 0.8, topY - obPx, hx, topY - obPx + crownPx);
    ctx.quadraticCurveTo(hx + halfTop * 0.8, topY - obPx, w * 0.40, topY - obPx);
    ctx.lineTo(w * 0.40, topY);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Inverted-teardrop keyhole void if pinched off
    if (p.void_width_110_nm > 0.5) {
      const vyTop = topY + (p.ph_depth_110_nm / 1000) * depthPx;
      const vyBot = botY - 4;
      const vyBelly = vyTop + 0.34 * Math.max(8, vyBot - vyTop);
      const vwHalf = Math.max(3.2, ((p.void_width_110_nm / 110) * hw * 0.88) / 2);
      ctx.beginPath();
      ctx.moveTo(hx, vyTop);
      ctx.bezierCurveTo(hx + vwHalf * 0.85, vyTop + (vyBelly - vyTop) * 0.45, hx + vwHalf, vyBelly, hx + vwHalf * 0.65, vyBot - 3);
      ctx.quadraticCurveTo(hx, vyBot + 1, hx - vwHalf * 0.65, vyBot - 3);
      ctx.bezierCurveTo(hx - vwHalf, vyBelly, hx - vwHalf * 0.85, vyTop + (vyBelly - vyTop) * 0.45, hx, vyTop);
      ctx.closePath();
      ctx.fillStyle = "#090d16";
      ctx.fill();
      ctx.strokeStyle = pal.err;
      ctx.stroke();
    }

    // Green -H/-NHx passivation sites along sidewalls
    const passCount = Math.min(10, Math.max(2, Math.round(ps.gamma_h_nhx * 5)));
    ctx.fillStyle = pal.ok;
    for (let i = 0; i < passCount; i++) {
      const py = topY + 8 + (i / passCount) * (depthPx - 14);
      ctx.fillRect(hx - hw / 2 - 2, py, 3, 3);
      ctx.fillRect(hx + hw / 2 - 1, py, 3, 3);
    }

    // Ballistic Knudsen zig-zag ray trajectory (reaches bottom when beta_eff is low!)
    const maxReachFrac = Math.min(1.0, Math.max(0.24, p.ph_depth_110_nm / 1000));
    const nSegs = Math.min(11, Math.max(3, Math.round(bounces / 12)));
    ctx.strokeStyle = ps.beta_eff <= 0.014 ? pal.ok : pal.warn;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx - 6, 12);
    for (let s = 0; s <= nSegs; s++) {
      const side = s % 2 === 0 ? hx - hw / 2 + 3 : hx + hw / 2 - 3;
      const sy = topY + (s / nSegs) * depthPx * maxReachFrac;
      ctx.lineTo(side, sy);
    }
    ctx.stroke();

    ctx.fillStyle = pal.text;
    ctx.font = "600 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${pred.recipe.feature_type === "trench" ? "Trench" : "110nm Via"}`, hx, botY + 15);
    ctx.fillStyle = pal.warn;
    ctx.fillText("2π Top Trim", hx, 12);

    // Right 56%: 11-Point Depth Velocity v_net(z) in nm/min
    const pxL = w * 0.47, pxR = w - 12, pyT = 26, pyB = h - 26;
    const pw = pxR - pxL, ph = pyB - pyT;
    ctx.strokeStyle = pal.border;
    ctx.beginPath();
    ctx.moveTo(pxL, pyT);
    ctx.lineTo(pxL, pyB);
    ctx.lineTo(pxR, pyB);
    ctx.stroke();

    if (dp && dp.z_nm && dp.v_net_nm_min_110) {
      const v110 = dp.v_net_nm_min_110;
      const v225 = dp.v_net_nm_min_225 || v110;
      const allV = [...v110, ...v225, 0];
      const vMin = Math.min(-10, ...allV);
      const vMax = Math.max(40, ...allV) * 1.1;
      const xOfZ = (z) => pxL + (z / 1000) * pw;
      const yOfV = (v) => pyB - ((v - vMin) / Math.max(1, vMax - vMin)) * ph;

      // Zero net-growth line
      const yZero = yOfV(0);
      ctx.strokeStyle = pal.border;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pxL, yZero);
      ctx.lineTo(pxR, yZero);
      ctx.stroke();
      ctx.setLineDash([]);

      const plotLine = (arr, col, dashed) => {
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.0;
        if (dashed) ctx.setLineDash([5, 3]);
        ctx.beginPath();
        arr.forEach((v, i) => {
          const x = xOfZ(dp.z_nm[i]);
          const y = yOfV(v);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.restore();
      };
      plotLine(v110, pal.brand, false);
      plotLine(v225, pal.ok, true);

      ctx.fillStyle = dp.superconformal_110 ? pal.ok : pal.warn;
      ctx.font = "600 10px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(
        dp.superconformal_110 ? "Superconformal: v(1000) > v(0)" : "Sub-conformal: Mouth faster",
        pxL + 4,
        15
      );
      ctx.fillStyle = pal.muted;
      ctx.font = "500 9.5px ui-monospace, monospace";
      ctx.fillText("z=0", pxL, pyB + 13);
      ctx.textAlign = "center";
      ctx.fillText("Depth z (nm) · 110 solid / 225 dash", pxL + pw / 2, pyB + 13);
      ctx.textAlign = "right";
      ctx.fillText("1000", pxR, pyB + 13);
    }
  }

  function drawBondingCrackCanvas(pred) {
    const setup = setupHiDpiCanvas(qs("#bondingCrackCanvas"));
    if (!setup || !pred) return;
    const { ctx, w, h } = setup;
    const pal = themePalette();
    const ps = pred.plasma;
    const p = pred.pang_posterior;

    qs("#bondingPanelTag").textContent = `Predicted · ρ=${ps.film_density_g_cm3} · sp²=${Math.round(ps.sp2_fraction * 100)}% · E_F=${ps.f_etch_barrier_ev}eV`;

    const padL = 42, padR = 14, padT = 24, padB = 28;
    const pw = w - padL - padR, ph = h - padT - padB;
    const obMaxPlot = 320, sigMin = 80, sigMax = 540;
    const xOb = (ob) => padL + Math.min(1, Math.max(0, ob / obMaxPlot)) * pw;
    const ySig = (s) => padT + ph * (1 - Math.min(1, Math.max(0, (s - sigMin) / (sigMax - sigMin))));

    ctx.strokeStyle = pal.border;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + ph);
    ctx.lineTo(padL + pw, padT + ph);
    ctx.stroke();

    // Griffith critical delamination curve: sigma_crit(t_OB) = sqrt(K_c / t_OB) calibrated to ~315 MPa @ 155 nm
    const kGriffith = (315 ** 2) * 155;
    ctx.save();
    ctx.beginPath();
    for (let ob = 25; ob <= obMaxPlot; ob += 6) {
      const sCrit = Math.sqrt(kGriffith / ob);
      const x = xOb(ob), y = ySig(sCrit);
      if (ob === 25) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = pal.err;
    ctx.lineWidth = 2.0;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = pal.err;
    ctx.font = "600 9.8px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("Griffith Delamination Zone (G > G_c)", padL + pw - 4, padT + 12);
    ctx.fillStyle = pal.ok;
    ctx.textAlign = "left";
    ctx.fillText("Safe Intact Zone", padL + 6, padT + ph - 8);

    // Plot ONLY real measured coupons that actually have measured compressive_stress_mpa (`P3.4` / `B11`)
    const measuredWithStress = ((brainData && brainData.experiments) || []).filter(
      (e) => e.provenance === "measured" && e.measured && e.measured.ob_nm != null && e.measured.compressive_stress_mpa != null
    );
    if (measuredWithStress.length) {
      measuredWithStress.forEach((e) => {
        const ax = xOb(e.measured.ob_nm), ay = ySig(e.measured.compressive_stress_mpa);
        ctx.fillStyle = pal.warn;
        ctx.beginPath();
        ctx.arc(ax, ay, 3.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pal.muted;
        ctx.font = "500 9.5px ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.fillText(e.exp_id, ax + 5, ay + 3);
      });
    } else {
      ctx.fillStyle = pal.muted;
      ctx.font = "500 9.2px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("Slide-1 coupons: stress unmeasured", padL + 6, padT + 12);
    }

    // Current What-If Recipe Crosshair
    const cx = xOb(p.ob_nm), cy = ySig(ps.stress_mpa);
    const safe = p.crack_prob < 0.35;
    ctx.strokeStyle = safe ? pal.ok : pal.err;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = safe ? pal.ok : pal.err;
    ctx.beginPath();
    ctx.arc(cx, cy, 3.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "600 10px ui-monospace, monospace";
    ctx.textAlign = cx > padL + pw * 0.65 ? "right" : "left";
    ctx.fillText(`Pred (${p.ob_nm}nm, ${ps.stress_mpa}MPa)`, cx + (cx > padL + pw * 0.65 ? -9 : 9), cy - 6);

    // Axis labels
    ctx.fillStyle = pal.muted;
    ctx.font = "500 9.5px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("Planar Overburden t_OB (0 → 320 nm)", padL + pw / 2, h - 7);
    ctx.save();
    ctx.translate(12, padT + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("|σ_comp| (MPa)", 0, 0);
    ctx.restore();
  }

  function drawMechanismStudio(pred) {
    if (!pred) return;
    const ps = pred.plasma;
    const p = pred.pang_posterior;
    qs("#mechStudioBadge").textContent =
      `Predicted · Kn₁₁₀=${ps.knudsen_110} · ${p.superconformal ? "Superconformal (v_bot > v_top)" : "Sub-conformal"} · Step=${p.dual_cd_step_nm}nm · E_a(F)=${ps.f_etch_barrier_ev}eV`;
    drawCcpChemistryCanvas(pred);
    drawKnudsenDepthCanvas(pred);
    drawBondingCrackCanvas(pred);
  }

  // ------------------------------------------------------------------
  // Tab 2: Causal Knowledge Graph, DoE Presets, Inspector & Reference Deck
  // ------------------------------------------------------------------
  let kgPowerOwnerPending = false;
  let wmDepTimeS = 120;

  function readKgWhatIfRecipe() {
    const freq = parseInt(qs("#kgSlFreq").value, 10) === 1 ? 27.12 : 13.56;
    const power = parseFloat(qs("#kgSlPower").value);
    const gap = parseFloat(qs("#kgSlGap").value);
    const pres = parseFloat(qs("#kgSlPres").value);
    const ar = parseFloat(qs("#kgSlAr").value);
    const c2h2 = parseFloat(qs("#kgSlC2H2").value);
    const nh3 = parseFloat(qs("#kgSlNH3").value);
    const temp = parseFloat(qs("#kgSlTemp").value);
    const trim = parseFloat(qs("#kgSlTrim").value) || 0;
    const feature_type = qs("#kgSelGeom").value || "hole";

    qs("#kgSlFreq").setAttribute("aria-valuetext", `${freq} MHz`);
    qs("#kgLblFreq").textContent = `${freq}M`;
    qs("#kgLblPower").textContent = kgPowerOwnerPending ? "owner to supply" : `${power}W`;
    qs("#kgLblGap").textContent = `${gap}mil`;
    qs("#kgLblPres").textContent = `${pres.toFixed(1)}T`;
    qs("#kgLblAr").textContent = `${(ar / 1000).toFixed(2)}k`;
    qs("#kgLblC2H2").textContent = `${c2h2}`;
    qs("#kgLblNH3").textContent = `${nh3}`;
    qs("#kgLblTemp").textContent = `${temp}°C`;
    qs("#kgLblTrim").textContent = `${Math.round(trim * 100)}%`;

    return {
      freq_mhz: freq, power_w: power, gap_mils: gap, pressure_torr: pres,
      ar_sccm: ar, c2h2_sccm: c2h2, nh3_sccm: nh3, temp_c: temp,
      feature_type, trim_fraction: trim, dep_time_s: wmDepTimeS,
    };
  }

  function applyRecipeToKgControls(r) {
    qs("#kgSlFreq").value = r.freq_mhz > 20 ? "1" : "0";
    if (r.power_w == null) {
      kgPowerOwnerPending = true;
    } else {
      kgPowerOwnerPending = false;
      qs("#kgSlPower").value = String(r.power_w);
    }
    qs("#kgSlGap").value = String(r.gap_mils ?? 450);
    qs("#kgSlPres").value = String(r.pressure_torr ?? 18.5);
    qs("#kgSlAr").value = String(r.ar_sccm ?? 11000);
    qs("#kgSlC2H2").value = String(r.c2h2_sccm ?? 620);
    qs("#kgSlNH3").value = String(r.nh3_sccm ?? 225);
    qs("#kgSlTemp").value = String(r.temp_c ?? 555);
    qs("#kgSlTrim").value = String(r.trim_fraction ?? 0);
    if (r.dep_time_s != null) wmDepTimeS = Number(r.dep_time_s) || 120;
    qs("#kgSelGeom").value = r.feature_type || "hole";
    readKgWhatIfRecipe();
    updateKgWhatIfPrediction();
  }

  qsa("[data-doe-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-doe-preset");
      if (key === "a29") {
        applyRecipeToKgControls({
          freq_mhz: 13.56, power_w: 2000, gap_mils: 400, pressure_torr: 21.0,
          ar_sccm: 7000, c2h2_sccm: 690, nh3_sccm: 170, temp_c: 545, feature_type: "hole", trim_fraction: 0.0,
        });
        showToast("Loaded Hazard Reference (Coupon A29-2): observe C12H- dust trap & Griffith crack zone!");
        return;
      }
      const anchors = (brainData && brainData.doe_anchors) || [];
      const a = anchors[parseInt(key, 10)];
      if (a && a.recipe) {
        applyRecipeToKgControls(a.recipe);
        showToast(`Loaded ${a.name} (RF power: ${a.rf_power_status || "owner to supply"}): ${a.ranges_note}`);
      }
    });
  });

  let kgAbortCtrl = null;
  async function updateKgWhatIfPrediction() {
    const rcp = readKgWhatIfRecipe();
    if (kgAbortCtrl) kgAbortCtrl.abort();
    kgAbortCtrl = new AbortController();
    try {
      kgLastPred = await fetchJsonChecked(
        `/api/predict?workspace=${encodeURIComponent(activeWorkspace)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rcp),
          signal: kgAbortCtrl.signal,
        },
        "Prediction failed"
      );
      const ps = kgLastPred.plasma;
      const p = kgLastPred.pang_posterior;
      const ex = kgLastPred.extrapolation || {};
      qs("#kgLiveReadout").textContent =
        `Predicted · β_eff ${ps.beta_eff.toFixed(4)} · E_i ${ps.ion_energy_ev.toFixed(0)}eV · Rq ${(ps.afm_rms_nm ?? p.afm_rms_nm ?? 1.4).toFixed(2)}nm -> PH ${p.ph_depth_110_nm}nm · OB ${p.ob_nm}nm`;

      const powerBadge = kgPowerOwnerPending
        ? `<span class="badge badge-warn">Anchor RF power: owner to supply</span>`
        : "";
      qs("#kgSensorDiagnosticBar").innerHTML = `
        <span><b>Predicted OES/RF:</b> CN/Ar=${esc(ps.oes_cn_ar)} · C₂/CH=${esc(ps.oes_c2_ch)} · Hα/C₂=${esc(ps.oes_ha_c2)} · |V_dc|=${esc(ps.vdc_volts)}V · 3ω/1ω=${esc(ps.rf_3w_1w_pct)}%</span>
        <span>
          ${powerBadge}
          ${ex.outside_window ? `<span class="badge badge-warn">Extrapolating (d_meas=${esc(ex.nearest_measured_distance)})</span>` : `<span class="badge">d_meas=${esc(ex.nearest_measured_distance)}</span>`}
        </span>
      `;
      drawKnowledgeGraph();
      drawMechanismStudio(kgLastPred);
      updateInlineWorldModel(rcp);
      updateMolecularSimulation(rcp);
      debouncedWhatIfConfigPapers(rcp);
    } catch (err) {
      if (err.name !== "AbortError") console.error(err);
    }
  }

  const debouncedKgPredict = debounce(updateKgWhatIfPrediction, 55);
  ["#kgSlFreq", "#kgSlPower", "#kgSlGap", "#kgSlPres", "#kgSlAr", "#kgSlC2H2", "#kgSlNH3", "#kgSlTemp", "#kgSlTrim"].forEach((id) => {
    qs(id).addEventListener("input", () => {
      if (id === "#kgSlPower") kgPowerOwnerPending = false;
      readKgWhatIfRecipe();
      debouncedKgPredict();
    });
  });
  qs("#kgSelGeom").addEventListener("change", () => {
    readKgWhatIfRecipe();
    updateKgWhatIfPrediction();
  });

  function drawKnowledgeGraph() {
    if (!brainData) return;
    const res = renderCausalNetwork(qs("#kgMainCanvas"), {
      selectedType: kgState.selectedType,
      selectedNodeId: kgState.selectedNodeId,
      selectedEdgeIdx: kgState.selectedEdgeIdx,
      filterMode: kgState.filterMode,
      activations: kgLastPred ? kgLastPred.node_activations : {},
      boxH: 30,
      maxBoxW: 142,
    });
    kgBoxes = res.boxes;
    kgRenderedEdges = res.renderedEdges;
  }

  function resolveRefIds(rawRefs) {
    const aliases = (brainData && brainData.ref_aliases) || {};
    const out = new Set();
    (rawRefs || []).forEach((rid) => out.add(aliases[rid] || rid));
    return out;
  }

  function selectKgNode(nodeId) {
    kgState.selectedType = "node";
    kgState.selectedNodeId = nodeId;
    kgState.selectedEdgeIdx = -1;
    renderKgInspector();
    drawKnowledgeGraph();
  }

  function selectKgEdge(edgeIdx) {
    kgState.selectedType = "edge";
    kgState.selectedEdgeIdx = edgeIdx;
    renderKgInspector();
    drawKnowledgeGraph();
  }

  function renderKgInspector() {
    if (!brainData) return;
    const nodes = brainData.causal_graph.nodes;
    const edges = brainData.causal_graph.edges;
    const allFigs = brainData.figures || [];
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    let activeRefSet = new Set();
    let activeFigIds = new Set();

    if (kgState.selectedType === "edge" && edges[kgState.selectedEdgeIdx]) {
      const e = edges[kgState.selectedEdgeIdx];
      const srcN = byId[e.source] || { label: e.source };
      const tgtN = byId[e.target] || { label: e.target };
      qs("#kgInspectKind").textContent = `Directed Causal Link (${e.origin || "physics"})`;
      qs("#kgInspectTitle").textContent = `${srcN.label}  →  ${tgtN.label}`;
      qs("#kgInspectBadge").textContent = `${e.polarity > 0 ? "+ Enhances" : "− Suppresses"} · w=${e.weight}`;
      qs("#kgInspectEvidence").textContent = e.evidence || "physics";
      qs("#kgInspectEvidence").className = "badge mono " + (e.evidence === "extrapolated" ? "badge-warn" : "badge-ok");
      qs("#kgInspectEq").textContent = e.scaling_law || "Coupled non-linear plasma-surface transport";
      qs("#kgInspectSummary").textContent = e.mechanism || "Direct causal pathway in the PANG graph.";
      qs("#kgInspectFailureBox").hidden = true;

      qs("#kgUpstreamChips").innerHTML = `<button type="button" class="node-chip" data-jump-node="${esc(e.source)}">Source: ${esc(srcN.label)}</button>`;
      qs("#kgDownstreamChips").innerHTML = `<button type="button" class="node-chip" data-jump-node="${esc(e.target)}">Target: ${esc(tgtN.label)}</button>`;
      qs("#kgHumanRulesBox").textContent = e.rule_id
        ? `Governed by Rule ${e.rule_id}.`
        : "Grounded in peer-reviewed CCP electrodynamics & Knudsen reaction-diffusion theory.";
      activeRefSet = resolveRefIds(e.refs);
      (e.figure_ids || []).forEach((fid) => activeFigIds.add(fid));
    } else {
      const n = byId[kgState.selectedNodeId] || nodes[0];
      qs("#kgInspectKind").textContent = `Tier ${(n.layer ?? 0) + 1} · ${(n.group || "").toUpperCase()} NODE`;
      qs("#kgInspectTitle").textContent = n.label;
      qs("#kgInspectBadge").textContent = n.window || n.unit || "";
      qs("#kgInspectEvidence").textContent = n.evidence || "measured_in_source";
      qs("#kgInspectEvidence").className = "badge mono " + (n.evidence === "extrapolated" ? "badge-warn" : "badge-ok");
      qs("#kgInspectEq").textContent = n.equation || "";
      qs("#kgInspectSummary").textContent = n.summary || "";
      qs("#kgInspectFailureBox").hidden = false;
      qs("#kgInspectFailure").textContent = n.failure_mode || "";

      const upEdges = edges.filter((e) => e.target === n.id);
      const dnEdges = edges.filter((e) => e.source === n.id);
      qs("#kgUpstreamChips").innerHTML = upEdges.length
        ? upEdges.map((e) => `<button type="button" class="node-chip" data-jump-node="${esc(e.source)}">${e.polarity > 0 ? "+" : "−"} ${esc((byId[e.source] || {}).label || e.source)}</button>`).join("")
        : `<span style="font-size:0.77rem;color:var(--muted)">Primary External Chamber Knob</span>`;
      qs("#kgDownstreamChips").innerHTML = dnEdges.length
        ? dnEdges.map((e) => `<button type="button" class="node-chip" data-jump-node="${esc(e.target)}">${e.polarity > 0 ? "+" : "−"} ${esc((byId[e.target] || {}).label || e.target)}</button>`).join("")
        : `<span style="font-size:0.77rem;color:var(--muted)">Terminal Wafer Metrology Outcome</span>`;

      // Accessible text summary of top 3 causal edges under the canvas (`T4.5`)
      const topEdges = [...upEdges, ...dnEdges].sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 3);
      qs("#kgCanvasTextSummary").textContent = topEdges.length
        ? `Top causal paths for ${n.label}: ` + topEdges.map((e) => `${e.source} -> ${e.target} (${e.polarity > 0 ? "+" : "-"}${e.weight})`).join(" · ")
        : `Selected ${n.label}`;

      const rulesHere = (brainData.human_rules || []).filter((r) => r.source_node === n.id || r.target_node === n.id);
      qs("#kgHumanRulesBox").textContent = rulesHere.length
        ? `Active Rules on this node: ${rulesHere.map((r) => `${r.rule_id} (${r.title})`).join(" · ")}`
        : "Tip: Adopt any Literature Rule below or click '+ Inject Human Rule' in the header.";
      activeRefSet = resolveRefIds(n.refs);
      (n.figure_ids || []).forEach((fid) => activeFigIds.add(fid));
      allFigs.forEach((f) => {
        if ((f.tags || []).includes(n.id)) activeFigIds.add(f.id);
      });
    }

    qsa("[data-jump-node]").forEach((btn) => {
      btn.addEventListener("click", () => selectKgNode(btn.getAttribute("data-jump-node")));
    });

    // Render linked figure thumbnails right inside the Inspector!
    const linkedFigs = allFigs.filter((f) => activeFigIds.has(f.id)).slice(0, 4);
    qs("#kgInspectorFigs").innerHTML = linkedFigs.length
      ? linkedFigs.map((f) => `
          <button type="button" class="fig-thumb-btn" data-open-fig="${esc(f.id)}">
            ${f.image_url
              ? `<img src="${esc(f.image_url)}" alt="${esc(f.title)}" loading="lazy" />`
              : `<div style="height:82px;display:grid;place-items:center;padding:0.4rem;background:#0a0f1c;border-radius:0.35rem;color:var(--muted);font-size:0.7rem;text-align:center;">DOI Source (${esc(f.license || "copyright")})</div>`}
            <span class="mono" style="color:var(--brand);font-weight:600;">${esc(f.id.toUpperCase())}</span>
            <span style="line-height:1.25;">${esc(f.title.slice(0, 48))}${f.title.length > 48 ? "…" : ""}</span>
          </button>
        `).join("")
      : `<span style="font-size:0.76rem;color:var(--muted);">Select a node with figure tags to preview micrographs/spectra.</span>`;

    qsa("#kgInspectorFigs [data-open-fig]").forEach((btn) => {
      btn.addEventListener("click", () => openFigureLightbox(btn.getAttribute("data-open-fig")));
    });

    renderFiguresGallery(activeFigIds);
    renderLiteratureCards(activeRefSet);
  }

  function renderLiteratureLogicRules() {
    const rules = (brainData && brainData.literature_logic_rules) || [];
    const activeIds = new Set((brainData.human_rules || []).map((r) => r.rule_id));
    const box = qs("#litLogicRulesGrid");
    if (!box) return;
    box.innerHTML = rules.map((r) => {
      const adopted = activeIds.has(r.rule_id);
      return `
        <div class="lit-card ${adopted ? "is-highlighted" : ""}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;margin-bottom:0.25rem;">
            <strong class="mono">${esc(r.rule_id)} · ${esc(r.source_node)} → ${esc(r.target_node)} (${r.polarity > 0 ? "+" : "−"})</strong>
            <span class="badge ${r.guidance === "avoid" ? "badge-warn" : "badge-ok"}">${esc(r.guidance)}</span>
          </div>
          <div style="font-weight:600;margin-bottom:0.2rem;">${esc(r.title)}</div>
          <div class="mono" style="font-size:0.76rem;color:var(--brand);margin-bottom:0.25rem;">if (${esc(r.condition_expr)})</div>
          <div style="color:var(--muted);margin-bottom:0.45rem;">${esc(r.description)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;">
            <span class="badge mono">${esc(r.evidence)}</span>
            <button type="button" class="btn ${adopted ? "" : "btn-primary"}" style="padding:0.22rem 0.55rem;font-size:0.76rem;" data-adopt-lit="${esc(r.rule_id)}" ${adopted ? "disabled" : ""}>
              ${adopted ? "Active in Brain ✓" : "+ Adopt into Brain"}
            </button>
          </div>
        </div>
      `;
    }).join("");

    qsa("[data-adopt-lit]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await withBusyButton(btn, async () => {
          const rid = btn.getAttribute("data-adopt-lit");
          try {
            const data = await fetchJsonChecked(
              `/api/ingest/literature_rule?workspace=${encodeURIComponent(activeWorkspace)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rule_id: rid }),
              },
              "Could not adopt rule"
            );
            showToast(`Adopted Literature Rule ${rid} ("${data.rule.title}") -> Brain v${data.brain_snapshot.brain_version}!`);
            await refreshAll();
          } catch (err) {
            showToast(err.message);
          }
        });
      });
    });
  }

  function renderReactionAndSensitivityTables() {
    const rxns = (brainData && brainData.reaction_network) || [];
    qs("#rxnTableBody").innerHTML = rxns.map((rx) => `
      <tr>
        <th scope="row" class="mono">${esc(rx.rxn_id)}</th>
        <td><span class="badge mono">${esc(rx.phase)}</span></td>
        <td class="mono">${esc(rx.equation)}</td>
        <td class="mono">${esc(rx.rate_law)}</td>
        <td class="wrap-cell">${esc(rx.role)}</td>
      </tr>
    `).join("");

    const sens = (brainData && brainData.sensitivity_matrix) || [];
    qs("#sensTableBody").innerHTML = sens.map((s) => `
      <tr>
        <th scope="row">${esc(s.knob)}</th>
        <td class="mono">${esc(s.ne_dissoc)}</td>
        <td class="mono">${esc(s.ion_energy)}</td>
        <td class="mono">${esc(s.dust_margin)}</td>
        <td class="mono">${esc(s.ph_depth_110)}</td>
        <td class="mono">${esc(s.ob_nm)}</td>
        <td class="mono">${esc(s.stress_crack)}</td>
      </tr>
    `).join("");
  }

  async function loadSelectedTrainingTable() {
    const sel = qs("#trainingTableSelect");
    if (!sel) return;
    const tid = sel.value;
    let tbl;
    try {
      tbl = await fetchJsonChecked(`/api/knowledge_base/training/${encodeURIComponent(tid)}`, {}, "Could not load training table");
    } catch (_err) {
      return;
    }
    qs("#trainingTableDesc").textContent = `${tbl.description} (${tbl.row_count} rows · Target: ${tbl.target_brain_stage || "PANG Brain"})`;
    const cols = (tbl.columns || []).slice(0, 9);
    qs("#trainingTableHead").innerHTML = `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
    qs("#trainingTableBody").innerHTML = (tbl.rows || []).map((row) => `
      <tr>
        ${cols.map((c, idx) => idx === 0
          ? `<th scope="row" class="mono">${esc(row[c])}</th>`
          : `<td class="mono">${esc(row[c])}</td>`).join("")}
      </tr>
    `).join("");
  }

  qs("#trainingTableSelect").addEventListener("change", loadSelectedTrainingTable);

  function renderRegimes() {
    const regimes = (brainData && brainData.regimes) || [];
    qs("#kgRegimesGrid").innerHTML = regimes.map((rg) => `
      <div class="regime-card ${rg.id === "high_t_pang_target" ? "is-target" : ""}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.4rem;">
          <strong>${esc(rg.name)}</strong>
          <span class="badge ${rg.id === "high_t_pang_target" ? "badge-ok" : ""}">${esc(rg.fit)}</span>
        </div>
        <div class="mono" style="font-size:0.76rem;color:var(--brand);">${esc(rg.window)}</div>
        <div><b>Mechanism:</b> ${esc(rg.mechanism)}</div>
        <div style="color:var(--ok);"><b>Strengths:</b> ${esc(rg.pros)}</div>
        <div style="color:var(--muted);"><b>Watchouts:</b> ${esc(rg.cons)}</div>
      </div>
    `).join("");
  }

  function renderFiguresGallery(activeFigIds = new Set()) {
    const allFigs = (brainData && brainData.figures) || [];
    const filtered = kgState.figCategory === "all"
      ? allFigs
      : allFigs.filter((f) => f.category === kgState.figCategory);
    const sorted = [...filtered].sort((a, b) => (activeFigIds.has(b.id) ? 1 : 0) - (activeFigIds.has(a.id) ? 1 : 0));
    const box = qs("#kgFiguresGallery");
    if (!box) return;
    box.innerHTML = sorted.map((f) => {
      const hi = activeFigIds.has(f.id);
      const mediaHtml = f.image_url
        ? `<img src="${esc(f.image_url)}" alt="${esc(f.title)}" loading="lazy" />`
        : `<div style="height:132px;display:grid;place-items:center;padding:0.55rem;background:#0a0f1c;border-radius:0.35rem;color:var(--muted);font-size:0.76rem;text-align:center;">Publisher copyright (${esc(f.license || "restricted")}) — click for quantitative takeaway &amp; DOI ↗</div>`;
      return `
        <div class="fig-card ${hi ? "is-highlighted" : ""}">
          <button type="button" class="fig-zoom-btn" data-zoom-fig="${esc(f.id)}" aria-label="Zoom figure ${esc(f.id.toUpperCase())}: ${esc(f.title)}">
            ${mediaHtml}
          </button>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.35rem;">
            <span class="mono" style="font-size:0.76rem;color:var(--brand);font-weight:600;">${esc(f.id.toUpperCase())} · ${esc(f.category)}</span>
            ${hi ? '<span class="badge badge-ok">Node Match</span>' : ""}
          </div>
          <strong style="font-size:0.8rem;line-height:1.3;">${esc(f.title)}</strong>
          <div style="font-size:0.76rem;color:var(--muted);">${esc(f.quantitative_note || "")}</div>
        </div>
      `;
    }).join("");

    qsa("#kgFiguresGallery [data-zoom-fig]").forEach((btn) => {
      btn.addEventListener("click", () => openFigureLightbox(btn.getAttribute("data-zoom-fig")));
    });
  }

  function renderLiteratureCards(activeRefSet = new Set()) {
    const allLit = (brainData && brainData.literature) || [];
    const q = (kgState.litSearch || "").trim().toLowerCase();
    const byDomain = kgState.litDomain === "all"
      ? allLit
      : allLit.filter((item) => item.domain === kgState.litDomain);
    const filtered = !q
      ? byDomain
      : byDomain.filter((item) =>
          `${item.id} ${item.title} ${item.citation} ${item.takeaway} ${(item.tags || []).join(" ")}`.toLowerCase().includes(q)
        );
    const sorted = [...filtered].sort((a, b) => (activeRefSet.has(b.id) ? 1 : 0) - (activeRefSet.has(a.id) ? 1 : 0));
    qs("#kgLitBadge").textContent = activeRefSet.size
      ? `${activeRefSet.size} Linked (${filtered.length} / ${allLit.length} Sources)`
      : `${filtered.length} / ${allLit.length} Sources`;
    qs("#kgLitGrid").innerHTML = sorted.map((item) => {
      const hi = activeRefSet.has(item.id);
      return `
        <div class="lit-card ${hi ? "is-highlighted" : ""}">
          <div style="display:flex;justify-content:space-between;gap:0.4rem;margin-bottom:0.2rem;">
            <span class="mono" style="font-size:0.76rem;color:var(--muted);">${esc(item.citation)}</span>
            ${hi ? '<span class="badge badge-ok">Linked</span>' : `<span class="badge mono">${esc(item.domain || "")}</span>`}
          </div>
          <div style="margin-bottom:0.28rem;"><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)} ↗</a></div>
          <div style="color:var(--muted);">${esc(item.takeaway)}</div>
        </div>
      `;
    }).join("");
  }

  if (qs("#kbLitSearchInput")) {
    qs("#kbLitSearchInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        kgState.litSearch = e.currentTarget.value || "";
        renderKgInspector();
      }
    });
    qs("#kbLitSearchInput").addEventListener("input", (e) => {
      kgState.litSearch = e.target.value || "";
      renderKgInspector();
    });
  }
  if (qs("#btnJumpKbTab")) {
    qs("#btnJumpKbTab").addEventListener("click", () => {
      activateTab(qs("#tab-kb-tracker"), true);
    });
  }
  if (qs("#btnMatchWhatIfInKb")) {
    qs("#btnMatchWhatIfInKb").addEventListener("click", async () => {
      activateTab(qs("#tab-kb-tracker"), true);
      await matchActiveRecipeInKbSearch();
    });
  }

  // Filter pill listeners (Causal sub-circuits, Figure categories, Literature domains)
  qsa("[data-kg-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      kgState.filterMode = btn.getAttribute("data-kg-filter");
      qsa("[data-kg-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      drawKnowledgeGraph();
    });
  });

  qsa("[data-fig-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      kgState.figCategory = btn.getAttribute("data-fig-cat");
      qsa("[data-fig-cat]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      renderKgInspector();
    });
  });

  qsa("[data-lit-domain]").forEach((btn) => {
    btn.addEventListener("click", () => {
      kgState.litDomain = btn.getAttribute("data-lit-domain");
      qsa("[data-lit-domain]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      renderKgInspector();
    });
  });

  // Pointer interaction on #kgMainCanvas
  const kgCanvas = qs("#kgMainCanvas");
  let kgRafPending = false;
  function locateKgTarget(ev) {
    const r = kgCanvas.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const hitBox = kgBoxes.find((b) => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
    if (hitBox) return { type: "node", id: hitBox.id };
    const hitEdge = kgRenderedEdges.find((re) =>
      hitTestCubicBezier(mx, my, re.p0x, re.p0y, re.c1x, re.c1y, re.c2x, re.c2y, re.p3x, re.p3y, 7)
    );
    if (hitEdge) return { type: "edge", idx: hitEdge.idx };
    return null;
  }

  kgCanvas.addEventListener("click", (ev) => {
    const hit = locateKgTarget(ev);
    if (!hit) return;
    kgState.filterMode = "all";
    qsa("[data-kg-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute("data-kg-filter") === "all")));
    if (hit.type === "node") selectKgNode(hit.id);
    else selectKgEdge(hit.idx);
  });

  kgCanvas.addEventListener("mousemove", (ev) => {
    if (kgRafPending) return;
    kgRafPending = true;
    requestAnimationFrame(() => {
      kgRafPending = false;
      const hit = locateKgTarget(ev);
      kgCanvas.style.cursor = hit ? "pointer" : "default";
    });
  });

  // Handoff buttons from Tab 0 -> Tab 3 Sandbox or Tab 1 Optimizer
  qs("#btnSendKgToSandbox").addEventListener("click", async () => {
    qs("#slFreq").value = qs("#kgSlFreq").value;
    qs("#slPower").value = qs("#kgSlPower").value;
    qs("#slGap").value = qs("#kgSlGap").value;
    qs("#slPres").value = qs("#kgSlPres").value;
    qs("#slAr").value = qs("#kgSlAr").value;
    qs("#slC2H2").value = qs("#kgSlC2H2").value;
    qs("#slNH3").value = qs("#kgSlNH3").value;
    qs("#slTemp").value = qs("#kgSlTemp").value;
    qs("#slTrim").value = qs("#kgSlTrim").value;
    activateTab(qs("#tab-sim"), true);
    await updateSandboxPrediction();
    showToast("Transferred What-If recipe into Simulator vs. Brain Explorer (Tab 3).");
  });

  qs("#btnJumpToOptimizer").addEventListener("click", () => {
    activateTab(qs("#tab-brain"), true);
  });

  // ------------------------------------------------------------------
  // Workspace Isolation (`live`, `sandbox`, `guided`, `program:<id>` per rule `s1` / `S8.4`)
  // ------------------------------------------------------------------
  function isValidWorkspace(ws) {
    return ws === "live" || ws === "sandbox" || ws === "guided" || (typeof ws === "string" && ws.startsWith("program:") && ws.length > 8);
  }

  function describeWorkspace(ws) {
    if (ws === "sandbox") return "SANDBOX SYNTHETIC LAB (`data/sandbox/brain_state.json`)";
    if (ws === "guided") return "GUIDED TSMC WORKFLOW (`data/sandbox/tsmc_guided/guided_brain_state.json`)";
    if (typeof ws === "string" && ws.startsWith("program:")) {
      return `ISOLATED CUSTOMER PROGRAM (${ws.slice(8)})`;
    }
    return "LIVE MEASURED BRAIN (`data/brain_state.json`)";
  }

  function syncWorkspaceChrome() {
    const isIsolated = activeWorkspace !== "live";
    const sel = qs("#workspaceSelect");
    if (sel) {
      if (!Array.from(sel.options).some((o) => o.value === activeWorkspace)) {
        const opt = document.createElement("option");
        opt.value = activeWorkspace;
        opt.textContent = activeWorkspace;
        sel.appendChild(opt);
      }
      sel.value = activeWorkspace;
    }
    if (qs("#sandboxBanner")) qs("#sandboxBanner").hidden = !isIsolated;
    const bt = qs("#sandboxBannerText");
    if (bt && isIsolated) {
      bt.innerHTML = `<strong style="color:var(--warn);">${esc(describeWorkspace(activeWorkspace))}:</strong> Isolated authoritative workspace — reads and edits here never overwrite your Live Measured Brain or other independent workspaces.`;
    }
  }

  async function setWorkspace(ws, announce = true) {
    if (!isValidWorkspace(ws)) return;
    activeWorkspace = ws;
    clientSpecDirty = false;
    syncWorkspaceChrome();
    await refreshAll();
    if (qs("#semSampleSelect") && qs("#semSampleSelect").value) {
      await analyzeSelectedSample();
    }
    if (announce) {
      showToast(
        ws === "live"
          ? "Switched to Live Measured Brain (`data/brain_state.json`)."
          : `Switched to isolated workspace: ${describeWorkspace(ws)}.`
      );
    }
  }

  if (qs("#workspaceSelect")) {
    qs("#workspaceSelect").addEventListener("change", (e) => setWorkspace(e.target.value));
  }
  if (qs("#btnReturnLive")) qs("#btnReturnLive").addEventListener("click", () => setWorkspace("live"));

  // ------------------------------------------------------------------
  // Inline World Model Time-Evolution, AFM Line-Scan, 10-Knob Sweeps & 3D Molecular Studio
  // ------------------------------------------------------------------
  let wmAbortCtrl = null;
  let wmSweepAbortCtrl = null;

  async function updateInlineWorldModel(rcp) {
    if (!qs("#wmInlineCanvas")) return;
    if (wmAbortCtrl) wmAbortCtrl.abort();
    wmAbortCtrl = new AbortController();
    const goal = (qs("#wmInlineGoal") && qs("#wmInlineGoal").value) || "plug_fill";
    try {
      wmInlineData = await fetchJsonChecked(
        "/api/world/simulate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipe: rcp, goal }),
          signal: wmAbortCtrl.signal,
        },
        "World model simulation failed"
      );
      renderInlineWorldModelReadout();
      drawInlineWorldModelCanvas();
      drawAfmScanCanvas();
    } catch (err) {
      if (err.name !== "AbortError") console.error(err);
    }
    updateWorldSweeps(rcp, goal);
  }

  async function updateWorldSweeps(rcp, goalArg) {
    if (!qs("#wmSweeps")) return;
    if (wmSweepAbortCtrl) wmSweepAbortCtrl.abort();
    wmSweepAbortCtrl = new AbortController();
    const goal = goalArg || (qs("#wmInlineGoal") && qs("#wmInlineGoal").value) || "plug_fill";
    try {
      wmSweepData = await fetchJsonChecked(
        "/api/world/sweep",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipe: rcp, goal }),
          signal: wmSweepAbortCtrl.signal,
        },
        "World model sweep failed"
      );
      renderWorldSweeps();
    } catch (err) {
      if (err.name !== "AbortError") console.error(err);
    }
  }

  function renderInlineWorldModelReadout() {
    if (!wmInlineData) return;
    const post = wmInlineData.posterior || {};
    const unc = wmInlineData.uncertainty || {};
    const f110 = (wmInlineData.features && wmInlineData.features["110"]) || {};
    const pSpecPct = Math.round((wmInlineData.p_meets_spec || 0) * 100);
    const modeMap = {
      void_free: "Seamless Bottom-Up Plug",
      keyhole: "Inverted-Teardrop Keyhole",
      partial_fill: "Concave Partial Recess",
    };
    const modeBadge = qs("#wmInlineModeBadge");
    if (modeBadge) {
      modeBadge.textContent = `Predicted · ${modeMap[f110.mode] || f110.mode || "Fill"}`;
      modeBadge.className = "badge mono " + (f110.mode === "keyhole" ? "badge-warn" : "badge-ok");
    }
    const pEl = qs("#wmInlinePspec");
    if (pEl) {
      pEl.textContent = `${pSpecPct}%`;
      pEl.style.color = pSpecPct >= 70 ? "var(--ok)" : pSpecPct >= 35 ? "var(--warn)" : "var(--err)";
    }
    if (qs("#wmInlineSpecMeta")) {
      const db = wmInlineData.data_basis || {};
      const afmVal = post.afm_rms_nm != null ? Number(post.afm_rms_nm).toFixed(2) : "1.45";
      qs("#wmInlineSpecMeta").innerHTML =
        `Basis: ${esc(db.measured_wafers ?? 3)} meas + ${esc(db.synthetic_wafers ?? 9)} seed · AFM Rq: <b>${esc(afmVal)} nm</b><br/>` +
        `P(void-free 110): <b>${Math.round((wmInlineData.p_void_free_110 || 0) * 100)}%</b> · Taper: <b>${esc(post.mold_taper_deg ?? 89.25)}°</b>`;
    }
    if (qs("#wmInlineOutcomesGrid")) {
      const primaryMetric =
        wmInlineData.goal === "partial_fill"
          ? `<div class="card" style="padding:0.45rem 0.6rem;"><div class="kpi-label">Pred Fill h* (110nm)</div><div class="kpi-value" style="font-size:1rem;">${esc(post.fill_height_110_nm)} ± ${esc(unc.fill_height_110_std)} nm</div><div class="kpi-note">Meniscus sag ${esc(post.meniscus_concavity_nm ?? 0)} nm</div></div>`
          : `<div class="card" style="padding:0.45rem 0.6rem;"><div class="kpi-label">Pred PH₁₁₀ ± σ</div><div class="kpi-value" style="font-size:1rem;">${esc(post.ph_depth_110_nm)} ± ${esc(unc.ph_depth_110_std)} nm</div><div class="kpi-note">PH₂₂₅ ${esc(post.ph_depth_225_nm)} ± ${esc(unc.ph_depth_225_std)} nm</div></div>`;
      qs("#wmInlineOutcomesGrid").innerHTML = `
        ${primaryMetric}
        <div class="card" style="padding:0.45rem 0.6rem;"><div class="kpi-label">Overburden OB ± σ</div><div class="kpi-value" style="font-size:1rem;">${esc(post.ob_nm)} ± ${esc(unc.ob_std)} nm</div><div class="kpi-note">Step Δh ${esc(post.dual_cd_step_nm)} nm · Crown ${esc(post.crown_recess_nm ?? 0)} nm</div></div>
        <div class="card" style="padding:0.45rem 0.6rem;"><div class="kpi-label">Inline AFM Rq (Pred)</div><div class="kpi-value" style="font-size:1rem;">${esc(post.afm_rms_nm ?? 1.45)} nm</div><div class="kpi-note">Nodule risk ${Math.round((post.nodule_risk || 0) * 100)}%</div></div>
        <div class="card" style="padding:0.45rem 0.6rem;"><div class="kpi-label">Void CD / Crack Risk</div><div class="kpi-value" style="font-size:1rem;">${esc(post.void_width_110_nm)} nm / ${Math.round((post.crack_prob || 0) * 100)}%</div><div class="kpi-note">${post.void_width_110_nm > 0 ? "Inverted-teardrop void" : "Void-free bottom-up"}</div></div>
      `;
    }
    if (qs("#wmInlineLayersBox")) {
      qs("#wmInlineLayersBox").innerHTML = (wmInlineData.layers || [])
        .map(
          (ln) => `
          <div style="display:flex; justify-content:space-between; padding:0.22rem 0; border-bottom:1px solid var(--border);">
            <span>${esc(ln.target)}</span>
            <span>Uncal ${esc(ln.uncalibrated_sim)} → θ̂ ${esc(ln.calibrated_physics)} → Rules ${ln.human_rule_shift >= 0 ? "+" : ""}${esc(ln.human_rule_shift)} → GP ${ln.data_correction >= 0 ? "+" : ""}${esc(ln.data_correction)} = <b style="color:var(--brand)">${esc(ln.posterior)} nm</b></span>
          </div>`
        )
        .join("");
    }
    if (qs("#wmInlineNearestBox")) {
      const nearest = wmInlineData.nearest_measured || [];
      qs("#wmInlineNearestBox").innerHTML = nearest.length
        ? nearest
            .map((n) => {
              const m = n.measured || {};
              const depthStr = m.ph_depth_110_nm != null ? `PH ${esc(m.ph_depth_110_nm)} nm` : `h* ${esc(m.fill_height_110_nm ?? "—")} nm`;
              return `
                <div class="nearest-wafer-chip mono">
                  <div style="display:flex;justify-content:space-between;gap:0.25rem;">
                    <b>${esc(n.exp_id)}</b>
                    <span style="color:var(--brand);">d=${esc(n.distance)}</span>
                  </div>
                  <div style="color:var(--muted);">${depthStr} · OB ${esc(m.ob_nm ?? "—")} nm</div>
                  <div style="color:var(--muted);">Void ${esc(m.void_width_110_nm ?? 0)} nm · ${m.crack_detected ? "Crack" : "Intact"}</div>
                </div>
              `;
            })
            .join("")
        : `<span style="font-size:0.76rem;color:var(--muted);">No physical measured coupons found.</span>`;
    }
  }

  function drawInlineWorldModelCanvas() {
    const setup = setupHiDpiCanvas(qs("#wmInlineCanvas"));
    if (!setup || !wmInlineData || !wmInlineData.features) return;
    const { ctx, w, h } = setup;
    const pal = themePalette();
    const f110 = wmInlineData.features["110"];
    const f225 = wmInlineData.features["225"];
    if (!f110 || !f225 || !f110.frames.length) return;

    const nFrames = f110.frames.length;
    const fIdx = Math.max(0, Math.min(nFrames - 1, wmInlineFrameIdx));
    const topY = 58;
    const botY = h - 32;
    const depthPx = botY - topY;
    const post = wmInlineData.posterior || {};
    const unc = wmInlineData.uncertainty || {};

    // Background dielectric mold block
    ctx.fillStyle = pal.surfaceAlt;
    ctx.strokeStyle = pal.border;
    ctx.fillRect(16, topY, w - 32, depthPx + 8);
    ctx.strokeRect(16, topY, w - 32, depthPx + 8);

    const drawFeatureEvolution = (feat, cx, trenchPxW, title, phMean, phStd, showNodule) => {
      const fr = feat.frames[fIdx];
      const nz = feat.z_nm.length;
      const cellH = depthPx / nz;
      const halfCd = feat.half_cd_nm || feat.cd_nm / 2;
      const moldHalfArr = feat.mold_half_nm && feat.mold_half_nm.length === nz ? feat.mold_half_nm : null;
      const xHalfMold = (i) => (trenchPxW / 2) * ((moldHalfArr ? moldHalfArr[i] : halfCd) / halfCd);
      const yCellCenter = (i) => topY + (i + 0.5) * cellH;

      const traceMoldCavity = () => {
        ctx.beginPath();
        ctx.moveTo(cx - xHalfMold(0), topY);
        for (let i = 0; i < nz; i++) {
          ctx.lineTo(cx - xHalfMold(i), yCellCenter(i));
        }
        ctx.quadraticCurveTo(cx, botY + 1.8, cx + xHalfMold(nz - 1), yCellCenter(nz - 1));
        for (let i = nz - 1; i >= 0; i--) {
          ctx.lineTo(cx + xHalfMold(i), yCellCenter(i));
        }
        ctx.closePath();
      };

      // 1. Etched non-rectangular RIE mold cavity (entrance flare + ~89.25° taper + rounded floor)
      ctx.fillStyle = "#080d18";
      traceMoldCavity();
      ctx.fill();

      // 2. Curved overburden cap + AFM Rq micro-roughness wave above shoulders/mouth
      const obPx = Math.min(42, ((fr.ob_nm || 0) / 1000) * depthPx * 1.45);
      const afmAmpPx = Math.min(3.2, Math.max(0.4, (fr.afm_rms_nm || post.afm_rms_nm || 1.3) * 0.55));
      const mouthOpenFrac = Math.max(0, 1 - (2 * (fr.walls_nm[0] || 0)) / Math.max(1e-6, feat.cd_nm));
      const shoulderSpan = trenchPxW / 2 + 40;
      if (obPx > 0.5) {
        ctx.save();
        ctx.fillStyle = pal.brand;
        ctx.globalAlpha = 0.84;
        if (mouthOpenFrac > 0.06) {
          // Unbridged bread-loafing shoulders curving into flared lip
          const lipHalf = xHalfMold(0) * Math.max(0.08, mouthOpenFrac * 0.85);
          [-1, 1].forEach((dir) => {
            ctx.beginPath();
            const xOuter = cx + dir * shoulderSpan;
            const xLip = cx + dir * lipHalf;
            ctx.moveTo(xOuter, topY);
            const steps = 14;
            for (let s = 0; s <= steps; s++) {
              const u = s / steps;
              const xx = xOuter + (xLip - xOuter) * u;
              const lipDip = obPx * 0.55 * (u ** 3);
              const rough = afmAmpPx * Math.sin(u * 13.0 + dir * 1.4);
              ctx.lineTo(xx, topY - obPx + lipDip + rough);
            }
            ctx.lineTo(cx + dir * xHalfMold(0), topY);
            ctx.closePath();
            ctx.fill();
          });
        } else {
          // Bridged overburden cap with central crown (>0 dome) or dimple (<0 seam recess)
          const crownNm = fr.crown_nm || 0;
          const crownShiftPx = -Math.max(-10, Math.min(10, (crownNm / 25) * 6.5));
          ctx.beginPath();
          ctx.moveTo(cx - shoulderSpan, topY);
          const steps = 28;
          for (let s = 0; s <= steps; s++) {
            const u = (s / steps) * 2 - 1; // -1 .. +1
            const xx = cx + u * shoulderSpan;
            const bell = Math.exp(-((u / 0.42) ** 2));
            const rough = afmAmpPx * (0.65 * Math.sin(s * 1.9) + 0.35 * Math.cos(s * 3.3));
            ctx.lineTo(xx, topY - obPx + crownShiftPx * bell + rough);
          }
          ctx.lineTo(cx + shoulderSpan, topY);
          ctx.closePath();
          ctx.fill();
        }
        // Charged C2nH- dust-fallout hemispherical nodule dome on shoulder when risk is elevated
        if (showNodule && (post.nodule_risk || 0) > 0.25 && fr.t > 0.55) {
          const nodR = Math.min(9.5, 3.5 + 7.5 * (post.nodule_risk || 0) * fr.t);
          const nodX = cx - shoulderSpan + 16;
          const nodY = topY - obPx;
          ctx.fillStyle = pal.warn;
          ctx.globalAlpha = 0.88;
          ctx.beginPath();
          ctx.arc(nodX, nodY + 1, nodR, Math.PI, 0);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      // 3. Smooth non-rectangular carbon deposit inside clipped RIE mold
      ctx.save();
      traceMoldCavity();
      ctx.clip();

      ctx.fillStyle = pal.brand;
      ctx.globalAlpha = 0.86;
      traceMoldCavity();
      ctx.fill();
      ctx.globalAlpha = 1.0;

      const innerHalfPx = (i) => {
        const wFrac = Math.min(1, Math.max(0, (fr.walls_nm[i] || 0) / halfCd));
        return xHalfMold(i) * (1 - wFrac);
      };
      const botFillPx = Math.min(depthPx, ((fr.bottom_nm || 0) / feat.depth_nm) * depthPx);
      const yBotOpen = botY - botFillPx;
      const sagPx = Math.min(16, ((fr.meniscus_sag_nm || 0) / feat.depth_nm) * depthPx * 2.1);

      if (mouthOpenFrac > 0.025) {
        // Open lumen with curved sidewall front + concave U-shaped bottom wetting meniscus
        let lastOpen = 0;
        for (let i = 0; i < nz; i++) {
          if (yCellCenter(i) < yBotOpen && innerHalfPx(i) > 0.35) lastOpen = i;
        }
        ctx.fillStyle = "#080d18";
        ctx.beginPath();
        ctx.moveTo(cx - innerHalfPx(0), topY - 2);
        for (let i = 0; i <= lastOpen; i++) {
          ctx.lineTo(cx - innerHalfPx(i), Math.min(yBotOpen, yCellCenter(i)));
        }
        ctx.quadraticCurveTo(
          cx,
          Math.min(botY - 1, yBotOpen + sagPx),
          cx + innerHalfPx(lastOpen),
          Math.min(yBotOpen, yCellCenter(lastOpen))
        );
        for (let i = lastOpen; i >= 0; i--) {
          ctx.lineTo(cx + innerHalfPx(i), Math.min(yBotOpen, yCellCenter(i)));
        }
        ctx.lineTo(cx + innerHalfPx(0), topY - 2);
        ctx.closePath();
        ctx.fill();
      } else {
        // Throat pinched off: carve curved inverted-teardrop / spindle keyhole void if any open interior remains
        const openCells = [];
        for (let i = 1; i < nz; i++) {
          if (yCellCenter(i) < yBotOpen && innerHalfPx(i) > 0.45) openCells.push(i);
        }
        if (openCells.length >= 2) {
          const iTop = openCells[0];
          const iBot = openCells[openCells.length - 1];
          const yPinch = Math.max(topY + 2, yCellCenter(iTop) - 0.65 * cellH);
          const yVoidFloor = Math.min(botY - 2, yCellCenter(iBot) + 0.55 * cellH);
          ctx.beginPath();
          // Pointed Gothic-arch pinch apex -> curved left wall -> rounded teardrop bottom -> curved right wall
          ctx.moveTo(cx, yPinch);
          openCells.forEach((idx) => {
            ctx.lineTo(cx - innerHalfPx(idx), yCellCenter(idx));
          });
          ctx.quadraticCurveTo(cx, yVoidFloor + 1.8, cx + innerHalfPx(iBot), yCellCenter(iBot));
          for (let k = openCells.length - 1; k >= 0; k--) {
            const idx = openCells[k];
            ctx.lineTo(cx + innerHalfPx(idx), yCellCenter(idx));
          }
          ctx.closePath();
          ctx.fillStyle = "#080d18";
          ctx.fill();
          ctx.strokeStyle = pal.err;
          ctx.lineWidth = 1.45;
          ctx.setLineDash([3, 2]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.restore();

      // Mold cavity crisp contour
      ctx.strokeStyle = pal.border;
      ctx.lineWidth = 1.15;
      traceMoldCavity();
      ctx.stroke();

      // Epistemic ±1σ bracket for PH depth
      const xRMax = cx + xHalfMold(0);
      if (wmInlineData.goal === "plug_fill" && Number.isFinite(phMean)) {
        const yMu = topY + (phMean / feat.depth_nm) * depthPx;
        const yLo = topY + (Math.max(0, phMean - phStd) / feat.depth_nm) * depthPx;
        const yHi = topY + (Math.min(feat.depth_nm, phMean + phStd) / feat.depth_nm) * depthPx;
        ctx.fillStyle = pal.ok;
        ctx.globalAlpha = 0.20;
        ctx.fillRect(xRMax + 6, yLo, 7, Math.max(2, yHi - yLo));
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = pal.ok;
        ctx.beginPath();
        ctx.moveTo(xRMax + 4, yMu);
        ctx.lineTo(xRMax + 15, yMu);
        ctx.stroke();
      }

      ctx.fillStyle = pal.text;
      ctx.font = "600 11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(title, cx, 19);
      ctx.fillStyle = pal.muted;
      ctx.font = "500 10.2px ui-monospace, monospace";
      const subTxt =
        feat.mode === "partial_fill"
          ? `h(t)=${fr.bottom_nm.toFixed(0)}nm · Sag=${(fr.meniscus_sag_nm || 0).toFixed(0)}nm · OB=${fr.ob_nm.toFixed(0)}nm`
          : feat.final_void && fIdx >= nFrames - 2
          ? `Teardrop @ PH=${feat.final_void.top_nm}nm (Max ${feat.final_void.max_width_nm}nm @ z=${feat.final_void.belly_z_nm || "—"}nm)`
          : `t=${Math.round(fr.t * 100)}% · OB=${fr.ob_nm.toFixed(0)}nm · Rq=${(fr.afm_rms_nm || 1.3).toFixed(2)}nm`;
      ctx.fillText(subTxt, cx, botY + 20);
    };

    drawFeatureEvolution(
      f110,
      w * 0.28,
      Math.min(68, Math.max(44, w * 0.11)),
      "110 nm Tapered Via (AR 9.1 · ~89.25°)",
      post.ph_depth_110_nm,
      unc.ph_depth_110_std || 20,
      true
    );
    drawFeatureEvolution(
      f225,
      w * 0.73,
      Math.min(112, Math.max(72, w * 0.18)),
      "225 nm Wide Feature (AR 4.4 · ~89.25°)",
      post.ph_depth_225_nm,
      unc.ph_depth_225_std || 20,
      false
    );
  }

  function drawAfmScanCanvas() {
    const setup = setupHiDpiCanvas(qs("#afmScanCanvas"));
    if (!setup || !wmInlineData) return;
    const { ctx, w, h } = setup;
    const pal = themePalette();
    const post = wmInlineData.posterior || {};
    const rq = Number(post.afm_rms_nm ?? 1.45);
    const stepNm = Number(post.dual_cd_step_nm ?? 6.0);
    const crownNm = Number(post.crown_recess_nm ?? 2.0);
    const nodRisk = Number(post.nodule_risk ?? 0.05);

    const padL = 34, padR = 10, padT = 18, padB = 18;
    const pw = w - padL - padR;
    const ph = h - padT - padB;
    const maxAmpNm = Math.max(8, Math.abs(stepNm) * 0.85 + Math.abs(crownNm) + 3.2 * rq);

    ctx.fillStyle = "#080d18";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = pal.border;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    const yZero = padT + ph * 0.52;
    ctx.strokeStyle = pal.border;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, yZero);
    ctx.lineTo(padL + pw, yZero);
    ctx.stroke();
    ctx.setLineDash([]);

    const nPts = 140;
    ctx.beginPath();
    for (let i = 0; i <= nPts; i++) {
      const u = i / nPts;
      const x = padL + u * pw;
      // Smooth step transition from 110 nm array (left) to 225 nm array (right)
      const stepProfile = (stepNm * 0.5) * Math.tanh((0.52 - u) / 0.06);
      // Entrance crown (>0) or keyhole/partial dimple (<0) over 110nm (u=0.25) and 225nm (u=0.76) centers
      const crown110 = crownNm * Math.exp(-(((u - 0.25) / 0.045) ** 2));
      const crown225 = (crownNm * 0.65) * Math.exp(-(((u - 0.76) / 0.07) ** 2));
      // Multi-harmonic AFM grain topography normalized to RMS = rq
      const grain = rq * (0.92 * Math.sin(u * 67.0) + 0.68 * Math.cos(u * 131.0 + 0.7) + 0.52 * Math.sin(u * 211.0 + 1.9));
      const noduleSpike = nodRisk > 0.25 ? (8.0 * nodRisk) * Math.exp(-(((u - 0.12) / 0.018) ** 2)) : 0;
      const zNm = stepProfile + crown110 + crown225 + grain + noduleSpike;
      const y = yZero - (zNm / maxAmpNm) * (ph * 0.46);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rq <= 1.8 ? pal.ok : pal.warn;
    ctx.lineWidth = 1.65;
    ctx.stroke();

    ctx.font = "600 9.6px ui-monospace, monospace";
    ctx.fillStyle = pal.text;
    ctx.textAlign = "left";
    ctx.fillText(`Rq=${rq.toFixed(2)} nm · Δh_step=${stepNm.toFixed(1)} nm · Crown=${crownNm >= 0 ? "+" : ""}${crownNm.toFixed(1)} nm`, padL, 12);
    ctx.fillStyle = pal.muted;
    ctx.font = "500 9px ui-monospace, monospace";
    ctx.fillText(`+${maxAmpNm.toFixed(0)}`, 4, padT + 6);
    ctx.fillText(`0nm`, 6, yZero + 3);
    ctx.fillText(`-${maxAmpNm.toFixed(0)}`, 4, padT + ph);
    ctx.textAlign = "center";
    ctx.fillText("110 nm Via Array", padL + pw * 0.25, h - 4);
    ctx.fillText("225 nm Wide Array", padL + pw * 0.76, h - 4);
  }

  const SWEEP_TARGET_META = {
    p_spec: { label: "P(spec)", unit: "%", scale: 100, digits: 0, stdKey: null, specLine: () => 80 },
    ph110: { label: "PH₁₁₀", unit: "nm", scale: 1, digits: 0, stdKey: "ph110_std", specLine: (sp) => sp.ph_min_nm },
    ph225: { label: "PH₂₂₅", unit: "nm", scale: 1, digits: 0, stdKey: "ph225_std", specLine: (sp) => sp.ph_min_nm },
    ob: { label: "OB", unit: "nm", scale: 1, digits: 0, stdKey: "ob_std", specLine: (sp) => sp.ob_max_nm },
    afm_rms: { label: "AFM Rq", unit: "nm", scale: 1, digits: 2, stdKey: null, specLine: () => 2.0 },
    crack: { label: "Crack Risk", unit: "%", scale: 100, digits: 0, stdKey: null, specLine: () => 35 },
    fill_h: { label: "Fill h*", unit: "nm", scale: 1, digits: 0, stdKey: "fill_h_std", specLine: (sp) => sp.fill_height_target_nm },
  };

  function applySingleKnobFromSweep(key, val) {
    const cur = readKgWhatIfRecipe();
    cur[key] = val;
    if (key === "dep_time_s") {
      wmDepTimeS = val;
      updateInlineWorldModel(readKgWhatIfRecipe());
      showToast(`Set world-model Deposition Time = ${Math.round(val)} s.`);
      return;
    }
    applyRecipeToKgControls(cur);
  }

  function renderWorldSweeps() {
    const grid = qs("#wmSweeps");
    const tbody = qs("#wmSweepsTableBody");
    const tableWrap = qs("#wmSweepsTableWrap");
    if (!grid || !wmSweepData || !wmSweepData.knobs) return;

    const targetKey = (qs("#wmSweepTarget") && qs("#wmSweepTarget").value) || "p_spec";
    const meta = SWEEP_TARGET_META[targetKey] || SWEEP_TARGET_META.p_spec;
    const sp = wmSweepData.client_spec || (brainData && brainData.client_spec) || {};
    const specRaw = meta.specLine ? meta.specLine(sp) : null;

    grid.hidden = wmSweepAsTable;
    if (tableWrap) tableWrap.hidden = !wmSweepAsTable;

    grid.innerHTML = "";
    if (tbody) tbody.innerHTML = "";

    wmSweepData.knobs.forEach((knob) => {
      const xs = knob.series.x || [];
      const rawYs = knob.series[targetKey] || knob.series.p_spec || [];
      const ys = rawYs.map((v) => Number(v) * meta.scale);
      const stds = meta.stdKey && knob.series[meta.stdKey]
        ? knob.series[meta.stdKey].map((s) => Number(s) * meta.scale)
        : null;
      if (!xs.length || !ys.length) return;

      // Interpolate value at current knob position
      let curIdx = 0;
      xs.forEach((x, idx) => {
        if (Math.abs(x - knob.current) < Math.abs(xs[curIdx] - knob.current)) curIdx = idx;
      });
      const curY = ys[curIdx];

      const loBound = Math.min(...ys, ...(stds ? ys.map((y, i) => y - stds[i]) : []), ...(specRaw != null ? [specRaw] : []));
      const hiBound = Math.max(...ys, ...(stds ? ys.map((y, i) => y + stds[i]) : []), ...(specRaw != null ? [specRaw] : []));
      const span = Math.max(1e-3, hiBound - loBound);
      const yMin = loBound - 0.08 * span;
      const yMax = hiBound + 0.08 * span;

      const W = 220, H = 78, pL = 6, pR = 6, pT = 7, pB = 16;
      const xSvg = (x) => pL + ((x - xs[0]) / Math.max(1e-9, xs[xs.length - 1] - xs[0])) * (W - pL - pR);
      const ySvg = (y) => pT + (1 - (y - yMin) / Math.max(1e-9, yMax - yMin)) * (H - pT - pB);

      const linePts = xs.map((x, i) => `${xSvg(x).toFixed(1)},${ySvg(ys[i]).toFixed(1)}`).join(" ");
      let bandPoly = "";
      if (stds) {
        const up = xs.map((x, i) => `${xSvg(x).toFixed(1)},${ySvg(ys[i] + stds[i]).toFixed(1)}`);
        const dn = [...xs].reverse().map((x, rIdx) => {
          const i = xs.length - 1 - rIdx;
          return `${xSvg(x).toFixed(1)},${ySvg(ys[i] - stds[i]).toFixed(1)}`;
        });
        bandPoly = `<polygon points="${[...up, ...dn].join(" ")}" fill="var(--brand)" fill-opacity="0.16" />`;
      }
      const specLineSvg =
        specRaw != null && specRaw >= yMin && specRaw <= yMax
          ? `<line x1="${pL}" y1="${ySvg(specRaw).toFixed(1)}" x2="${W - pR}" y2="${ySvg(specRaw).toFixed(1)}" stroke="var(--ok)" stroke-width="1" stroke-dasharray="3,2" />`
          : "";
      const cxCur = xSvg(knob.current).toFixed(1);
      const cyCur = ySvg(curY).toFixed(1);
      const fmtVal = (v) => `${Number(v).toFixed(meta.digits)}${meta.unit ? " " + meta.unit : ""}`;
      const fmtX = (x) => (knob.key === "ar_sccm" ? `${(x / 1000).toFixed(1)}k` : knob.key === "trim_fraction" ? `${Math.round(x * 100)}%` : `${Number(x.toFixed ? x.toFixed(2) : x)}`);

      const card = document.createElement("div");
      card.className = "wm-sweep-card";
      card.innerHTML = `
        <h3>
          <span>${esc(knob.label)}</span>
          <span class="mono">${esc(fmtX(knob.current))}${knob.unit && knob.key !== "ar_sccm" ? " " + esc(knob.unit) : ""} → <b style="color:var(--brand)">${esc(fmtVal(curY))}</b></span>
        </h3>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sensitivity of ${esc(meta.label)} to ${esc(knob.label)}">
          ${bandPoly}
          ${specLineSvg}
          <line x1="${cxCur}" y1="${pT}" x2="${cxCur}" y2="${H - pB}" stroke="var(--muted)" stroke-opacity="0.45" stroke-dasharray="2,2" />
          <polyline fill="none" stroke="var(--brand)" stroke-width="2" points="${linePts}" />
          <circle cx="${cxCur}" cy="${cyCur}" r="3.4" fill="var(--ok)" stroke="#080d18" stroke-width="1" />
          <text x="${pL}" y="${H - 2}" fill="var(--muted)" font-size="11" font-family="var(--font-mono)">${esc(fmtX(xs[0]))}</text>
          <text x="${W - pR}" y="${H - 2}" fill="var(--muted)" font-size="11" text-anchor="end" font-family="var(--font-mono)">${esc(fmtX(xs[xs.length - 1]))}</text>
        </svg>
      `;
      const svgEl = card.querySelector("svg");
      svgEl.addEventListener("click", (ev) => {
        const rect = svgEl.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (ev.clientX - rect.left) / Math.max(1, rect.width)));
        const targetX = xs[0] + frac * (xs[xs.length - 1] - xs[0]);
        let bestX = xs[0];
        xs.forEach((x) => {
          if (Math.abs(x - targetX) < Math.abs(bestX - targetX)) bestX = x;
        });
        applySingleKnobFromSweep(knob.key, bestX);
      });
      grid.appendChild(card);

      if (tbody) {
        const pSpecs = knob.series.p_spec || [];
        let bestPIdx = 0;
        pSpecs.forEach((p, i) => {
          if (p > pSpecs[bestPIdx]) bestPIdx = i;
        });
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <th scope="row">${esc(knob.label)}</th>
          <td class="mono">${esc(fmtX(knob.current))} ${esc(knob.unit || "")} → <b>${esc(fmtVal(curY))}</b></td>
          <td class="mono">${esc(fmtX(xs[0]))} → ${esc(fmtVal(ys[0]))}</td>
          <td class="mono">${esc(fmtX(xs[xs.length - 1]))} → ${esc(fmtVal(ys[ys.length - 1]))}</td>
          <td class="mono"><b style="color:var(--ok)">${Math.round((pSpecs[bestPIdx] || 0) * 100)}%</b> @ ${esc(fmtX(xs[bestPIdx]))} ${esc(knob.unit || "")}</td>
        `;
        tbody.appendChild(tr);
      }
    });
  }

  if (qs("#wmSweepTarget")) {
    qs("#wmSweepTarget").addEventListener("change", renderWorldSweeps);
  }
  if (qs("#wmSweepTableToggle")) {
    qs("#wmSweepTableToggle").addEventListener("click", (ev) => {
      wmSweepAsTable = !wmSweepAsTable;
      ev.currentTarget.setAttribute("aria-pressed", String(wmSweepAsTable));
      ev.currentTarget.textContent = wmSweepAsTable ? "Show Sparklines" : "Show as Table";
      renderWorldSweeps();
    });
  }

  let wmAnimTimer = null;
  function stopWmPlayback() {
    wmInlinePlaying = false;
    clearInterval(wmAnimTimer);
    if (qs("#wmInlinePlayBtn")) qs("#wmInlinePlayBtn").textContent = "▶ Play Fill";
  }

  if (qs("#wmInlinePlayBtn")) {
    qs("#wmInlinePlayBtn").addEventListener("click", () => {
      if (!wmInlineData || !wmInlineData.features) return;
      if (wmInlinePlaying) {
        stopWmPlayback();
        return;
      }
      const nFrames = wmInlineData.features["110"].frames.length;
      if (wmInlineFrameIdx >= nFrames - 1) wmInlineFrameIdx = 0;
      wmInlinePlaying = true;
      qs("#wmInlinePlayBtn").textContent = "⏸ Pause";
      wmAnimTimer = setInterval(() => {
        wmInlineFrameIdx += 1;
        const pct = Math.round((wmInlineFrameIdx / Math.max(1, nFrames - 1)) * 100);
        if (qs("#wmInlineTime")) {
          qs("#wmInlineTime").value = String(pct);
          qs("#wmInlineTime").setAttribute("aria-valuetext", `${pct}% of deposition`);
        }
        if (qs("#wmInlineTimeLbl")) qs("#wmInlineTimeLbl").textContent = `t = ${pct}%`;
        drawInlineWorldModelCanvas();
        if (wmInlineFrameIdx >= nFrames - 1) stopWmPlayback();
      }, 45);
    });
  }

  if (qs("#wmInlineTime")) {
    qs("#wmInlineTime").addEventListener("input", (e) => {
      stopWmPlayback();
      const pct = parseInt(e.target.value, 10) || 0;
      const nFrames = (wmInlineData && wmInlineData.features && wmInlineData.features["110"].frames.length) || 48;
      wmInlineFrameIdx = Math.round((pct / 100) * (nFrames - 1));
      e.target.setAttribute("aria-valuetext", `${pct}% of deposition`);
      if (qs("#wmInlineTimeLbl")) qs("#wmInlineTimeLbl").textContent = `t = ${pct}%`;
      drawInlineWorldModelCanvas();
    });
  }

  if (qs("#wmInlineGoal")) {
    qs("#wmInlineGoal").addEventListener("change", () => {
      updateInlineWorldModel(readKgWhatIfRecipe());
    });
  }

  if (qs("#btnSnapWorldOptimal")) {
    qs("#btnSnapWorldOptimal").addEventListener("click", async (ev) => {
      await withBusyButton(ev.currentTarget, async () => {
        try {
          const goal = (qs("#wmInlineGoal") && qs("#wmInlineGoal").value) || "plug_fill";
          const data = await fetchJsonChecked(
            "/api/world/optimize",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ goal, batch_size: 1, freq_filter: "both", allow_two_step: true }),
            },
            "Could not compute optimal world-model recipe"
          );
          const top = (data.suggestions || [])[0];
          if (top && top.recipe) {
            applyRecipeToKgControls(top.recipe);
            showToast(
              `Snapped World Model to Rank #1 Optimal Recipe (${top.recipe.freq_mhz} MHz, N/C=${top.recipe.nc_ratio.toFixed(2)}, P(spec)=${Math.round((top.p_meets_spec || 0) * 100)}%)!`
            );
          }
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  // 3D Molecular Ball-and-Stick Renderer & Deck Exporter
  let molAbortCtrl = null;
  async function updateMolecularSimulation(rcp) {
    if (!qs("#mol3dCanvas")) return;
    if (molAbortCtrl) molAbortCtrl.abort();
    molAbortCtrl = new AbortController();
    try {
      molSimData = await fetchJsonChecked(
        "/api/molecular/simulate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipe: rcp, n_conformers: 4, seed: 42, workspace: activeWorkspace }),
          signal: molAbortCtrl.signal,
        },
        "Molecular simulation failed"
      );
      const c3d = molSimData.cluster_3d || {};
      const arch = molSimData.archetype || {};
      const cp = molSimData.coupled_priors || {};
      if (qs("#molArchetypeBadge")) qs("#molArchetypeBadge").textContent = `${c3d.n_atoms}-Atom · ${c3d.force_field}`;
      if (qs("#molClusterTitle")) qs("#molClusterTitle").textContent = arch.label || "3D a-C:H:N Network";
      if (qs("#molFormulaBadge")) qs("#molFormulaBadge").textContent = `${c3d.formula} (${c3d.molecular_weight_da} Da)`;
      if (qs("#molClusterDesc")) {
        qs("#molClusterDesc").textContent = `${arch.regime_condition} — ${arch.description}`;
      }
      if (qs("#molMetricsStrip")) {
        qs("#molMetricsStrip").innerHTML = `
          <span><b>3D Relaxed:</b> E_min=${esc(c3d.minimized_energy_kcal_mol)} kcal/mol (ΔE=${esc(c3d.relaxation_delta_kcal_mol)}) · V_vdW=${esc(c3d.vdw_volume_a3)} Å³ · R_g=${esc(c3d.radius_of_gyration_a)} Å</span>
          <span><b>Coupled Priors:</b> sp²=${Math.round((cp.md_sp2_fraction || 0) * 100)}% · sp³=${Math.round((cp.md_sp3_fraction || 0) * 100)}% · sp=${Math.round((cp.md_sp_triple_fraction || 0) * 100)}% · β_MD=${esc(cp.md_implied_beta_eff)} · ρ_MD=${esc(cp.md_bulk_density_g_cm3)} g/cm³</span>
        `;
      }
      if (qs("#molDeckPreview") && molSimData.external_md_decks) {
        qs("#molDeckPreview").textContent = molSimData.external_md_decks.lammps_reaxff_in;
      }
      drawMolecule3dCanvas();
    } catch (err) {
      if (err.name !== "AbortError") console.error(err);
    }
  }

  function drawMolecule3dCanvas() {
    const setup = setupHiDpiCanvas(qs("#mol3dCanvas"));
    if (!setup || !molSimData || !molSimData.cluster_3d) return;
    const { ctx, w, h } = setup;
    const pal = themePalette();
    const atoms = molSimData.cluster_3d.atoms || [];
    const bonds = molSimData.cluster_3d.bonds || [];
    if (!atoms.length) return;

    ctx.fillStyle = "#080d18";
    ctx.fillRect(0, 0, w, h);

    // Center coordinates around centroid
    let mx = 0, my = 0, mz = 0;
    atoms.forEach((a) => { mx += a.x; my += a.y; mz += a.z; });
    mx /= atoms.length; my /= atoms.length; mz /= atoms.length;

    const cosY = Math.cos(molView.ry), sinY = Math.sin(molView.ry);
    const cosX = Math.cos(molView.rx), sinX = Math.sin(molView.rx);
    let maxSpan = 1.0;
    const rotated = atoms.map((a) => {
      const dx = a.x - mx, dy = a.y - my, dz = a.z - mz;
      const x1 = dx * cosY + dz * sinY;
      const z1 = -dx * sinY + dz * cosY;
      const y2 = dy * cosX - z1 * sinX;
      const z2 = dy * sinX + z1 * cosX;
      maxSpan = Math.max(maxSpan, Math.hypot(x1, y2, z2));
      return { ...a, rx: x1, ry: y2, rz: z2 };
    });

    const scale = (Math.min(w, h) * 0.41) / maxSpan;
    const camDist = maxSpan * 3.4;
    const projected = rotated.map((a) => {
      const persp = camDist / Math.max(1.5, camDist - a.rz);
      return {
        ...a,
        px: w / 2 + a.rx * scale * persp,
        py: h / 2 - a.ry * scale * persp,
        persp,
      };
    });

    // Draw depth-sorted bonds (single, double, triple C≡N / C≡C)
    const sortedBonds = [...bonds].sort((b1, b2) => {
      const z1 = (projected[b1.begin].rz + projected[b1.end].rz) * 0.5;
      const z2 = (projected[b2.begin].rz + projected[b2.end].rz) * 0.5;
      return z1 - z2;
    });

    sortedBonds.forEach((b) => {
      const a1 = projected[b.begin];
      const a2 = projected[b.end];
      const ux = a2.px - a1.px, uy = a2.py - a1.py;
      const len = Math.hypot(ux, uy) || 1;
      const nx = -uy / len, ny = ux / len;
      const order = Math.round(b.order || 1);
      ctx.strokeStyle = b.is_aromatic ? "#60a5fa" : "#64748b";
      ctx.lineWidth = order >= 3 ? 1.5 : 2.1;
      const offsets = order >= 3 ? [-2.6, 0, 2.6] : order === 2 ? [-1.8, 1.8] : [0];
      offsets.forEach((off) => {
        ctx.beginPath();
        ctx.moveTo(a1.px + nx * off, a1.py + ny * off);
        ctx.lineTo(a2.px + nx * off, a2.py + ny * off);
        ctx.stroke();
      });
    });

    // Draw depth-sorted CPK atoms (C = slate/graphite, N = royal cyan-blue, H = crisp light)
    const elemStyle = {
      C: { fill: "#94a3b8", rim: "#cbd5e1", rad: 5.4 },
      N: { fill: "#38bdf8", rim: "#bae6fd", rad: 5.8 },
      H: { fill: "#f8fafc", rim: "#94a3b8", rad: 3.3 },
    };
    const sortedAtoms = [...projected].sort((a, b) => a.rz - b.rz);
    sortedAtoms.forEach((a) => {
      const st = elemStyle[a.element] || elemStyle.C;
      const rPx = Math.max(2.2, st.rad * a.persp);
      ctx.beginPath();
      ctx.fillStyle = st.fill;
      ctx.arc(a.px, a.py, rPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = st.rim;
      ctx.lineWidth = 0.85;
      ctx.stroke();
    });

    // Legend overlay
    ctx.font = "600 10.5px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("● C (sp²/sp³/sp)", 12, h - 10);
    ctx.fillStyle = "#38bdf8";
    ctx.fillText("● N (pyridinic/-NH₂/-C≡N)", 122, h - 10);
    ctx.fillStyle = "#f8fafc";
    ctx.fillText("● H", 295, h - 10);
    ctx.fillStyle = pal.muted;
    ctx.textAlign = "right";
    ctx.fillText("Drag to rotate 3D", w - 12, h - 10);
  }

  const molCanvasEl = qs("#mol3dCanvas");
  if (molCanvasEl) {
    molCanvasEl.addEventListener("pointerdown", (e) => {
      molView.dragging = true;
      molView.lx = e.clientX;
      molView.ly = e.clientY;
      molCanvasEl.setPointerCapture(e.pointerId);
    });
    molCanvasEl.addEventListener("pointermove", (e) => {
      if (!molView.dragging) return;
      molView.ry += (e.clientX - molView.lx) * 0.012;
      molView.rx += (e.clientY - molView.ly) * 0.012;
      molView.lx = e.clientX;
      molView.ly = e.clientY;
      drawMolecule3dCanvas();
    });
    molCanvasEl.addEventListener("pointerup", () => { molView.dragging = false; });
    molCanvasEl.addEventListener("pointercancel", () => { molView.dragging = false; });
  }

  if (qs("#btnToggleMolSpin")) {
    qs("#btnToggleMolSpin").addEventListener("click", (e) => {
      molView.autoSpin = !molView.autoSpin;
      e.currentTarget.setAttribute("aria-pressed", String(molView.autoSpin));
      e.currentTarget.textContent = `Auto-Spin: ${molView.autoSpin ? "On" : "Off"}`;
    });
  }

  setInterval(() => {
    if (!molView.autoSpin || molView.dragging || !molSimData) return;
    if (qs("#panel-knowledge") && qs("#panel-knowledge").hasAttribute("hidden")) return;
    molView.ry += 0.025;
    drawMolecule3dCanvas();
  }, 55);

  qsa("[data-mol-dl]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await withBusyButton(btn, async () => {
        const fmt = btn.getAttribute("data-mol-dl");
        if (IS_STATIC_DEMO && molSimData) {
          const c3d = molSimData.cluster_3d || {};
          const decks = molSimData.external_md_decks || {};
          const map = {
            pdb: [`pecvd_${c3d.formula || "achn"}.pdb`, "chemical/x-pdb", c3d.pdb_block],
            sdf: [`pecvd_${c3d.formula || "achn"}.sdf`, "chemical/x-mdl-sdfile", c3d.sdf_block],
            lammps_reaxff: ["in.pecvd_achn_reaxff", "text/plain", decks.lammps_reaxff_in],
            lammps_data: ["data.pecvd_achn.lmp", "text/plain", decks.lammps_data_lmp],
            lammps_airebo: ["in.pecvd_achn_airebo", "text/plain", decks.lammps_airebo_in],
            ase_py: ["run_pecvd_gap20_md.py", "text/x-python", decks.ase_script_py],
          };
          const entry = map[fmt];
          if (entry && entry[2]) {
            downloadBlob(entry[0], entry[1], entry[2]);
            showToast(`Exported molecular file: ${entry[0]}`);
            return;
          }
        }
        const rcp = readKgWhatIfRecipe();
        const resp = await fetch(`/api/molecular/export/${encodeURIComponent(fmt)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipe: rcp, n_conformers: 4, seed: 42, workspace: activeWorkspace }),
        });
        if (!resp.ok) {
          const errBody = await readJsonSafe(resp);
          showToast(formatApiError(errBody, resp.status, "Failed to export molecular deck"));
          return;
        }
        const cd = resp.headers.get("Content-Disposition") || "";
        const match = cd.match(/filename="([^"]+)"/);
        const fname = match ? match[1] : `pecvd_molecular_${fmt}.txt`;
        const text = await resp.text();
        downloadBlob(fname, resp.headers.get("Content-Type") || "text/plain", text);
        showToast(`Exported molecular file: ${fname}`);
      });
    });
  });

  if (qs("#btnPushMolSandbox")) {
    qs("#btnPushMolSandbox").addEventListener("click", async (ev) => {
      await withBusyButton(ev.currentTarget, async () => {
        try {
          const rcp = readKgWhatIfRecipe();
          const out = await fetchJsonChecked(
            "/api/molecular/simulate",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ recipe: rcp, n_conformers: 4, seed: 42, workspace: "sandbox", ingest_to_sandbox: true }),
            },
            "Failed to push molecular simulation"
          );
          activeWorkspace = "sandbox";
          syncWorkspaceChrome();
          await refreshAll();
          showToast(
            `Assimilated coupled 3D Molecular Sim (${out.cluster_3d.formula}, β_MD=${out.coupled_priors.md_implied_beta_eff}) into Sandbox Brain v${out.sandbox_brain_version}!`
          );
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  // ------------------------------------------------------------------
  // Dedicated Knowledge Base, Configuration Search & Datasets Tracker (Tab 5)
  // ------------------------------------------------------------------
  let kbConfigSearchBound = false;
  let activeConfigPresetId = "tsmc_vhf_plug_trim";

  const debouncedAnnounceKbConfigStatus = debounce((msg) => {
    const el = qs("#kbConfigLiveStatus");
    if (el) el.textContent = msg;
  }, 320);

  function renderRankedConfigPaperCard(p, compact = false) {
    const fid = p.regime_fidelity || "analogous_extrapolated";
    const fidCls =
      fid === "exact_pecvd_har"
        ? "is-exact-regime"
        : fid === "direct_subsystem"
        ? "is-direct-subsystem"
        : "is-extrapolated";
    const fidLabel =
      fid === "exact_pecvd_har"
        ? "Exact PECVD/HAR Regime"
        : fid === "direct_subsystem"
        ? "Direct Subsystem"
        : "Analogous / Extrapolated";
    const fidBadgeCls = fid === "exact_pecvd_har" ? "badge-ok" : fid === "direct_subsystem" ? "" : "badge-warn";
    const scoreCls = Number(p.relevance_score || 0) >= 75 ? "" : "is-mid";

    const reasonsHtml = (p.matched_reasons || [])
      .map((r) => `<span class="match-reason-tag">✓ ${esc(r)}</span>`)
      .join("");
    const warnsHtml = (p.extrapolation_notes || [])
      .map((w) => `<span class="match-warn-tag">⚠ ${esc(w)}</span>`)
      .join("");

    const actionBtns = [];
    if (!compact && p.linked_dataset_ids && p.linked_dataset_ids.length) {
      const dsId = p.linked_dataset_ids[0];
      actionBtns.push(
        `<button type="button" class="btn" style="padding:0.16rem 0.45rem; font-size:0.76rem;" data-jump-kb-ds="${esc(dsId)}" aria-label="Load benchmark dataset ${esc(dsId)} for ${esc(p.title)}">📊 Benchmark Data</button>`
      );
    }
    if (p.linked_figures && p.linked_figures.length) {
      const figId = p.linked_figures[0].id;
      actionBtns.push(
        `<button type="button" class="btn" style="padding:0.16rem 0.45rem; font-size:0.76rem;" data-zoom-cfg-fig="${esc(figId)}" aria-label="Zoom figure ${esc(figId.toUpperCase())} for ${esc(p.title)}">🖼 ${esc(figId.toUpperCase())}</button>`
      );
    }

    return `
      <div class="config-paper-card ${fidCls}">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:0.4rem; flex-wrap:wrap;">
          <span class="match-score-pill ${scoreCls} mono">${esc(p.relevance_score)}% Match</span>
          <span class="badge ${fidBadgeCls} mono">${esc(fidLabel)}</span>
        </div>
        <div style="font-weight:600; line-height:1.32;">
          <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)} ↗</a>
        </div>
        <div class="mono" style="font-size:0.76rem; color:var(--muted);">${esc(p.citation)}</div>
        ${p.window_summary ? `<div class="mono" style="font-size:0.76rem; color:var(--brand);">${esc(p.window_summary)}</div>` : ""}
        <div style="color:var(--muted); font-size:0.76rem; line-height:1.36;">${esc(compact ? p.takeaway.slice(0, 165) + (p.takeaway.length > 165 ? "…" : "") : p.takeaway)}</div>
        ${reasonsHtml || warnsHtml ? `<div class="match-reason-row">${reasonsHtml}${warnsHtml}</div>` : ""}
        ${actionBtns.length ? `<div style="display:flex; gap:0.35rem; flex-wrap:wrap; margin-block-start:auto; padding-block-start:0.2rem;">${actionBtns.join("")}</div>` : ""}
      </div>
    `;
  }

  function bindConfigCardActions(container) {
    if (!container) return;
    container.querySelectorAll("[data-zoom-cfg-fig]").forEach((btn) => {
      btn.addEventListener("click", () => openFigureLightbox(btn.getAttribute("data-zoom-cfg-fig")));
    });
    container.querySelectorAll("[data-jump-kb-ds]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const dsId = btn.getAttribute("data-jump-kb-ds");
        const sel = qs("#kbDatasetSelect");
        if (sel && dsId) {
          sel.value = dsId;
          await loadSelectedKbDataset();
          sel.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    });
  }

  function readKbConfigDropdowns() {
    return {
      rf_regime: (qs("#cfgSelRf") && qs("#cfgSelRf").value) || "any",
      pressure_regime: (qs("#cfgSelPressure") && qs("#cfgSelPressure").value) || "any",
      temp_regime: (qs("#cfgSelTemp") && qs("#cfgSelTemp").value) || "any",
      chemistry: (qs("#cfgSelChem") && qs("#cfgSelChem").value) || "any",
      geometry: (qs("#cfgSelGeom") && qs("#cfgSelGeom").value) || "any",
      process_mode: (qs("#cfgSelMode") && qs("#cfgSelMode").value) || "any",
      method: (qs("#cfgSelMethod") && qs("#cfgSelMethod").value) || "any",
    };
  }

  function writeKbConfigDropdowns(filters) {
    const f = filters || {};
    const map = {
      rf_regime: "#cfgSelRf",
      pressure_regime: "#cfgSelPressure",
      temp_regime: "#cfgSelTemp",
      chemistry: "#cfgSelChem",
      geometry: "#cfgSelGeom",
      process_mode: "#cfgSelMode",
      method: "#cfgSelMethod",
    };
    Object.entries(map).forEach(([k, sel]) => {
      const el = qs(sel);
      if (el && f[k]) el.value = f[k];
    });
  }

  function syncPresetChipPressedState(presetId) {
    activeConfigPresetId = presetId || "";
    qsa("#kbConfigPresetBar [data-cfg-preset]").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("data-cfg-preset") === activeConfigPresetId));
    });
  }

  async function executeKbConfigSearch(customPayload = null) {
    if (!qs("#kbConfigPapersGrid")) return;
    const queryText = (qs("#kbConfigKeywordInput") && qs("#kbConfigKeywordInput").value.trim()) || "";
    const reqBody = customPayload || {
      filters: readKbConfigDropdowns(),
      query: queryText,
      top_k: 9,
    };
    try {
      const res = await fetchJsonChecked(
        "/api/knowledge_base/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        },
        "Configuration search failed"
      );
      if (res.active_filters) writeKbConfigDropdowns(res.active_filters);
      if (qs("#kbConfigSummaryBanner")) {
        const topScore = res.papers && res.papers.length ? `${res.papers[0].relevance_score}%` : "—";
        qs("#kbConfigSummaryBanner").innerHTML = `
          <div><b>Active Configuration:</b> <span class="mono">${esc(res.config_summary)}</span></div>
          <div class="mono">Showing top <b>${esc(res.returned_paper_count)}</b> of <b>${esc(res.total_matching_papers)}</b> matching papers (Top Match: <b>${esc(topScore)}</b>) · <b>${esc((res.matched_dataset_rows || []).length)}</b> benchmark rows</div>
        `;
      }
      const grid = qs("#kbConfigPapersGrid");
      grid.innerHTML = (res.papers || []).length
        ? res.papers.map((p) => renderRankedConfigPaperCard(p, false)).join("")
        : `<div style="padding:0.8rem; border:1px dashed var(--border); border-radius:0.45rem; color:var(--muted);">No papers matched all keyword tokens. Clear or broaden the keyword filter to view closest regime matches.</div>`;
      bindConfigCardActions(grid);

      const rows = res.matched_dataset_rows || [];
      if (qs("#kbConfigRowsCount")) qs("#kbConfigRowsCount").textContent = String(rows.length);
      if (qs("#kbConfigRowsBody")) {
        qs("#kbConfigRowsBody").innerHTML = rows.length
          ? rows
              .map(
                (r) => `
              <tr>
                <th scope="row" class="mono">${esc(r.row_label)}</th>
                <td style="font-size:0.75rem;">${esc(r.dataset_title.slice(0, 46))}${r.dataset_title.length > 46 ? "…" : ""}</td>
                <td><span class="badge ${r.provenance === "measured_owner" ? "badge-ok" : ""} mono">${esc(r.provenance)}</span></td>
                <td class="wrap-cell mono" style="font-size:0.76rem;">${esc(r.metrics_summary)}</td>
                <td style="font-size:0.76rem;">
                  <button type="button" class="btn" style="padding:0.16rem 0.45rem; font-size:0.76rem;" data-jump-kb-ds="${esc(r.dataset_id)}" aria-label="Inspect full dataset ${esc(r.dataset_id)} for ${esc(r.row_label)}">Open Table</button>
                </td>
              </tr>`
              )
              .join("")
          : `<tr><td colspan="5" style="color:var(--muted);">No linked quantitative dataset rows for this filter combination.</td></tr>`;
        bindConfigCardActions(qs("#kbConfigRowsBody"));
      }
      debouncedAnnounceKbConfigStatus(
        `${res.total_matching_papers} matching papers · ${rows.length} quantitative benchmark rows`
      );
    } catch (err) {
      showToast(err.message);
    }
  }

  const debouncedExecuteKbConfigSearch = debounce(() => executeKbConfigSearch(), 220);

  async function matchActiveRecipeInKbSearch() {
    const rcp = readKgWhatIfRecipe();
    const goal = (qs("#wmInlineGoal") && qs("#wmInlineGoal").value) || "plug_fill";
    syncPresetChipPressedState("");
    await executeKbConfigSearch({
      recipe: rcp,
      goal,
      query: (qs("#kbConfigKeywordInput") && qs("#kbConfigKeywordInput").value.trim()) || "",
      top_k: 9,
    });
  }

  async function updateWhatIfConfigPapers(rcp) {
    const grid = qs("#kgLiveRelevantPapersGrid");
    if (!grid) return;
    const goal = (qs("#wmInlineGoal") && qs("#wmInlineGoal").value) || "plug_fill";
    try {
      const res = await fetchJsonChecked(
        "/api/knowledge_base/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipe: rcp || readKgWhatIfRecipe(), goal, top_k: 3 }),
        },
        "Failed to match configuration papers"
      );
      if (qs("#kgLiveConfigSummary")) {
        qs("#kgLiveConfigSummary").textContent = `${res.config_summary} -> Top ${res.returned_paper_count} of ${res.total_matching_papers} papers`;
      }
      grid.innerHTML = (res.papers || []).map((p) => renderRankedConfigPaperCard(p, true)).join("");
      bindConfigCardActions(grid);
    } catch (_err) {
      // Keep non-blocking on rapid slider sweeps
    }
  }

  const debouncedWhatIfConfigPapers = debounce(updateWhatIfConfigPapers, 180);

  function bindKbConfigSearchControls() {
    if (kbConfigSearchBound || !qs("#kbConfigSearchForm")) return;
    kbConfigSearchBound = true;

    const presetBar = qs("#kbConfigPresetBar");
    const presets = (kbOverviewCache && kbOverviewCache.search_presets) || [];
    if (presetBar && presets.length) {
      presetBar.innerHTML = presets
        .map(
          (pr) => `
          <button type="button" class="config-preset-chip" data-cfg-preset="${esc(pr.preset_id)}" aria-pressed="${pr.preset_id === activeConfigPresetId ? "true" : "false"}" title="${esc(pr.description)}">
            ${esc(pr.label)}
          </button>`
        )
        .join("");
      presetBar.querySelectorAll("[data-cfg-preset]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const pid = btn.getAttribute("data-cfg-preset");
          syncPresetChipPressedState(pid);
          executeKbConfigSearch({
            preset_id: pid,
            query: (qs("#kbConfigKeywordInput") && qs("#kbConfigKeywordInput").value.trim()) || "",
            top_k: 9,
          });
        });
      });
    }

    ["#cfgSelRf", "#cfgSelPressure", "#cfgSelTemp", "#cfgSelChem", "#cfgSelGeom", "#cfgSelMode", "#cfgSelMethod"].forEach((id) => {
      const el = qs(id);
      if (el) {
        el.addEventListener("change", () => {
          syncPresetChipPressedState("");
          executeKbConfigSearch();
        });
      }
    });

    const kwInput = qs("#kbConfigKeywordInput");
    if (kwInput) {
      kwInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          if (e.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          executeKbConfigSearch();
        }
      });
      kwInput.addEventListener("input", () => {
        debouncedExecuteKbConfigSearch();
      });
    }

    qs("#kbConfigSearchForm").addEventListener("submit", (e) => {
      e.preventDefault();
      executeKbConfigSearch();
    });

    qs("#btnMatchActiveWhatIfConfig")?.addEventListener("click", () => {
      matchActiveRecipeInKbSearch();
      showToast("Matched active What-If chamber & feature configuration against all 102 papers & 10 datasets!");
    });

    qs("#btnResetKbConfigSearch")?.addEventListener("click", () => {
      writeKbConfigDropdowns({
        rf_regime: "any",
        pressure_regime: "any",
        temp_regime: "any",
        chemistry: "any",
        geometry: "any",
        process_mode: "any",
        method: "any",
      });
      if (qs("#kbConfigKeywordInput")) qs("#kbConfigKeywordInput").value = "";
      syncPresetChipPressedState("tsmc_vhf_plug_trim");
      executeKbConfigSearch({ preset_id: "tsmc_vhf_plug_trim", top_k: 9 });
    });
  }

  async function loadKbOverviewAndDatasets() {
    if (!qs("#kbDatasetSelect")) return;
    try {
      if (!kbOverviewCache) {
        kbOverviewCache = await fetchJsonChecked("/api/knowledge_base", {}, "Could not load knowledge base");
        const sel = qs("#kbDatasetSelect");
        const dsList = kbOverviewCache.datasets || [];
        sel.innerHTML = dsList
          .map((d) => `<option value="${esc(d.id)}">${esc(d.title)} (${esc(d.row_count)} rows)</option>`)
          .join("");
        const preferred = dsList.find((d) => d.id === "acl_nitrogen_oxygen_etch_benchmarks") || dsList.find((d) => d.id === "atomistic_md_and_pecvd_gapfill_benchmarks");
        if (preferred) sel.value = preferred.id;
        sel.addEventListener("change", loadSelectedKbDataset);
      }
      bindKbConfigSearchControls();
      if (qs("#kbTrackerKpis") && kbOverviewCache) {
        const dsCount = (kbOverviewCache.datasets || []).length;
        const trRows = (kbOverviewCache.training_manifest || []).reduce((acc, t) => acc + (t.row_count || 0), 0);
        qs("#kbTrackerKpis").innerHTML = `
          <div class="card"><div class="kpi-label">Verified Literature &amp; Patents</div><div class="kpi-value">${esc(kbOverviewCache.literature_count)}</div><div class="kpi-note">100% tagged with structured config_profile</div></div>
          <div class="card"><div class="kpi-label">Extracted Scientific Figures</div><div class="kpi-value">${esc(kbOverviewCache.figure_count)}</div><div class="kpi-note">Cross-section SEMs, 3D AFM, OES &amp; PIC-MCC</div></div>
          <div class="card"><div class="kpi-label">Quantitative Benchmark Datasets</div><div class="kpi-value">${esc(dsCount)}</div><div class="kpi-note">Includes N/O₂ ACL etch, pulsed CCP &amp; ReaxFF</div></div>
          <div class="card"><div class="kpi-label">Stage 1–3 Priors &amp; Logic Rules</div><div class="kpi-value">${esc(trRows)} rows</div><div class="kpi-note">12 AST-validated causal rules · explicit provenance</div></div>
        `;
      }
      await Promise.all([
        loadSelectedKbDataset(),
        executeKbConfigSearch(activeConfigPresetId ? { preset_id: activeConfigPresetId, top_k: 9 } : null),
      ]);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function loadSelectedKbDataset() {
    const sel = qs("#kbDatasetSelect");
    if (!sel || !sel.value) return;
    let ds;
    try {
      ds = await fetchJsonChecked(
        `/api/knowledge_base/dataset/${encodeURIComponent(sel.value)}`,
        {},
        "Could not load benchmark dataset"
      );
    } catch (err) {
      showToast(err.message);
      return;
    }
    if (qs("#kbDatasetDesc")) {
      qs("#kbDatasetDesc").textContent = `${ds.description || ""} (${ds.row_count} rows · JSON + CSV tracked in data/knowledge_base/datasets/)`;
    }
    const cols = ds.columns || [];
    if (qs("#kbDatasetHead")) {
      qs("#kbDatasetHead").innerHTML = `<tr>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr>`;
    }
    if (qs("#kbDatasetBody")) {
      qs("#kbDatasetBody").innerHTML = (ds.rows || [])
        .map(
          (row) =>
            `<tr>${cols
              .map((c, idx) =>
                idx === 0
                  ? `<th scope="row" class="mono">${esc(row[c] ?? "")}</th>`
                  : `<td class="${String(row[c] ?? "").length > 42 ? "wrap-cell" : "mono"}">${esc(row[c] ?? "")}</td>`
              )
              .join("")}</tr>`
        )
        .join("");
    }
  }

  // ------------------------------------------------------------------
  // 4-Layer Decision-Making Pyramid, Auto-Ingest Dropzone & Convergence Demo
  // ------------------------------------------------------------------
  async function loadDecisionPyramid() {
    if (!qs("#pyramidStackBox") || IS_STATIC_DEMO) {
      if (IS_STATIC_DEMO && qs("#pyramidStackBox") && brainData) {
        qs("#pyramidStackBox").innerHTML = `
          <div class="pyramid-tier-card" data-tier="4"><strong>Layer 4 · PECVD Expert Decision Gate</strong><div style="font-size:0.76rem;color:var(--muted);">Spec targets + cleanroom run-sheet sign-off</div></div>
          <div class="pyramid-tier-card" data-tier="3"><strong>Layer 3 · Coupled Sim, World Model &amp; Active BO</strong><div style="font-size:0.76rem;color:var(--muted);">CCP/Knudsen + 3D Molecular Sim + MAP θ̂ + GP + Constrained EI</div></div>
          <div class="pyramid-tier-card" data-tier="2"><strong>Layer 2 · 5-Tier Causal Graph &amp; Knowledge Base</strong><div style="font-size:0.76rem;color:var(--muted);">20 Nodes · ${esc((brainData.literature || []).length)} Papers · 12 AST Rules</div></div>
          <div class="pyramid-tier-card" data-tier="1"><strong>Layer 1 · Automated Data Ingestion &amp; Spec Grading</strong><div style="font-size:0.76rem;color:var(--muted);">Watch-folder + 8-layer schema + per-line ClientSpec check</div></div>
        `;
      }
      return;
    }
    try {
      const goal = (qs("#optGoal") && qs("#optGoal").value) || "plug_fill";
      const pyr = await fetchJsonChecked(
        `/api/pyramid?workspace=${encodeURIComponent(activeWorkspace)}&goal=${encodeURIComponent(goal)}`,
        {},
        "Failed to load Decision Pyramid"
      );
      const gateBadge = qs("#pyramidGateBadge");
      if (gateBadge) {
        gateBadge.textContent = pyr.gate_status === "SPEC_ACHIEVED" ? "Gate: SPEC ACHIEVED ✓" : "Gate: OPTIMIZING TO SPEC";
        gateBadge.className = "badge mono " + (pyr.gate_status === "SPEC_ACHIEVED" ? "badge-ok" : "badge-warn");
      }
      if (qs("#pyramidDecisionNote")) {
        qs("#pyramidDecisionNote").innerHTML = `<span><b>Executive Next Action:</b> ${esc(pyr.recommended_decision)}</span>`;
      }
      qs("#pyramidStackBox").innerHTML = (pyr.layers || [])
        .map((ly) => {
          const m = ly.live_metrics || {};
          let summaryBadges = "";
          if (ly.tier === 4) {
            summaryBadges = `Spec PH≥${esc(m.ph_min_nm)}nm, OB≤${esc(m.ob_max_nm)}nm · Passes: <b>${esc(m.measured_spec_passes)} meas</b>`;
          } else if (ly.tier === 3) {
            const pPct = m.top_candidate_p_spec != null ? `${Math.round(m.top_candidate_p_spec * 100)}%` : "—";
            summaryBadges = `Brain v${esc(m.brain_version)} · RMSE ${esc(m.uncalibrated_sim_rmse_nm ?? "—")}→<b>${esc(m.honest_pang_loocv_rmse_nm ?? "—")}nm</b> · Top P(spec)=<b>${pPct}</b>`;
          } else if (ly.tier === 2) {
            summaryBadges = `${esc(m.verified_papers_and_patents)} Papers · ${esc(m.extracted_figures)} Figs · ${esc(m.benchmark_datasets)} Datasets · ${esc(m.active_human_and_lit_rules)} Active Rules`;
          } else {
            summaryBadges = `${esc(m.measured_wafers)} Meas + ${esc(m.synthetic_wafers)} Synth · Inbox Pending: <b>${esc(m.inbox_pending_files)}</b> (${esc(m.inbox_processed_batches)} processed)`;
          }
          return `
            <div class="pyramid-tier-card" data-tier="${esc(ly.tier)}">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                <strong style="font-size:0.81rem;">${esc(ly.name)}</strong>
                <span class="mono" style="font-size:0.76rem; color:var(--brand);">${summaryBadges}</span>
              </div>
              <div style="font-size:0.76rem; color:var(--muted); margin-top:0.15rem;">
                <b>${esc(ly.owner_role)}:</b> ${esc(ly.purpose)}
              </div>
            </div>
          `;
        })
        .join("");
    } catch (err) {
      console.error(err);
    }
  }

  if (qs("#btnScanInboxNow")) {
    qs("#btnScanInboxNow").addEventListener("click", async (ev) => {
      await withBusyButton(ev.currentTarget, async () => {
        try {
          const rep = await fetchJsonChecked(
            "/api/auto_ingest/scan?next_batch_size=3",
            { method: "POST" },
            "Inbox auto-ingest scan failed"
          );
          const outBox = qs("#convergeDemoOutput");
          if (qs("#convergeDemoBadge")) {
            qs("#convergeDemoBadge").textContent = `${rep.processed_count} ingested · ${rep.rejected_count} rejected`;
          }
          if (!rep.scanned_count) {
            if (outBox) {
              outBox.innerHTML = `<div class="mono" style="color:var(--muted);">No pending <code>.csv</code> or <code>.json</code> drop files in <code>data/inbox/</code>. Drop cleanroom metrology files there and click Scan.</div>`;
            }
            showToast("Scanned data/inbox/: 0 pending files found.");
            return;
          }
          if (outBox) {
            outBox.innerHTML = (rep.processed || [])
              .map((p) => {
                const wLines = (p.per_wafer_spec_checks || [])
                  .map(
                    (w) =>
                      `<div>• <b>${esc(w.exp_id)}</b> [${esc(w.provenance)}] → <span class="badge ${w.meets_spec ? "badge-ok" : "badge-warn"}">${w.meets_spec ? "MEETS SPEC" : "FAILS SPEC"}</span> ` +
                      Object.entries(w.lines || {})
                        .map(([k, st]) => `${esc(k)}:${esc(st)}`)
                        .join(", ") +
                      `</div>`
                  )
                  .join("");
                return `<div style="margin-bottom:0.45rem;"><b>Auto-Ingested ${esc(p.file)} → ${esc(p.routed_workspace.toUpperCase())}:</b>${wLines}</div>`;
              })
              .join("");
          }
          await refreshAll();
          showToast(`Auto-ingested ${rep.processed_count} file(s) from data/inbox/ and graded ClientSpec lines!`);
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  if (qs("#btnRunConvergeDemo")) {
    qs("#btnRunConvergeDemo").addEventListener("click", async (ev) => {
      await withBusyButton(ev.currentTarget, async () => {
        try {
          const goal = (qs("#optGoal") && qs("#optGoal").value) || "plug_fill";
          const phMin = parseFloat(qs("#specPhMin") ? qs("#specPhMin").value : "975") || 975;
          const obMax = parseFloat(qs("#specObMax") ? qs("#specObMax").value : "105") || 105;
          const obTgt = Math.min(obMax, parseFloat(qs("#specObTarget") ? qs("#specObTarget").value : "50") || 50);
          const fhTgt = parseFloat(qs("#specFillTarget") ? qs("#specFillTarget").value : "520") || 520;
          const fhTol = parseFloat(qs("#specFillTol") ? qs("#specFillTol").value : "45") || 45;
          const densRaw = qs("#specDensityMin") ? qs("#specDensityMin").value.trim() : "";

          const res = await fetchJsonChecked(
            "/api/demo/converge_to_spec",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: (qs("#specName") && qs("#specName").value) || "Big-Semi Qualification Target",
                goal,
                ph_min_nm: phMin,
                ob_max_nm: obMax,
                ob_target_nm: obTgt,
                density_min_g_cm3: densRaw ? parseFloat(densRaw) : null,
                fill_height_target_nm: fhTgt,
                fill_height_tol_nm: fhTol,
                max_rounds: 4,
                batch_size: 3,
                seed: 2026,
              }),
            },
            "Convergence demo failed"
          );

          const badge = qs("#convergeDemoBadge");
          if (badge) {
            badge.textContent = res.converged_to_spec
              ? `CONVERGED IN ${res.rounds_to_converge} ROUND(S) (${res.total_wafers_used} Wafers · −${res.wafer_savings_pct}% vs Factorial)`
              : `Ran ${res.total_wafers_used} Wafers`;
            badge.className = "badge mono " + (res.converged_to_spec ? "badge-ok" : "badge-warn");
          }

          const outBox = qs("#convergeDemoOutput");
          if (outBox) {
            const baseHtml = `<div class="mono" style="margin-bottom:0.35rem; color:var(--muted);"><b>Baseline Real Coupons:</b> ${(res.initial_measured_baseline || [])
              .map((b) => `${esc(b.exp_id)}(PH=${esc(b.ph_depth_110_nm)}, OB=${esc(b.ob_nm)} → FAIL)`)
              .join(" · ")}</div>`;
            const roundsHtml = (res.rounds || [])
              .map((rd) => {
                const wRows = (rd.wafers || [])
                  .map((w) => {
                    const m = w.measured || {};
                    const depthStr = goal === "partial_fill" ? `h*=${esc(m.fill_height_110_nm)}nm` : `PH₁₁₀=${esc(m.ph_depth_110_nm)}nm, PH₂₂₅=${esc(m.ph_depth_225_nm)}nm`;
                    const lineTags = Object.entries(w.lines || {})
                      .map(([lk, lv]) => `<span style="color:${lv === "pass" ? "var(--ok)" : "var(--err)"}">${esc(lk)}=${esc(lv)}</span>`)
                      .join(" ");
                    return `<div class="mono" style="padding:0.2rem 0; border-bottom:1px dashed var(--border);">
                      <b>${esc(w.exp_id)}</b> (${esc(w.recipe_summary)}) → ${depthStr}, OB=${esc(m.ob_nm)}nm ·
                      <span class="badge ${w.meets_spec ? "badge-ok" : "badge-warn"}">${w.meets_spec ? "ALL CRITERIA MET ✓" : "PARTIAL/FAIL"}</span>
                      <span style="font-size:0.7rem;">[${lineTags}]</span>
                    </div>`;
                  })
                  .join("");
                return `<div style="margin-bottom:0.45rem;"><strong>Round ${esc(rd.round_index)} (${esc(rd.spec_passes_in_round)}/${esc(rd.wafers_run)} Met Criteria · θ̂ β_c0=${esc(rd.calibrated_beta_c0)}):</strong>${wRows}</div>`;
              })
              .join("");
            outBox.innerHTML = baseHtml + roundsHtml;
          }
          showToast(
            res.converged_to_spec
              ? `Demo hit all ClientSpec criteria in Round ${res.rounds_to_converge} (${res.total_wafers_used} wafers vs 36 traditional DoE)!`
              : `Demo ran ${res.total_wafers_used} wafers; relax spec or increase max_rounds.`
          );
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  // ------------------------------------------------------------------
  // Core Brain Data Fetch & Rendering
  // ------------------------------------------------------------------
  function drawAllCanvases() {
    drawInlineWorldModelCanvas();
    drawAfmScanCanvas();
    renderWorldSweeps();
    drawMolecule3dCanvas();
    drawKnowledgeGraph();
    if (kgLastPred) drawMechanismStudio(kgLastPred);
    drawTab1CausalGraph();
    drawHistoryChart();
    drawWaferFrontierAndQualityChart();
    if (lastSandboxPred) drawProfilePreview(lastSandboxPred);
  }

  let lastOptimizationSuggestions = [];
  let virtualRoundCounter = 2;
  let presetsLoaded = false;
  let clientSpecDirty = false;

  async function refreshAll() {
    syncWorkspaceChrome();
    try {
      brainData = await fetchJsonChecked(
        `/api/brain?workspace=${encodeURIComponent(activeWorkspace)}`,
        {},
        "Failed to load Brain state"
      );
    } catch (err) {
      showToast(err.message);
      return;
    }
    if (brainData.startup_warning) {
      const wb = qs("#startupWarnBanner");
      wb.textContent = brainData.startup_warning;
      wb.hidden = false;
    }
    renderKPIs();
    syncClientSpecForm();
    renderNextRoundIncumbent();
    renderPredictionAudit(brainData.prediction_audit);
    renderRegimes();
    renderReactionAndSensitivityTables();
    renderLiteratureLogicRules();
    renderKgInspector();
    populateSemDropdown();
    renderLedger();
    drawAllCanvases();
    if (!presetsLoaded) {
      presetsLoaded = true;
      loadCampaignPresets();
    }
    await Promise.all([
      loadDecisionPyramid(),
      loadRecommendations(),
      updateKgWhatIfPrediction(),
      updateSandboxPrediction(),
      loadSelectedTrainingTable(),
      loadKbOverviewAndDatasets(),
    ]);
  }

  function renderKPIs() {
    const h = brainData.history[brainData.history.length - 1] || {};
    const c = brainData.counts || {};
    const sp = brainData.client_spec || {};
    const inc = brainData.incumbent_measured || {};
    const val = brainData.validation || {};
    const wsTag = IS_STATIC_DEMO ? " [STATIC DEMO]" : activeWorkspace === "sandbox" ? " [SANDBOX]" : "";
    qs("#kpiVersion").textContent = `Brain v${brainData.brain_version}${wsTag}`;
    const litPriors =
      (c.literature_ccp_priors || 0) +
      (c.literature_bonding_priors || 0) +
      (c.literature_har_benchmarks || 0) +
      (c.literature_afm_benchmarks || 0);
    qs("#kpiStreams").textContent =
      `${c.measured_experiments ?? 3} Meas + ${c.synthetic_experiments ?? 9} Synth Wafers · ` +
      `${litPriors} Paper Priors · ${c.human_rules} Rules`;
    const honestLoocv = val.honest_loocv_rmse_ph_nm ?? h.pang_loocv_rmse_ph_nm ?? "—";
    const uncalRmse = val.uncalibrated_sim_rmse_ph_nm ?? h.uncalibrated_sim_rmse_ph_nm ?? "—";
    qs("#kpiRmse").textContent = `${uncalRmse} → ${honestLoocv} nm`;
    if (qs("#kpiRmseNote")) {
      const realRmse = val.real_measured_loocv_rmse_ph_nm ?? "—";
      const meanBase = val.predict_mean_baseline_rmse_ph_nm ?? "—";
      qs("#kpiRmseNote").textContent =
        `Refit-per-fold LOOCV · Real coupons: ${realRmse} nm vs predict-mean baseline: ${meanBase} nm`;
    }
    qs("#kpiUncert").textContent = `±${h.mean_epistemic_std_ph_nm ?? "—"} nm`;
    if (qs("#kpiUncertNote")) {
      qs("#kpiUncertNote").textContent =
        `Calibrated across ${litPriors} Literature priors, ${c.simulations ?? 0} Sims & ${c.experiments ?? 0} Wafers`;
    }

    const LINE_LABELS = {
      ph_110: "PH110",
      ph_225: "PH225",
      fill_height: "Fill h*",
      ob: "OB",
      crack: "Crack",
      nodule: "Nodule",
      density: "Density",
    };
    const STATUS_LABELS = {
      pass: "PASS",
      fail: "FAIL",
      not_measured: "UNMEASURED",
    };
    if (activeWorkspace === "sandbox") {
      qs("#kpiBest").textContent = `${h.best_experiment_id || "—"} (Sandbox)`;
    } else if (inc.any_measured_meets_spec && inc.incumbent_id) {
      qs("#kpiBest").textContent = `${inc.incumbent_id} (MEETS SPEC)`;
    } else {
      qs("#kpiBest").textContent = inc.closest_measured_id
        ? `None meets spec yet (best: ${inc.closest_measured_id})`
        : "None meets spec yet";
    }
    if (qs("#kpiBestSub")) {
      const scLines = inc.spec_check && inc.spec_check.lines ? Object.entries(inc.spec_check.lines) : [];
      if (activeWorkspace === "live" && scLines.length) {
        const prefix = inc.incumbent_id || inc.closest_measured_id
          ? `${inc.incumbent_id || inc.closest_measured_id}: `
          : "";
        qs("#kpiBestSub").textContent =
          prefix + scLines.map(([k, st]) => `${LINE_LABELS[k] || k}: ${STATUS_LABELS[st] || st}`).join(" · ");
      } else if (sp.ph_min_nm) {
        qs("#kpiBestSub").textContent =
          `Spec: PH ≥ ${sp.ph_min_nm} nm, OB ≤ ${sp.ob_max_nm} nm, Crack = ${sp.crack_allowed ? "Allowed" : "No"}`;
      }
    }
    qs("#histCountBadge").textContent = `${brainData.history.length} Brain snapshots`;
  }

  // ------------------------------------------------------------------
  // Step 1 & Step 2: Campaign Ingestion, Diagnosis, ClientSpec & Audit
  // ------------------------------------------------------------------
  function syncClientSpecForm(force = false) {
    const sp = (brainData && brainData.client_spec) || {};
    if (!qs("#clientSpecForm")) return;
    qs("#specActiveBadge").textContent =
      `${sp.name ? `${sp.name} · ` : ""}PH≥${sp.ph_min_nm ?? 975} · OB≤${sp.ob_max_nm ?? 125}` +
      (sp.density_min_g_cm3 ? ` · ρ≥${sp.density_min_g_cm3}` : "");
    // Preserve unsaved user edits during background refreshAll() (`P3.5`)
    if (clientSpecDirty && !force) return;
    if (qs("#specName")) qs("#specName").value = sp.name ?? "Default 1.0 µm Carbon Gap-Fill Spec";
    qs("#specPhMin").value = sp.ph_min_nm ?? 975;
    qs("#specObMax").value = sp.ob_max_nm ?? 125;
    qs("#specObTarget").value = sp.ob_target_nm ?? 55;
    qs("#specDensityMin").value = sp.density_min_g_cm3 ?? "";
    qs("#specFillTarget").value = sp.fill_height_target_nm ?? 520;
    qs("#specFillTol").value = sp.fill_height_tol_nm ?? 60;
    qs("#specCrackAllowed").checked = Boolean(sp.crack_allowed);
    qs("#specNoduleAllowed").checked = Boolean(sp.nodule_allowed);
  }

  function renderNextRoundIncumbent() {
    const box = qs("#nextRoundIncumbentBox");
    const badge = qs("#nextRoundIncumbentBadge");
    if (!box || !badge || !brainData) return;
    const inc = brainData.incumbent_measured || {};
    const m = inc.measured || {};
    const lines = (inc.spec_check && inc.spec_check.lines) || {};
    const LINE_NAMES = {
      ph_110: "PH 110 nm",
      ph_225: "PH 225 nm",
      fill_height: "Fill h*",
      ob: "Overburden",
      crack: "Crack",
      nodule: "Nodule",
      density: "Density",
    };
    const STATUS_BADGE = {
      pass: { cls: "badge-ok", txt: "PASS" },
      fail: { cls: "badge-err", txt: "FAIL" },
      not_measured: { cls: "", txt: "UNMEASURED" },
    };

    const targetId = inc.incumbent_id || inc.closest_measured_id;
    if (inc.any_measured_meets_spec && inc.incumbent_id) {
      badge.textContent = `${inc.incumbent_id} · MEETS SPEC`;
      badge.className = "badge badge-ok mono";
    } else if (targetId) {
      badge.textContent = `None meets spec · Closest: ${targetId}`;
      badge.className = "badge badge-warn mono";
    } else {
      badge.textContent = "0 measured wafers";
      badge.className = "badge mono";
      box.textContent = "No measured physical coupons in ledger yet.";
      return;
    }

    const linePills = Object.entries(lines)
      .map(([k, st]) => {
        const meta = STATUS_BADGE[st] || { cls: "", txt: st };
        return `<span class="badge ${meta.cls} mono">${esc(LINE_NAMES[k] || k)}: ${esc(meta.txt)}</span>`;
      })
      .join(" ");

    const metroParts = [];
    if (m.ph_depth_110_nm != null) metroParts.push(`PH₁₁₀=${esc(m.ph_depth_110_nm)} nm`);
    if (m.ph_depth_225_nm != null) metroParts.push(`PH₂₂₅=${esc(m.ph_depth_225_nm)} nm`);
    if (m.fill_height_110_nm != null) metroParts.push(`h*=${esc(m.fill_height_110_nm)} nm`);
    if (m.ob_nm != null) metroParts.push(`OB=${esc(m.ob_nm)} nm`);
    if (m.void_width_110_nm != null) metroParts.push(`Void=${esc(m.void_width_110_nm)} nm`);

    box.innerHTML = `
      <div class="mono" style="margin-bottom:0.35rem; color:var(--text);">
        <b>${esc(targetId)}</b> [measured · ${esc(inc.measured_count ?? 0)} physical coupon(s)]: ${metroParts.join(" · ") || "—"}
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:0.3rem;">${linePills}</div>
    `;
  }

  function populateSuggestionPickers(audit) {
    const entries = (audit && audit.entries) || [];
    ["#semIngestSuggestionId", "#manualSuggestionId"].forEach((selId) => {
      const sel = qs(selId);
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = '<option value="">— None (unlinked wafer) —</option>';
      [...entries].reverse().forEach((ent) => {
        const opt = document.createElement("option");
        opt.value = ent.suggestion_id;
        const r = ent.recipe || {};
        const gradedCnt = (ent.outcomes || []).length;
        const tag = gradedCnt ? ` [graded ×${gradedCnt}]` : " [pending]";
        opt.textContent = `${ent.suggestion_id.slice(0, 14)}… · ${r.freq_mhz ?? "?"}M / ${r.power_w ?? "?"}W / NH₃ ${r.nh3_sccm ?? "?"}${tag}`;
        sel.appendChild(opt);
      });
      if (prev && entries.some((e) => e.suggestion_id === prev)) {
        sel.value = prev;
      }
    });
  }

  function renderPredictionAudit(audit) {
    const box = qs("#predAuditBox");
    const badge = qs("#predAuditBadge");
    populateSuggestionPickers(audit);
    if (!box || !badge || !audit) return;
    const measS = audit.headline_summary || audit.measured_summary || {};
    const synS = audit.sandbox_synthetic_summary || {};
    badge.textContent = `${measS.count || 0} meas graded / ${audit.total_logged || 0} planned`;
    if (!measS.count && !synS.count) {
      box.innerHTML =
        'Press <b>Plan This Round</b> (or export the run-sheet) to log candidate UUIDs. Page loads and filter changes never log.';
      return;
    }
    const zEntries = Object.entries(measS.mean_abs_z || {})
      .map(([k, v]) => `${esc(k)}: <b>${esc(v)}σ</b>`)
      .join(" · ");
    const devNote =
      audit.recipe_deviation_count > 0
        ? ` · <span class="badge badge-warn">${esc(audit.recipe_deviation_count)} recipe dev</span>`
        : "";
    const measHtml = measS.count
      ? `<div class="mono" style="margin-bottom:0.25rem;">
           <b>Measured Headline (${esc(measS.count)} wafers):</b>
           Spec Hit Rate <b style="color:var(--ok)">${((measS.spec_hit_rate || 0) * 100).toFixed(0)}%</b> ·
           Brier <b>${esc(measS.brier_score ?? "—")}</b> · |z|&gt;2σ <b>${((measS.share_outside_2sigma || 0) * 100).toFixed(0)}%</b>${devNote}
         </div>
         <div class="mono" style="font-size:0.75rem; margin-bottom:0.2rem;">Measured Mean |z-score|: ${zEntries || "—"}</div>`
      : `<div class="mono" style="margin-bottom:0.25rem;"><b>Measured Headline:</b> 0 physical measured wafers graded yet.${devNote}</div>`;
    const synHtml =
      activeWorkspace === "sandbox" && synS.count
        ? `<div class="mono" style="font-size:0.76rem; color:var(--muted);">
             Sandbox / Synthetic (excluded from headline): ${esc(synS.count)} runs · Hit ${((synS.spec_hit_rate || 0) * 100).toFixed(0)}% · Brier ${esc(synS.brier_score ?? "—")}
           </div>`
        : "";
    box.innerHTML = measHtml + synHtml;
  }

  function renderCampaignReport(report) {
    const card = qs("#campaignReportCard");
    if (!card || !report) return;
    card.hidden = false;
    const cnt = report.ingested_counts || {};
    const sh = report.calibration_shift || {};
    qs("#campaignReportTitle").textContent = `Diagnosis · ${report.title || report.dataset_id}`;
    const passBadge = qs("#campaignPassBadge");
    passBadge.textContent = `${cnt.spec_passes ?? 0} / ${cnt.wafers ?? 0} Wafers Met Spec (${Math.round((cnt.spec_pass_rate || 0) * 100)}%)`;
    passBadge.className = "badge mono " + ((cnt.spec_passes || 0) > 0 ? "badge-ok" : "badge-warn");

    const mechs = Object.entries(report.mechanism_histogram || {})
      .map(([m, n]) => `${esc(m)} (${esc(n)})`)
      .join(" · ");
    const thBefore = sh.theta_before || {};
    const thAfter = sh.theta_after || {};
    qs("#campaignSummaryStrip").innerHTML = `
      <span><b>Ingested:</b> ${esc(cnt.wafers)} wafers + ${esc(cnt.simulations)} sims · <b>Mechanisms:</b> ${mechs || "—"}</span>
      <span><b>MAP Calibration:</b> β_c0 ${Number(thBefore.beta_c0 || 0).toFixed(4)}→<b>${Number(thAfter.beta_c0 || 0).toFixed(4)}</b> · k_pass ${Number(thBefore.k_pass || 0).toFixed(2)}→<b>${Number(thAfter.k_pass || 0).toFixed(2)}</b> · RMSE ${esc(sh.rmse_before_nm ?? "—")}→<b style="color:var(--ok)">${esc(sh.rmse_after_nm ?? "—")} nm</b></span>
    `;

    const tbody = qs("#campaignDiagBody");
    tbody.innerHTML = (report.wafer_diagnoses || [])
      .map((w) => {
        const depthTxt =
          w.fill_mode === "partial_fill"
            ? `h*=${esc(w.fill_height_110_nm ?? "—")}nm`
            : `PH=${esc(w.ph_depth_110_nm ?? "—")}nm`;
        const oesTxt =
          w.oes_cn_ar != null
            ? `${esc(w.oes_cn_ar)} · ${esc(w.rf_3rd_harmonic_pct ?? "—")}%`
            : "<span style='color:var(--muted)'>null</span>";
        const rhoTxt =
          w.film_density_g_cm3 != null
            ? `${esc(w.film_density_g_cm3)}`
            : "<span style='color:var(--muted)'>null</span>";
        const specHtml = w.meets_client_spec
          ? '<span class="badge badge-ok">PASS</span>'
          : `<span class="badge badge-warn">FAIL (${esc(w.bottleneck_metric)})</span>`;
        return `
          <tr>
            <th scope="row" class="mono">${esc(w.record_id)} <span class="badge mono">${esc(w.provenance)}</span></th>
            <td class="mono">${esc(w.freq_mhz)}M · N/C ${Number(w.nc_ratio).toFixed(2)} · Trim ${Math.round((w.trim_fraction || 0) * 100)}%</td>
            <td class="mono">OB ${esc(w.ob_mean_nm)}nm · ${depthTxt}</td>
            <td class="mono">${oesTxt}</td>
            <td class="mono">${rhoTxt}</td>
            <td>${specHtml}</td>
            <td class="mono" style="font-size:0.76rem;">${esc((w.dominant_mechanisms || []).join(", "))} (Φ=${esc(w.estimated_thiele_110)})</td>
            <td class="wrap-cell" style="font-size:0.76rem;">${esc(w.actionable_lever)}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function applyIngestedCampaignReport(report) {
    if (report.workspace === "sandbox" && activeWorkspace !== "sandbox") {
      activeWorkspace = "sandbox";
      syncWorkspaceChrome();
    }
    renderCampaignReport(report);
    if (report.target_goal && qs("#optGoal")) {
      qs("#optGoal").value = report.target_goal;
    }
    await refreshAll();
    if (report.next_experiment_plan && report.next_experiment_plan.suggestions) {
      renderOptimizationSuggestions(report.next_experiment_plan.suggestions, report.target_goal || qs("#optGoal").value);
    }
    if (report.prediction_audit) {
      renderPredictionAudit(report.prediction_audit);
    }
  }

  async function loadCampaignPresets() {
    const grid = qs("#presetCampaignGrid");
    if (!grid) return;
    let data;
    try {
      data = await fetchJsonChecked("/api/campaigns/presets", {}, "Failed to load campaign presets");
    } catch (err) {
      showToast(err.message);
      return;
    }
    grid.innerHTML = "";
    (data.presets || []).forEach((p) => {
      const card = document.createElement("div");
      card.className = "preset-pack-card";
      card.innerHTML = `
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; gap:0.35rem; margin-bottom:0.2rem;">
            <strong style="font-size:0.8rem;">${esc(p.title.split("·")[0].trim())}</strong>
            <span class="badge mono">${esc(p.wafer_count)}W + ${esc(p.simulation_count)}S</span>
          </div>
          <div style="font-size:0.76rem; color:var(--muted);">${esc(p.description)}</div>
        </div>
        <button type="button" class="btn btn-primary" style="font-size:0.76rem; width:100%; justify-content:center;">
          Ingest &amp; Analyze → Optimize Next
        </button>
      `;
      const btn = card.querySelector("button");
      btn.addEventListener("click", async () => {
        await withBusyButton(btn, async () => {
          try {
            const batchSize = parseInt(qs("#optBatch").value, 10) || 4;
            const report = await fetchJsonChecked(
              `/api/campaigns/ingest_preset/${encodeURIComponent(p.dataset_id)}?next_batch_size=${batchSize}`,
              { method: "POST" },
              "Failed to ingest campaign preset"
            );
            await applyIngestedCampaignReport(report);
            showToast(
              `Ingested "${p.dataset_id}": ${report.ingested_counts.spec_passes}/${report.ingested_counts.wafers} met spec -> Brain v${report.brain_snapshot.brain_version} proposed ${report.next_experiment_plan.suggestions.length} next experiments!`
            );
          } catch (err) {
            showToast(err.message);
          }
        });
      });
      grid.appendChild(card);
    });
  }

  if (qs("#campaignFileInput")) {
    qs("#campaignFileInput").addEventListener("change", async (ev) => {
      const inputEl = ev.currentTarget;
      const file = inputEl.files[0];
      if (!file || inputEl.disabled) return;
      inputEl.disabled = true;
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("next_batch_size", String(parseInt(qs("#optBatch").value, 10) || 4));
        const report = await fetchJsonChecked(
          "/api/campaigns/upload",
          { method: "POST", body: fd },
          "Campaign upload failed"
        );
        await applyIngestedCampaignReport(report);
        showToast(
          `Uploaded & analyzed "${file.name}" (${report.ingested_counts.wafers} wafers) -> Brain v${report.brain_snapshot.brain_version} ready with next DoE batch!`
        );
      } catch (err) {
        showToast(err.message);
      } finally {
        inputEl.value = "";
        inputEl.disabled = false;
      }
    });
  }

  if (qs("#customFakeForm")) {
    qs("#customFakeForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      if (!form.checkValidity()) {
        const firstInvalid = form.querySelector(":invalid");
        if (firstInvalid) firstInvalid.focus();
        return;
      }
      await withBusyButton(qs("#btnSubmitCustomFake"), async () => {
        try {
          const payload = {
            n_wafers: parseInt(qs("#genWafers").value, 10) || 6,
            n_simulations: parseInt(qs("#genSims").value, 10) || 3,
            goal: qs("#genGoal").value,
            noise_scale: 1.0,
            seed: parseInt(qs("#genSeed").value, 10) || 2026,
            ingest_immediately: true,
            next_batch_size: parseInt(qs("#optBatch").value, 10) || 4,
          };
          const report = await fetchJsonChecked(
            "/api/campaigns/generate_fake",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            },
            "Failed to generate fake campaign"
          );
          qs("#genSeed").value = String(payload.seed + 1);
          await applyIngestedCampaignReport(report);
          showToast(
            `Generated & ingested ${payload.n_wafers} synthetic ${payload.goal} wafers + ${payload.n_simulations} sims -> Next batch ready!`
          );
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  if (qs("#clientSpecForm")) {
    const markSpecDirty = () => {
      clientSpecDirty = true;
    };
    qs("#clientSpecForm").addEventListener("input", markSpecDirty);
    qs("#clientSpecForm").addEventListener("change", markSpecDirty);
    qs("#clientSpecForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      if (!form.checkValidity()) {
        const firstInvalid = form.querySelector(":invalid");
        if (firstInvalid) firstInvalid.focus();
        return;
      }
      await withBusyButton(qs("#btnSaveClientSpec"), async () => {
        try {
          const densRaw = qs("#specDensityMin").value.trim();
          const currentName =
            (qs("#specName") && qs("#specName").value.trim()) ||
            (brainData && brainData.client_spec && brainData.client_spec.name) ||
            "Client Acceptance Spec";
          const payload = {
            name: currentName,
            ph_min_nm: parseFloat(qs("#specPhMin").value),
            ob_max_nm: parseFloat(qs("#specObMax").value),
            ob_target_nm: parseFloat(qs("#specObTarget").value),
            density_min_g_cm3: densRaw ? parseFloat(densRaw) : null,
            fill_height_target_nm: parseFloat(qs("#specFillTarget").value),
            fill_height_tol_nm: parseFloat(qs("#specFillTol").value),
            crack_allowed: qs("#specCrackAllowed").checked,
            nodule_allowed: qs("#specNoduleAllowed").checked,
          };
          await fetchJsonChecked(
            `/api/spec?workspace=${encodeURIComponent(activeWorkspace)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            },
            "Could not save Client Spec"
          );
          clientSpecDirty = false;
          showToast(`Saved "${currentName}" -> re-scoring ledger & recomputing optimal next experiments!`);
          await refreshAll();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  // ------------------------------------------------------------------
  // Tab 1 Compact Causal Graph + Brain Evolution Trajectory
  // ------------------------------------------------------------------
  function drawTab1CausalGraph() {
    if (!brainData) return;
    const res = renderCausalNetwork(qs("#causalCanvas"), {
      selectedType: "node",
      selectedNodeId: tab1HoveredNodeId,
      selectedEdgeIdx: -1,
      filterMode: "all",
      activations: lastSandboxPred ? lastSandboxPred.node_activations : {},
      boxH: 25,
      maxBoxW: 120,
    });
    tab1Boxes = res.boxes;
  }

  qs("#causalCanvas").addEventListener("mousemove", (ev) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const hit = tab1Boxes.find((b) => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
    if (hit && hit.id !== tab1HoveredNodeId) {
      tab1HoveredNodeId = hit.id;
      const rel = brainData.causal_graph.edges.filter((e) => e.source === hit.id || e.target === hit.id);
      qs("#causalNodeHint").textContent = `[${hit.label}] Connected to ${rel.length} causal pathways (${rel.map((e) => `${e.source}->${e.target}[${e.origin}]`).slice(0, 4).join(", ")})`;
      drawTab1CausalGraph();
    }
  });

  function drawHistoryChart() {
    if (!brainData || !brainData.history.length) return;
    const setup = setupHiDpiCanvas(qs("#historyCanvas"));
    if (!setup) return;
    const { ctx, w, h } = setup;

    const pal = themePalette();
    const hist = brainData.history;
    const padL = 46, padR = 48, padT = 20, padB = 28;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const maxRmse = Math.max(220, ...hist.map((item) => item.uncalibrated_sim_rmse_ph_nm || 180));
    const xAt = (i) => padL + (hist.length === 1 ? plotW / 2 : (i / (hist.length - 1)) * plotW);
    const yRmse = (v) => padT + plotH * (1 - Math.min(1, (v || 0) / maxRmse));
    const yUtil = (u) => padT + plotH * (1 - Math.min(1, Math.max(0, ((u || 0) - 350) / 650)));

    ctx.strokeStyle = pal.border;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    const drawSeries = (pts, color, dashed = false) => {
      const valid = pts.filter((p) => p[1] !== null && Number.isFinite(p[1]));
      if (!valid.length) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.1;
      if (dashed) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      valid.forEach(([x, y], idx) => (idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
      valid.forEach(([x, y]) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    };

    drawSeries(hist.map((item, i) => [xAt(i), item.uncalibrated_sim_rmse_ph_nm != null ? yRmse(item.uncalibrated_sim_rmse_ph_nm) : null]), pal.err, true);
    drawSeries(hist.map((item, i) => [xAt(i), item.pang_loocv_rmse_ph_nm != null ? yRmse(item.pang_loocv_rmse_ph_nm) : null]), pal.brand, false);
    drawSeries(hist.map((item, i) => [xAt(i), yUtil(item.best_experiment_utility)]), pal.ok, false);

    ctx.font = "500 11px system-ui, sans-serif";
    ctx.fillStyle = pal.muted;
    ctx.textAlign = "left";
    ctx.fillText("Red dashed: Uncal Sim RMSE · Blue: PANG RMSE (nm) · Green: Best Wafer Utility", padL, 12);
    hist.forEach((item, i) => {
      ctx.textAlign = "center";
      ctx.fillText(`v${item.brain_version}(N=${item.n_experiments})`, xAt(i), h - 8);
    });
  }

  function drawWaferFrontierAndQualityChart() {
    const cv = qs("#parityCanvas");
    if (!cv || !brainData) return;
    const setup = setupHiDpiCanvas(cv);
    if (!setup) return;
    const { ctx, w, h } = setup;
    const pal = themePalette();
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const exps = brainData.experiments || [];
    const spec = brainData.client_spec || {};
    const goal = (qs("#optGoal") && qs("#optGoal").value) || "plug_fill";

    const obMax = Number(spec.ob_max_nm || 105);
    const phMin = Number(spec.ph_min_nm || 975);
    const fhTarget = Number(spec.fill_height_target_nm || 520);
    const fhTol = Number(spec.fill_height_tol_nm || 45);

    const midGap = 34;
    const leftBox = { x: 50, y: 26, w: Math.max(160, Math.floor((w - 86 - midGap) * 0.56)), h: h - 54 };
    const rightBox = { x: leftBox.x + leftBox.w + midGap + 24, y: 26, w: Math.max(140, w - (leftBox.x + leftBox.w + midGap + 42)), h: h - 54 };

    // Left: OB vs PH_110 / Fill Height with ClientSpec target box + BO suggestions
    const pts = exps
      .map((e) => {
        const m = e.measured || {};
        const x = Number(m.ob_nm);
        const y = Number(goal === "partial_fill" ? (m.fill_height_110_nm ?? m.ph_depth_110_nm) : m.ph_depth_110_nm);
        return Number.isFinite(x) && Number.isFinite(y)
          ? { id: e.exp_id, x, y, measured: e.provenance === "measured", pass: Boolean(e.spec_check && e.spec_check.meets_spec) }
          : null;
      })
      .filter(Boolean);

    const boPts = (lastOptimizationSuggestions || [])
      .map((s, idx) => {
        const p = (s.prediction && s.prediction.pang_posterior) || {};
        const x = Number(p.ob_nm);
        const y = Number(goal === "partial_fill" ? p.fill_height_110_nm : p.ph_depth_110_nm);
        return Number.isFinite(x) && Number.isFinite(y) ? { rank: idx + 1, x, y } : null;
      })
      .filter(Boolean);

    const xs = [obMax + 25, ...pts.map((p) => p.x), ...boPts.map((p) => p.x)];
    const ys = [goal === "partial_fill" ? fhTarget : phMin, ...pts.map((p) => p.y), ...boPts.map((p) => p.y)];
    const xMin = Math.min(25, ...xs) - 8;
    const xMax = Math.max(140, ...xs) + 12;
    const yMin = goal === "partial_fill" ? Math.min(250, ...ys) - 25 : Math.min(560, ...ys) - 25;
    const yMax = goal === "partial_fill" ? Math.max(680, ...ys) + 25 : 1020;

    const sx = (v) => leftBox.x + ((v - xMin) / Math.max(1, xMax - xMin)) * leftBox.w;
    const sy = (v) => leftBox.y + leftBox.h - ((v - yMin) / Math.max(1, yMax - yMin)) * leftBox.h;

    // Target box
    const tx2 = Math.max(leftBox.x, Math.min(leftBox.x + leftBox.w, sx(obMax)));
    const tyTop = Math.max(leftBox.y, sy(goal === "partial_fill" ? fhTarget + fhTol : 1012));
    const tyBot = Math.min(leftBox.y + leftBox.h, sy(goal === "partial_fill" ? fhTarget - fhTol : phMin));
    ctx.fillStyle = isDark ? "rgba(16,185,129,0.18)" : "rgba(5,150,105,0.12)";
    ctx.fillRect(leftBox.x, tyTop, Math.max(0, tx2 - leftBox.x), Math.max(0, tyBot - tyTop));
    ctx.strokeStyle = pal.border;
    ctx.strokeRect(leftBox.x, leftBox.y, leftBox.w, leftBox.h);

    ctx.fillStyle = pal.text;
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(
      goal === "partial_fill" ? "Wafer Frontier: OB vs. Partial Fill Height (nm)" : "Wafer Frontier: Overburden vs. PH₁₁₀ (nm)",
      leftBox.x,
      15
    );

    pts.forEach((p) => {
      const px = sx(p.x), py = sy(p.y);
      const col = p.pass ? pal.ok : pal.brand;
      ctx.beginPath();
      ctx.arc(px, py, 4.6, 0, Math.PI * 2);
      if (p.measured) {
        ctx.fillStyle = col;
        ctx.fill();
      } else {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.9;
        ctx.stroke();
      }
    });

    boPts.forEach((b) => {
      const px = sx(b.x), py = sy(b.y);
      ctx.fillStyle = pal.warn;
      ctx.beginPath();
      ctx.moveTo(px, py - 6.5); ctx.lineTo(px + 6.5, py); ctx.lineTo(px, py + 6.5); ctx.lineTo(px - 6.5, py);
      ctx.closePath();
      ctx.fill();
    });

    ctx.fillStyle = pal.muted;
    ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
    ctx.fillText(`OB (nm) · Spec <= ${obMax} · Diamonds = BO Batch`, leftBox.x, h - 8);
    ctx.fillText(yMax.toFixed(0), 6, leftBox.y + 8);
    ctx.fillText(yMin.toFixed(0), 6, leftBox.y + leftBox.h);

    // Right: Film Density vs AFM Rq (or fallback OB if AFM sparse)
    ctx.strokeStyle = pal.border;
    ctx.strokeRect(rightBox.x, rightBox.y, rightBox.w, rightBox.h);
    const afmPts = exps
      .map((e) => {
        const m = e.measured || {};
        const d = Number(m.film_density_g_cm3);
        const a = Number(m.afm_rms_nm);
        return Number.isFinite(d) && Number.isFinite(a)
          ? { id: e.exp_id, x: d, y: a, measured: e.provenance === "measured", pass: Boolean(e.spec_check && e.spec_check.meets_spec) }
          : null;
      })
      .filter(Boolean);

    ctx.fillStyle = pal.text;
    ctx.font = "700 11px system-ui, sans-serif";
    if (afmPts.length >= 2) {
      ctx.fillText("Film Quality: XRR Density ρ vs. Inline AFM R_q", rightBox.x, 15);
      const dMin = Math.min(1.65, ...afmPts.map((p) => p.x)) - 0.04;
      const dMax = Math.max(1.94, ...afmPts.map((p) => p.x)) + 0.04;
      const aMin = 0.6;
      const aMax = Math.max(2.6, ...afmPts.map((p) => p.y)) + 0.3;
      const rx = (v) => rightBox.x + ((v - dMin) / Math.max(0.05, dMax - dMin)) * rightBox.w;
      const ry = (v) => rightBox.y + rightBox.h - ((v - aMin) / Math.max(0.2, aMax - aMin)) * rightBox.h;

      const dLim = Number(spec.density_min_g_cm3 || 1.80);
      const aLim = Number(spec.afm_rq_max_nm || 1.65);
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = pal.ok;
      if (dLim >= dMin && dLim <= dMax) {
        ctx.beginPath(); ctx.moveTo(rx(dLim), rightBox.y); ctx.lineTo(rx(dLim), rightBox.y + rightBox.h); ctx.stroke();
      }
      if (aLim >= aMin && aLim <= aMax) {
        ctx.beginPath(); ctx.moveTo(rightBox.x, ry(aLim)); ctx.lineTo(rightBox.x + rightBox.w, ry(aLim)); ctx.stroke();
      }
      ctx.restore();

      afmPts.forEach((p) => {
        const px = rx(p.x), py = ry(p.y);
        const col = p.pass ? pal.ok : pal.brand;
        ctx.beginPath();
        ctx.arc(px, py, 4.6, 0, Math.PI * 2);
        if (p.measured) { ctx.fillStyle = col; ctx.fill(); }
        else { ctx.strokeStyle = col; ctx.lineWidth = 1.9; ctx.stroke(); }
      });
      ctx.fillStyle = pal.muted;
      ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
      ctx.fillText(`Density ρ (g/cm³) · Spec >= ${dLim.toFixed(2)}, AFM <= ${aLim.toFixed(2)} nm`, rightBox.x, h - 8);
    } else {
      ctx.fillText("Dual-CD Fill Balance: PH₁₁₀ vs. PH₂₂₅ (nm)", rightBox.x, 15);
      const cdPts = exps
        .map((e) => {
          const m = e.measured || {};
          const x = Number(m.ph_depth_110_nm);
          const y = Number(m.ph_depth_225_nm);
          return Number.isFinite(x) && Number.isFinite(y) ? { x, y, measured: e.provenance === "measured", pass: Boolean(e.spec_check && e.spec_check.meets_spec) } : null;
        })
        .filter(Boolean);
      const rx = (v) => rightBox.x + ((Math.max(550, Math.min(1010, v)) - 550) / 460) * rightBox.w;
      const ry = (v) => rightBox.y + rightBox.h - ((Math.max(550, Math.min(1010, v)) - 550) / 460) * rightBox.h;
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = pal.muted;
      ctx.beginPath(); ctx.moveTo(rx(550), ry(550)); ctx.lineTo(rx(1000), ry(1000)); ctx.stroke();
      ctx.restore();
      cdPts.forEach((p) => {
        const col = p.pass ? pal.ok : pal.brand;
        ctx.beginPath(); ctx.arc(rx(p.x), ry(p.y), 4.6, 0, Math.PI * 2);
        if (p.measured) { ctx.fillStyle = col; ctx.fill(); }
        else { ctx.strokeStyle = col; ctx.lineWidth = 1.9; ctx.stroke(); }
      });
      ctx.fillStyle = pal.muted;
      ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
      ctx.fillText("110 nm Tight Via PH vs. 225 nm Wide Feature PH (nm)", rightBox.x, h - 8);
    }

    const badge = qs("#paritySummaryBadge");
    if (badge) {
      const nMeas = exps.filter((e) => e.provenance === "measured").length;
      const nSyn = exps.length - nMeas;
      badge.textContent = `${nMeas} Measured (solid) · ${nSyn} Synthetic (hollow) · ${boPts.length} BO`;
    }
  }

  // ------------------------------------------------------------------
  // Active Optimizer Recommendations, Run-Sheet Export & Closed-Loop Batch
  // ------------------------------------------------------------------
  const ROLE_LABELS = {
    exploit_leader: "Exploit Spec Leader",
    dep_trim_low_ob: "2-Step Dep→Trim Low-OB",
    uncertainty_probe: "Epistemic Uncertainty Probe",
    passivation_boundary: "Passivation Window Explorer",
  };

  function renderOptimizationSuggestions(suggestions, goal) {
    lastOptimizationSuggestions = suggestions || [];
    drawWaferFrontierAndQualityChart();
    const box = qs("#recContainer");
    const runSheet = qs("#doeRunSheetBody");
    box.innerHTML = "";
    if (runSheet) runSheet.innerHTML = "";

    lastOptimizationSuggestions.forEach((s) => {
      const r = s.prediction.recipe;
      const p = s.prediction.pang_posterior;
      const u = s.prediction.uncertainty;
      const ps = s.prediction.plasma;
      const ms = s.multi_step_recipe || {};
      const roleLabel = ROLE_LABELS[s.exploration_role] || s.exploration_role || "Active Candidate";
      const archLabel = ms.architecture || (r.trim_fraction > 0.01 ? "two_step_dep_trim" : "single_step_dep");
      const trimBadge = r.trim_fraction > 0.01 ? ` · Trim ${Math.round(r.trim_fraction * 100)}%` : "";
      const fillMetricHtml =
        goal === "partial_fill"
          ? `Pred <b>h* = ${esc(p.fill_height_110_nm)}±${esc(u.fill_height_110_std)} nm</b> · Wall <b>${esc(p.upper_wall_nm)} nm</b>`
          : `Pred <b>PH₁₁₀ = ${esc(p.ph_depth_110_nm)}±${esc(u.ph_depth_110_std)} nm</b> · PH₂₂₅ = ${esc(p.ph_depth_225_nm)} nm`;

      const stepsSummary = (ms.steps || [])
        .map(
          (st) =>
            `S${st.step_index} ${st.step_type}(${st.duration_s}s @ ${st.freq_mhz}MHz, P=${st.pressure_torr}T, C₂H₂=${st.c2h2_sccm}, NH₃=${st.nh3_sccm})`
        )
        .join(" → ");

      const card = document.createElement("div");
      card.className = "rec-card";
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem; margin-bottom:0.3rem;">
          <div>
            <span class="badge mono" style="margin-bottom:0.2rem;">${esc(s.suggestion_id || `#${s.rank}`)} · ${esc(roleLabel)}</span>
            <div><strong>#${esc(s.rank)} · ${esc(r.freq_mhz)} MHz · ${esc(r.power_w)}W · ${esc(r.gap_mils)} mils · ${esc(r.pressure_torr)} Torr${esc(trimBadge)}</strong></div>
          </div>
          <span class="badge badge-ok mono">P(spec) ${(s.feasibility_prob * 100).toFixed(0)}% · Acq ${esc(s.acq_score)}</span>
        </div>
        <div class="mono" style="font-size:0.76rem; margin-bottom:0.3rem;">
          Ar ${(r.ar_sccm / 1000).toFixed(1)}slm · C₂H₂ ${esc(r.c2h2_sccm)} · NH₃ ${esc(r.nh3_sccm)} (N/C=${r.nc_ratio.toFixed(2)}) · T=${esc(r.temp_c)}°C · Dep=${esc(r.dep_time_s)}s
        </div>
        ${stepsSummary ? `<div class="mono" style="font-size:0.76rem; color:var(--brand); margin-bottom:0.35rem;">${esc(stepsSummary)}${ms.cycle_count > 1 ? ` × ${esc(ms.cycle_count)} cycles` : ""}</div>` : ""}
        <div style="font-size:0.79rem; margin-bottom:0.35rem;">
          ${fillMetricHtml} · <b>OB = ${esc(p.ob_nm)}±${esc(u.ob_std)} nm</b> (Step ${esc(p.dual_cd_step_nm)}nm) · Crack ${(p.crack_prob * 100).toFixed(0)}%
        </div>
        <div class="mono" style="font-size:0.76rem; color:var(--muted); margin-bottom:0.35rem;">
          Pred OES CN/Ar=${esc(ps.oes_cn_ar)} · 3ω=${esc(ps.rf_3w_1w_pct)}% · Dust η=${esc(ps.dust_margin)}x · ρ=${esc(ps.film_density_g_cm3)} g/cm³
        </div>
        <div style="font-size:0.76rem; color:var(--muted); margin-bottom:0.5rem;">${esc(s.rationale)}</div>
        <button type="button" class="btn btn-primary" style="font-size:0.77rem;">Run Single Virtual Wafer (${esc(s.suggestion_id || `#${s.rank}`)}) → Update Brain</button>
      `;
      const runSingleBtn = card.querySelector("button");
      runSingleBtn.addEventListener("click", async () => {
        await withBusyButton(runSingleBtn, async () => {
          try {
            const res = await fetchJsonChecked(
              "/api/ingest/virtual_wafer",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  suggestion_id: s.suggestion_id,
                  recipe: r,
                  mode: goal,
                  notes: `Active BO ${s.suggestion_id || `Rank #${s.rank}`} (${goal})`,
                }),
              },
              "Failed to run virtual wafer"
            );
            if (res.workspace === "sandbox") {
              activeWorkspace = "sandbox";
              syncWorkspaceChrome();
            }
            const m = res.experiment.measured;
            const depthStr = goal === "partial_fill" ? `h*=${m.fill_height_110_nm} nm` : `PH=${m.ph_depth_110_nm} nm`;
            showToast(
              `[SANDBOX] Executed ${res.experiment.exp_id} [synthetic]: ${depthStr}, OB=${m.ob_nm} nm -> Sandbox Brain v${res.brain_snapshot.brain_version} (Live untouched)!`
            );
            lastSemResult = res.sem_analysis;
            renderSemResult(lastSemResult);
            await refreshAll();
          } catch (err) {
            showToast(err.message);
          }
        });
      });
      box.appendChild(card);

      if (runSheet) {
        const tr = document.createElement("tr");
        const predFillCell =
          goal === "partial_fill"
            ? `h* ${esc(p.fill_height_110_nm)} ± ${esc(u.fill_height_110_std)} nm`
            : `PH ${esc(p.ph_depth_110_nm)} ± ${esc(u.ph_depth_110_std)} nm`;
        tr.innerHTML = `
          <th scope="row" class="mono">${esc(s.suggestion_id || `R${s.rank}`)}</th>
          <td><span class="badge">${esc(roleLabel)}</span></td>
          <td class="mono">${esc(archLabel)}${ms.cycle_count > 1 ? ` (×${esc(ms.cycle_count)})` : ""}</td>
          <td class="mono">${esc(r.freq_mhz)}M / ${esc(r.power_w)}W / ${esc(r.gap_mils)}mil</td>
          <td class="mono">${esc(r.pressure_torr)}T · ${(r.ar_sccm / 1000).toFixed(1)}k / ${esc(r.c2h2_sccm)} / ${esc(r.nh3_sccm)}</td>
          <td class="mono">${esc(r.temp_c)}°C · ${esc(r.dep_time_s)}s · Trim ${Math.round((r.trim_fraction || 0) * 100)}%</td>
          <td class="mono"><b>${predFillCell}</b></td>
          <td class="mono">${esc(p.ob_nm)} ± ${esc(u.ob_std)} nm</td>
          <td class="mono"><b style="color:${s.feasibility_prob >= 0.7 ? "var(--ok)" : "var(--warn)"}">${(s.feasibility_prob * 100).toFixed(0)}%</b></td>
        `;
        runSheet.appendChild(tr);
      }
    });
  }

  async function loadRecommendations(logRound = false) {
    const goal = qs("#optGoal").value;
    const freq_filter = qs("#optFreq").value;
    const batch_size = parseInt(qs("#optBatch").value, 10) || 4;
    const allow_two_step = qs("#optAllowTrim") ? qs("#optAllowTrim").checked : true;
    try {
      const data = await fetchJsonChecked(
        `/api/optimize?workspace=${encodeURIComponent(activeWorkspace)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal,
            batch_size,
            freq_filter,
            allow_two_step,
            log_predictions: Boolean(logRound),
            workspace: activeWorkspace,
          }),
        },
        "Optimization failed"
      );
      renderOptimizationSuggestions(data.suggestions || [], goal);
      const audit = await fetchJsonChecked(
        `/api/prediction_log?workspace=${encodeURIComponent(activeWorkspace)}`,
        {},
        "Failed to load prediction log"
      );
      renderPredictionAudit(audit);
    } catch (err) {
      showToast(err.message);
    }
  }

  function downloadBlob(filename, mimeType, textContent) {
    const blob = new Blob([textContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function commitCurrentRoundPlan() {
    if (!lastOptimizationSuggestions.length) return null;
    const goal = qs("#optGoal").value;
    try {
      const res = await fetchJsonChecked(
        `/api/prediction_log/plan_round?workspace=${encodeURIComponent(activeWorkspace)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal,
            workspace: activeWorkspace,
            suggestions: lastOptimizationSuggestions,
          }),
        },
        "Failed to log planned round"
      );
      if (res.prediction_audit) {
        if (brainData) brainData.prediction_audit = res.prediction_audit;
        renderPredictionAudit(res.prediction_audit);
      }
      return res;
    } catch (err) {
      showToast(err.message);
      return null;
    }
  }

  if (qs("#btnPlanThisRound")) {
    qs("#btnPlanThisRound").addEventListener("click", async (ev) => {
      if (!lastOptimizationSuggestions.length) return;
      await withBusyButton(ev.currentTarget, async () => {
        const res = await commitCurrentRoundPlan();
        if (res) {
          showToast(`Planned round: logged ${res.logged_count} new UUID suggestion(s) in ${res.workspace} prediction_log.`);
        }
      });
    });
  }

  if (qs("#btnExportNextJson")) {
    qs("#btnExportNextJson").addEventListener("click", async (ev) => {
      if (!lastOptimizationSuggestions.length) return;
      await withBusyButton(ev.currentTarget, async () => {
        const logged = IS_STATIC_DEMO ? true : await commitCurrentRoundPlan();
        if (!logged) return;
        const payload = {
          schema_id: "pang.pecvd.carbon.v2.next_experiment_plan",
          brain_version: brainData ? brainData.brain_version : 0,
          goal: qs("#optGoal").value,
          client_spec: brainData ? brainData.client_spec : {},
          suggestions: lastOptimizationSuggestions,
        };
        downloadBlob(
          `next_experiments_v${payload.brain_version}_${payload.goal}.json`,
          "application/json",
          JSON.stringify(payload, null, 2)
        );
        showToast("Exported Next-Experiment DoE Batch JSON (`pang.pecvd.carbon.v2`).");
      });
    });
  }

  if (qs("#btnExportNextCsv")) {
    qs("#btnExportNextCsv").addEventListener("click", async (ev) => {
      if (!lastOptimizationSuggestions.length) return;
      await withBusyButton(ev.currentTarget, async () => {
        const logged = IS_STATIC_DEMO ? true : await commitCurrentRoundPlan();
        if (!logged) return;
        const goal = qs("#optGoal").value;
        const headers = [
          "suggestion_id", "rank", "exploration_role", "goal", "architecture", "freq_mhz", "power_w",
          "gap_mils", "pressure_torr", "ar_sccm", "c2h2_sccm", "nh3_sccm", "nc_ratio", "temp_c",
          "dep_time_s", "trim_fraction", "pred_ph_depth_110_nm", "pred_fill_height_110_nm",
          "pred_ob_nm", "pred_crack_prob", "p_meets_spec",
        ];
        const rows = lastOptimizationSuggestions.map((s) => {
          const r = s.prediction.recipe;
          const p = s.prediction.pang_posterior;
          const ms = s.multi_step_recipe || {};
          return [
            s.suggestion_id, s.rank, s.exploration_role, goal, ms.architecture || "single_step_dep",
            r.freq_mhz, r.power_w, r.gap_mils, r.pressure_torr, r.ar_sccm, r.c2h2_sccm, r.nh3_sccm,
            r.nc_ratio, r.temp_c, r.dep_time_s, r.trim_fraction, p.ph_depth_110_nm, p.fill_height_110_nm,
            p.ob_nm, p.crack_prob, s.feasibility_prob,
          ].join(",");
        });
        downloadBlob(
          `next_experiments_v${brainData ? brainData.brain_version : 0}_${goal}.csv`,
          "text/csv",
          [headers.join(","), ...rows].join("\n")
        );
        showToast("Exported cleanroom Chamber DoE Run-Sheet CSV.");
      });
    });
  }

  if (qs("#btnExecuteBatchVirtual")) {
    qs("#btnExecuteBatchVirtual").addEventListener("click", async (ev) => {
      if (!lastOptimizationSuggestions.length) return;
      await withBusyButton(ev.currentTarget, async () => {
        const roundIdx = virtualRoundCounter;
        try {
          const goal = qs("#optGoal").value;
          const batchSize = parseInt(qs("#optBatch").value, 10) || 4;
          const payload = {
            goal,
            round_index: roundIdx,
            next_batch_size: batchSize,
            items: lastOptimizationSuggestions.map((s) => ({
              suggestion_id: s.suggestion_id,
              recipe: s.prediction.recipe,
            })),
          };
          const report = await fetchJsonChecked(
            "/api/campaigns/execute_virtual_batch",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            },
            "Virtual batch execution failed"
          );
          virtualRoundCounter = roundIdx + 1;
          await applyIngestedCampaignReport(report);
          showToast(
            `Executed Round ${payload.round_index} (${report.ingested_counts.wafers} virtual wafers): ${report.ingested_counts.spec_passes}/${report.ingested_counts.wafers} PASSED Client Spec! Graded predictions & computed Round ${virtualRoundCounter}.`
          );
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  qs("#btnRefreshOpt").addEventListener("click", (ev) =>
    withBusyButton(ev.currentTarget, () => loadRecommendations(false))
  );
  qs("#optGoal").addEventListener("change", () => loadRecommendations(false));
  qs("#optFreq").addEventListener("change", () => loadRecommendations(false));
  qs("#optBatch").addEventListener("change", () => loadRecommendations(false));
  if (qs("#optAllowTrim")) qs("#optAllowTrim").addEventListener("change", () => loadRecommendations(false));

  function syncRecipeFromPickedSuggestion(sid, prefix) {
    if (!sid || !brainData || !brainData.prediction_audit) return;
    const ent = (brainData.prediction_audit.entries || []).find((e) => e.suggestion_id === sid);
    if (!ent || !ent.recipe) return;
    const r = ent.recipe;
    if (prefix === "sem") {
      if (qs("#semIngestFreq") && r.freq_mhz) qs("#semIngestFreq").value = String(r.freq_mhz);
      if (qs("#semIngestPower") && r.power_w != null) qs("#semIngestPower").value = String(r.power_w);
      if (qs("#semIngestGap") && r.gap_mils != null) qs("#semIngestGap").value = String(r.gap_mils);
      if (qs("#semIngestP") && r.pressure_torr != null) qs("#semIngestP").value = String(r.pressure_torr);
      if (qs("#semIngestAr") && r.ar_sccm != null) qs("#semIngestAr").value = String(r.ar_sccm);
      if (qs("#semIngestC2H2") && r.c2h2_sccm != null) qs("#semIngestC2H2").value = String(r.c2h2_sccm);
      if (qs("#semIngestNH3") && r.nh3_sccm != null) qs("#semIngestNH3").value = String(r.nh3_sccm);
      if (qs("#semIngestTemp") && r.temp_c != null) qs("#semIngestTemp").value = String(r.temp_c);
    } else if (prefix === "manual") {
      if (qs("#manualFreq") && r.freq_mhz) qs("#manualFreq").value = String(r.freq_mhz);
      if (qs("#manualPower") && r.power_w != null) qs("#manualPower").value = String(r.power_w);
      if (qs("#manualGap") && r.gap_mils != null) qs("#manualGap").value = String(r.gap_mils);
      if (qs("#manualPres") && r.pressure_torr != null) qs("#manualPres").value = String(r.pressure_torr);
      if (qs("#manualAr") && r.ar_sccm != null) qs("#manualAr").value = String(r.ar_sccm);
      if (qs("#manualC2H2") && r.c2h2_sccm != null) qs("#manualC2H2").value = String(r.c2h2_sccm);
      if (qs("#manualNH3") && r.nh3_sccm != null) qs("#manualNH3").value = String(r.nh3_sccm);
      if (qs("#manualTemp") && r.temp_c != null) qs("#manualTemp").value = String(r.temp_c);
    }
  }

  if (qs("#semIngestSuggestionId")) {
    qs("#semIngestSuggestionId").addEventListener("change", (e) => syncRecipeFromPickedSuggestion(e.target.value, "sem"));
  }
  if (qs("#manualSuggestionId")) {
    qs("#manualSuggestionId").addEventListener("change", (e) => syncRecipeFromPickedSuggestion(e.target.value, "manual"));
  }
  if (qs("#manualWaferForm")) {
    qs("#manualWaferForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      if (!form.checkValidity()) {
        const firstInvalid = form.querySelector(":invalid");
        if (firstInvalid) firstInvalid.focus();
        return;
      }
      await withBusyButton(qs("#btnSubmitManualWafer"), async () => {
        try {
          const ph225Raw = qs("#manualPh225").value.trim();
          const afmRmsRaw = qs("#manualAfmRms") ? qs("#manualAfmRms").value.trim() : "";
          const crackRaw = qs("#manualCrack").value;
          const sid = qs("#manualSuggestionId").value || null;
          const payload = {
            exp_id: qs("#manualExpId").value.trim(),
            suggestion_id: sid,
            recipe: {
              freq_mhz: parseFloat(qs("#manualFreq").value),
              power_w: parseFloat(qs("#manualPower").value),
              gap_mils: parseFloat(qs("#manualGap").value),
              pressure_torr: parseFloat(qs("#manualPres").value),
              ar_sccm: parseFloat(qs("#manualAr").value),
              c2h2_sccm: parseFloat(qs("#manualC2H2").value),
              nh3_sccm: parseFloat(qs("#manualNH3").value),
              temp_c: parseFloat(qs("#manualTemp").value),
            },
            ob_nm: parseFloat(qs("#manualOb").value),
            ph_depth_110_nm: parseFloat(qs("#manualPh110").value),
            ph_depth_225_nm: ph225Raw ? parseFloat(ph225Raw) : null,
            afm_rms_nm: afmRmsRaw ? parseFloat(afmRmsRaw) : null,
            crack_detected: crackRaw === "" ? null : crackRaw === "true",
            provenance: "measured",
          };
          const res = await fetchJsonChecked(
            "/api/ingest/experiment",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            },
            "Could not ingest measured wafer"
          );
          showToast(`Ingested measured wafer "${payload.exp_id}" -> Brain v${res.brain_snapshot.brain_version}!`);
          await refreshAll();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  // ------------------------------------------------------------------
  // Tab 2: SEM Vision Lab (`P0.3`: no auto-select, editable CV prefill, owner provenance)
  // ------------------------------------------------------------------
  function populateSemDropdown() {
    const sel = qs("#semSampleSelect");
    if (!sel) return;
    const prev = sel.value;
    const metaByFile = (brainData && brainData.sem_sample_metadata) || {};
    const ownerProvByFile = {};
    (brainData.experiments || []).forEach((e) => {
      const fn = (e.sem_image_path || "").split("/").pop();
      if (fn) ownerProvByFile[fn] = e.provenance;
      if (e.provenance === "measured") {
        ownerProvByFile[`${e.exp_id}_HR1.png`] = "measured";
        ownerProvByFile[`${e.exp_id}_HR2.png`] = "measured";
      }
    });
    sel.innerHTML = '<option value="">— Select a coupon SEM sample —</option>';
    (brainData.available_sem_samples || []).forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      const prov = (metaByFile[name] && metaByFile[name].provenance) || ownerProvByFile[name];
      const provTag = prov ? ` [${prov}]` : "";
      opt.textContent = `${name}${provTag}`;
      sel.appendChild(opt);
    });
    if (prev && (brainData.available_sem_samples || []).includes(prev)) {
      sel.value = prev;
    }
  }

  function renderSemResult(sem) {
    lastSemResult = sem;
    qs("#semOverlayImg").src = sem.annotated_png_b64;
    const badge = qs("#semRegimeBadge");
    badge.textContent = sem.fill_regime;
    badge.className = "badge mono " + (sem.fill_regime === "void_free_plug" ? "badge-ok" : "badge-warn");

    qs("#semMetricsBox").innerHTML = `
      <div class="card"><div class="kpi-label">CV Est. Overburden (OB)</div><div class="kpi-value">${esc(sem.ob_mean_nm)} nm</div><div class="kpi-note">Range: ${esc(sem.ob_min_nm)}–${esc(sem.ob_max_nm)} nm</div></div>
      <div class="card"><div class="kpi-label">CV Est. PH / Fill Depth</div><div class="kpi-value">${esc(sem.ph_depth_nm)} nm</div><div class="kpi-note">±${esc(sem.ph_depth_std_nm)} nm across ${esc(sem.detected_holes)} holes</div></div>
      <div class="card"><div class="kpi-label">CV Est. Keyhole Void Width</div><div class="kpi-value">${esc(sem.void_width_nm)} nm</div><div class="kpi-note">Void len: ${esc(sem.void_length_nm)} nm (${(sem.void_fraction * 100).toFixed(1)}%)</div></div>
      <div class="card"><div class="kpi-label">CV Est. Defect Flags</div><div class="kpi-value">${sem.crack_detected ? "CRACK" : "Intact"}</div><div class="kpi-note">Nodule: ${sem.nodule_detected ? "+" + esc(sem.nodule_height_nm) + "nm" : "None"} (Conf ${(sem.confidence * 100).toFixed(0)}%)</div></div>
    `;
    qs("#semNotesList").innerHTML = (sem.notes || []).map((n) => `<li>${esc(n)}</li>`).join("");

    // Prefill editable metrology inputs from CV result so the engineer can verify/correct before saving (`P0.3`)
    if (qs("#semIngestOb")) qs("#semIngestOb").value = String(sem.ob_mean_nm ?? "");
    if (qs("#semIngestDepth")) qs("#semIngestDepth").value = String(sem.ph_depth_nm ?? "");
    if (qs("#semIngestVoid")) qs("#semIngestVoid").value = sem.void_width_nm != null ? String(sem.void_width_nm) : "";
    if (qs("#semIngestMode")) {
      qs("#semIngestMode").value = sem.fill_regime === "partial_recess" ? "partial_fill" : "plug_fill";
    }
    if (qs("#semIngestCrack")) qs("#semIngestCrack").value = sem.crack_detected ? "true" : "false";
    if (qs("#semIngestNodule")) qs("#semIngestNodule").value = sem.nodule_detected ? "true" : "false";

    const provSel = qs("#semIngestProv");
    if (provSel) {
      const forced = sem.forced_provenance || sem.provenance || (sem.app_generated ? "synthetic" : null);
      if (forced) {
        provSel.value = forced;
        provSel.disabled = Boolean(sem.app_generated || sem.provenance);
      } else {
        provSel.disabled = false;
      }
    }
  }

  async function analyzeSelectedSample() {
    const name = qs("#semSampleSelect").value;
    if (!name) return;
    try {
      const sem = await fetchJsonChecked(
        `/api/sem/sample/${encodeURIComponent(name)}?workspace=${encodeURIComponent(activeWorkspace)}`,
        {},
        "Failed to analyze SEM sample"
      );
      renderSemResult(sem);
    } catch (err) {
      showToast(err.message);
    }
  }

  qs("#btnAnalyzeSample").addEventListener("click", (ev) =>
    withBusyButton(ev.currentTarget, () => analyzeSelectedSample())
  );

  qs("#semUploadInput").addEventListener("change", async (ev) => {
    const inputEl = ev.currentTarget;
    const file = inputEl.files[0];
    if (!file || inputEl.disabled) return;
    inputEl.disabled = true;
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("known_hole_depth_nm", "1000");
      const sem = await fetchJsonChecked("/api/sem/upload", { method: "POST", body: fd }, "Invalid SEM image upload");
      if (qs("#semSampleSelect")) qs("#semSampleSelect").value = "";
      renderSemResult(sem);
      showToast(`Analyzed uploaded SEM "${sem.image_name}": verify editable OB/PH fields before ingesting.`);
    } catch (err) {
      showToast(err.message);
    } finally {
      inputEl.value = "";
      inputEl.disabled = false;
    }
  });

  qs("#btnIngestSemToBrain").addEventListener("click", async (ev) => {
    if (!lastSemResult) {
      showToast("Analyze or upload a cross-section SEM image first.");
      return;
    }
    const obVal = parseFloat(qs("#semIngestOb") ? qs("#semIngestOb").value : "");
    const depthVal = parseFloat(qs("#semIngestDepth") ? qs("#semIngestDepth").value : "");
    if (!Number.isFinite(obVal) || !Number.isFinite(depthVal)) {
      showToast("Enter verified OB Mean and PH Depth / Fill Height before ingesting.");
      return;
    }
    await withBusyButton(ev.currentTarget, async () => {
      const voidRaw = qs("#semIngestVoid") ? qs("#semIngestVoid").value.trim() : "";
      const ph225Raw = qs("#semIngestPh225").value.trim();
      const afmRmsRaw = qs("#semIngestAfmRms") ? qs("#semIngestAfmRms").value.trim() : "";
      const taperRaw = qs("#semIngestTaperDeg") ? qs("#semIngestTaperDeg").value.trim() : "";
      const fillMode = (qs("#semIngestMode") && qs("#semIngestMode").value) || "plug_fill";
      const crackRaw = qs("#semIngestCrack") ? qs("#semIngestCrack").value : "false";
      const nodRaw = qs("#semIngestNodule") ? qs("#semIngestNodule").value : "false";
      const selectedSampleName = (qs("#semSampleSelect") && qs("#semSampleSelect").value) || null;

      const recipe = {
        freq_mhz: parseFloat(qs("#semIngestFreq").value),
        power_w: parseFloat(qs("#semIngestPower").value) || 1550,
        gap_mils: parseFloat(qs("#semIngestGap").value) || 450,
        pressure_torr: parseFloat(qs("#semIngestP").value) || 18.5,
        ar_sccm: parseFloat(qs("#semIngestAr").value) || 11000,
        c2h2_sccm: parseFloat(qs("#semIngestC2H2").value) || 620,
        nh3_sccm: parseFloat(qs("#semIngestNH3").value) || 225,
        temp_c: parseFloat(qs("#semIngestTemp").value) || 555,
      };
      const prov = lastSemResult.app_generated
        ? "synthetic"
        : (qs("#semIngestProv").value || "measured");

      const payload = {
        exp_id: qs("#semIngestId").value.trim() || `SEM-${Date.now() % 1000}`,
        suggestion_id: (qs("#semIngestSuggestionId") && qs("#semIngestSuggestionId").value) || null,
        sem_image_name: selectedSampleName,
        app_generated_sem: Boolean(lastSemResult.app_generated),
        recipe,
        ob_nm: obVal,
        ...(fillMode === "partial_fill"
          ? { fill_height_110_nm: depthVal }
          : { ph_depth_110_nm: depthVal }),
        ph_depth_225_nm: ph225Raw ? parseFloat(ph225Raw) : null,
        void_width_110_nm: voidRaw ? parseFloat(voidRaw) : null,
        afm_rms_nm: afmRmsRaw ? parseFloat(afmRmsRaw) : null,
        sidewall_taper_deg: taperRaw ? parseFloat(taperRaw) : null,
        crack_detected: crackRaw === "" ? null : crackRaw === "true",
        nodule_defect: nodRaw === "" ? null : nodRaw === "true",
        provenance: prov,
        notes: `Verified SEM metrology (${lastSemResult.image_name})`,
      };
      try {
        const res = await fetchJsonChecked(
          "/api/ingest/experiment",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
          "SEM ingestion failed"
        );
        if (res.workspace === "sandbox") {
          activeWorkspace = "sandbox";
          syncWorkspaceChrome();
        }
        showToast(`Ingested SEM "${payload.exp_id}" [${payload.provenance}] -> Brain updated to v${res.brain_snapshot.brain_version}!`);
        await refreshAll();
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  // ------------------------------------------------------------------
  // Tab 3: Recipe Sandbox & Discrepancy Explorer
  // ------------------------------------------------------------------
  function readSandboxRecipe() {
    const freq = parseInt(qs("#slFreq").value, 10) === 1 ? 27.12 : 13.56;
    const power = parseFloat(qs("#slPower").value);
    const gap = parseFloat(qs("#slGap").value);
    const pres = parseFloat(qs("#slPres").value);
    const ar = parseFloat(qs("#slAr").value);
    const c2h2 = parseFloat(qs("#slC2H2").value);
    const nh3 = parseFloat(qs("#slNH3").value);
    const temp = parseFloat(qs("#slTemp").value);
    const trim = parseFloat(qs("#slTrim").value) || 0;

    qs("#slFreq").setAttribute("aria-valuetext", `${freq} MHz`);
    qs("#lblFreq").textContent = `${freq} MHz`;
    qs("#lblPower").textContent = `${power} W`;
    qs("#lblGap").textContent = `${gap} mils`;
    qs("#lblPres").textContent = `${pres.toFixed(1)} T`;
    qs("#lblAr").textContent = `${ar}`;
    qs("#lblC2H2").textContent = `${c2h2}`;
    qs("#lblNH3").textContent = `${nh3} (N/C ${(nh3 / c2h2).toFixed(2)})`;
    qs("#lblTemp").textContent = `${temp} °C`;
    qs("#lblTrim").textContent = `${Math.round(trim * 100)}%`;

    return {
      freq_mhz: freq, power_w: power, gap_mils: gap, pressure_torr: pres,
      ar_sccm: ar, c2h2_sccm: c2h2, nh3_sccm: nh3, temp_c: temp,
      trim_fraction: trim,
    };
  }

  let sandboxAbortCtrl = null;
  async function updateSandboxPrediction() {
    const rcp = readSandboxRecipe();
    if (sandboxAbortCtrl) sandboxAbortCtrl.abort();
    sandboxAbortCtrl = new AbortController();
    try {
      const pred = await fetchJsonChecked(
        `/api/predict?workspace=${encodeURIComponent(activeWorkspace)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rcp),
          signal: sandboxAbortCtrl.signal,
        },
        "Prediction failed"
      );
      lastSandboxPred = pred;

      const u = pred.uncalibrated_sim;
      const c = pred.calibrated_physics;
      const p = pred.pang_posterior;
      const s = pred.uncertainty;
      const ps = pred.plasma;

      qs("#simCompareGrid").innerHTML = `
        <div class="card"><div class="kpi-label">1. Standalone Uncal Sim</div><div class="kpi-value">PH ${esc(u.ph_depth_110_nm)} nm</div><div class="kpi-note">OB: ${esc(u.ob_nm)} nm · Crack ${(u.crack_prob * 100).toFixed(0)}%</div></div>
        <div class="card"><div class="kpi-label">2. KB-Calibrated Physics (θ̂)</div><div class="kpi-value">PH ${esc(c.ph_depth_110_nm)} nm</div><div class="kpi-note">OB: ${esc(c.ob_nm)} nm · β_eff ${esc(ps.beta_eff)}</div></div>
        <div class="card"><div class="kpi-label">3. PANG Brain Posterior</div><div class="kpi-value" style="color:var(--brand)">PH ${esc(p.ph_depth_110_nm)}±${esc(s.ph_depth_110_std)}</div><div class="kpi-note">OB: ${esc(p.ob_nm)}±${esc(s.ob_std)} nm · AFM Rq ${esc(p.afm_rms_nm ?? ps.afm_rms_nm ?? 1.45)} nm</div></div>
      `;
      qs("#simSensorReadout").innerHTML = `
        <span><b>Predicted Virtual Metrology:</b> CN/Ar=${esc(ps.oes_cn_ar)} · C₂/CH=${esc(ps.oes_c2_ch)} · Hα/C₂=${esc(ps.oes_ha_c2)} · |V_dc|=${esc(ps.vdc_volts)}V · 3ω/1ω=${esc(ps.rf_3w_1w_pct)}%</span>
        <span>ρ=${esc(ps.film_density_g_cm3)} g/cm³ · |σ|=${esc(ps.stress_mpa)} MPa · AFM Rq=${esc(ps.afm_rms_nm ?? 1.45)} nm</span>
      `;
      const tr = pred.human_priors.triggered_rules;
      qs("#simActiveRules").textContent = tr.length
        ? `Active Priors: ${tr.join(" | ")} (Acq weight x${pred.human_priors.acq_multiplier})`
        : "No hazard guards triggered in this operating window.";

      drawProfilePreview(pred);
      drawTab1CausalGraph();
    } catch (err) {
      if (err.name !== "AbortError") console.error(err);
    }
  }

  const debouncedSandboxPredict = debounce(updateSandboxPrediction, 55);
  ["#slFreq", "#slPower", "#slGap", "#slPres", "#slAr", "#slC2H2", "#slNH3", "#slTemp", "#slTrim"].forEach((id) => {
    qs(id).addEventListener("input", () => {
      readSandboxRecipe();
      debouncedSandboxPredict();
    });
  });

  function drawProfilePreview(pred) {
    const setup = setupHiDpiCanvas(qs("#profilePreviewCanvas"));
    if (!setup || !pred) return;
    const { ctx, w, h } = setup;

    const pal = themePalette();
    const p = pred.pang_posterior;
    const ps = pred.plasma || {};
    const topY = 64, botY = h - 34;
    const depthPx = botY - topY;
    const scaleY = depthPx / 1000;
    const obPx110 = Math.min(48, p.ob_nm * scaleY * 1.15);
    const obPx225 = Math.max(4, Math.min(46, Math.max(0, p.ob_nm - (p.dual_cd_step_nm || 0)) * scaleY * 1.15));
    const afmAmp = Math.min(2.8, Math.max(0.4, (p.afm_rms_nm ?? ps.afm_rms_nm ?? 1.4) * 0.55));

    ctx.fillStyle = pal.surfaceAlt;
    ctx.strokeStyle = pal.border;
    ctx.fillRect(18, topY, w - 36, depthPx + 12);
    ctx.strokeRect(18, topY, w - 36, depthPx + 12);

    const drawTaperedHole = (cx, wPx, cdNm, phNm, voidW, label) => {
      const halfTop = (wPx / 2) * 1.07;
      const halfMid = wPx / 2;
      const halfBot = (wPx / 2) * 0.86;
      const traceMold = () => {
        ctx.beginPath();
        ctx.moveTo(cx - halfTop, topY);
        ctx.quadraticCurveTo(cx - halfMid, topY + depthPx * 0.16, cx - halfBot, botY - 4);
        ctx.quadraticCurveTo(cx, botY + 2.2, cx + halfBot, botY - 4);
        ctx.quadraticCurveTo(cx + halfMid, topY + depthPx * 0.16, cx + halfTop, topY);
        ctx.closePath();
      };

      ctx.fillStyle = "#080d18";
      traceMold();
      ctx.fill();

      ctx.fillStyle = pal.brand;
      ctx.globalAlpha = 0.80;
      traceMold();
      ctx.fill();
      ctx.globalAlpha = 1.0;

      if (voidW > 0.5) {
        const yVoidTop = topY + (phNm / 1000) * depthPx;
        const yVoidBot = botY - 4;
        const yBelly = yVoidTop + 0.34 * Math.max(8, yVoidBot - yVoidTop);
        const vwHalf = Math.max(2.8, ((voidW / cdNm) * wPx * 0.88) / 2);
        ctx.beginPath();
        ctx.moveTo(cx, yVoidTop);
        ctx.bezierCurveTo(cx + vwHalf * 0.85, yVoidTop + (yBelly - yVoidTop) * 0.45, cx + vwHalf, yBelly, cx + vwHalf * 0.65, yVoidBot - 3);
        ctx.quadraticCurveTo(cx, yVoidBot + 1.2, cx - vwHalf * 0.65, yVoidBot - 3);
        ctx.bezierCurveTo(cx - vwHalf, yBelly, cx - vwHalf * 0.85, yVoidTop + (yBelly - yVoidTop) * 0.45, cx, yVoidTop);
        ctx.closePath();
        ctx.fillStyle = "#090d16";
        ctx.fill();
        ctx.strokeStyle = pal.err;
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
      ctx.strokeStyle = pal.border;
      traceMold();
      ctx.stroke();

      ctx.fillStyle = pal.text;
      ctx.font = "600 11.2px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${label}: PH=${phNm}nm`, cx, botY + 24);
    };

    const cx110 = w * 0.30;
    const cx225 = w * 0.70;
    drawTaperedHole(cx110, 36, 110, p.ph_depth_110_nm, p.void_width_110_nm, "110nm (~89.25°)");
    drawTaperedHole(cx225, 70, 225, p.ph_depth_225_nm, p.void_width_225_nm, "225nm (~89.25°)");

    // Curved continuous overburden cap with dual-CD step, crown/dimple, and AFM Rq micro-roughness
    ctx.fillStyle = pal.brand;
    ctx.globalAlpha = 0.84;
    ctx.beginPath();
    ctx.moveTo(18, topY);
    const nS = 54;
    for (let s = 0; s <= nS; s++) {
      const u = s / nS;
      const xx = 18 + u * (w - 36);
      const stepBlend = 0.5 * (1 + Math.tanh((u - 0.50) / 0.07));
      const obHere = obPx110 * (1 - stepBlend) + obPx225 * stepBlend;
      const crown110 = (p.void_width_110_nm > 0.5 ? 3.8 : -2.6) * Math.exp(-(((xx - cx110) / 22) ** 2));
      const crown225 = (p.void_width_225_nm > 0.5 ? 3.2 : -2.2) * Math.exp(-(((xx - cx225) / 36) ** 2));
      const rough = afmAmp * Math.sin(s * 1.85);
      ctx.lineTo(xx, topY - obHere + crown110 + crown225 + rough);
    }
    ctx.lineTo(w - 18, topY);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1.0;

    ctx.font = "600 11.2px ui-monospace, monospace";
    ctx.fillStyle = p.ob_nm <= 95 ? pal.ok : pal.warn;
    ctx.textAlign = "left";
    ctx.fillText(`Pred OB: ${p.ob_nm} nm (Δh=${p.dual_cd_step_nm} nm · Rq=${(p.afm_rms_nm ?? ps.afm_rms_nm ?? 1.45)} nm)`, 20, 24);
    ctx.textAlign = "right";
    ctx.fillStyle = p.crack_prob < 0.35 ? pal.ok : pal.err;
    ctx.fillText(`Crack Risk: ${(p.crack_prob * 100).toFixed(0)}%`, w - 20, 24);
  }

  qs("#btnIngestSimRun").addEventListener("click", async (ev) => {
    await withBusyButton(ev.currentTarget, async () => {
      try {
        const rcp = readSandboxRecipe();
        const res = await fetchJsonChecked(
          `/api/ingest/simulation?workspace=${encodeURIComponent(activeWorkspace)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(rcp),
          },
          "Could not log simulation"
        );
        showToast(`Logged simulation ${res.simulation.sim_id} -> Gas-phase MLP & PANG Brain updated to v${res.brain_snapshot.brain_version}!`);
        await refreshAll();
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  qs("#btnRunSandboxWafer").addEventListener("click", async (ev) => {
    await withBusyButton(ev.currentTarget, async () => {
      try {
        const rcp = readSandboxRecipe();
        const res = await fetchJsonChecked(
          "/api/ingest/virtual_wafer",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipe: rcp, mode: "plug_fill", notes: "Sandbox custom recipe wafer" }),
          },
          "Virtual wafer execution failed"
        );
        activeWorkspace = "sandbox";
        syncWorkspaceChrome();
        showToast(`[SANDBOX] Virtual Wafer ${res.experiment.exp_id} [synthetic]: PH=${res.experiment.measured.ph_depth_110_nm}nm, OB=${res.experiment.measured.ob_nm}nm -> Sandbox Brain v${res.brain_snapshot.brain_version}`);
        await refreshAll();
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  // ------------------------------------------------------------------
  // Tab 6: Ledger Table, Typed-Confirm Delete (`P0.2`) & Human Rules
  // ------------------------------------------------------------------
  const deleteWaferDialog = qs("#deleteWaferDialog");
  const deleteWaferForm = qs("#deleteWaferForm");

  function openDeleteWaferModal(expId) {
    if (!deleteWaferDialog) return;
    pendingDeleteExpId = expId;
    deleteWaferDialog.returnValue = "";
    if (qs("#deleteWaferTargetCode")) qs("#deleteWaferTargetCode").textContent = expId;
    if (qs("#deleteWaferConfirmInput")) qs("#deleteWaferConfirmInput").value = "";
    deleteWaferDialog.showModal();
  }

  if (deleteWaferDialog) {
    deleteWaferDialog.addEventListener("close", () => {
      deleteWaferDialog.returnValue = "";
      pendingDeleteExpId = null;
    });
  }

  if (deleteWaferForm && deleteWaferDialog) {
    deleteWaferForm.addEventListener("submit", async (e) => {
      const submitter = e.submitter;
      if (!submitter || submitter.value !== "delete") {
        pendingDeleteExpId = null;
        return;
      }
      e.preventDefault();
      const typed = (qs("#deleteWaferConfirmInput") && qs("#deleteWaferConfirmInput").value.trim()) || "";
      if (!pendingDeleteExpId || typed !== pendingDeleteExpId) {
        showToast(`Confirmation mismatch: type exact ID "${pendingDeleteExpId}" to delete.`);
        return;
      }
      await withBusyButton(submitter, async () => {
        const targetId = pendingDeleteExpId;
        try {
          const body = await fetchJsonChecked(
            `/api/experiments/${encodeURIComponent(targetId)}?confirm=${encodeURIComponent(typed)}&workspace=${encodeURIComponent(activeWorkspace)}`,
            { method: "DELETE" },
            "Delete failed"
          );
          pendingDeleteExpId = null;
          deleteWaferDialog.close();
          showToast(`Deleted wafer "${targetId}" [${activeWorkspace}] (backed up to ${body.backup_file || "backups/"}).`);
          await refreshAll();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  function renderLedger() {
    const tbody = qs("#waferTableBody");
    tbody.innerHTML = "";
    [...brainData.experiments].reverse().forEach((e) => {
      const r = e.recipe;
      const m = e.measured;
      const tr = document.createElement("tr");
      const sampleFile = (e.sem_image_path || "").split("/").pop();
      const specLines = (e.spec_check && e.spec_check.lines) || {};
      const depthCell = m.ph_depth_110_nm != null
        ? `<b style="color:${specLines.ph_110 === "pass" ? "var(--ok)" : "var(--text)"}">${esc(m.ph_depth_110_nm)} nm</b>`
        : `<b style="color:${specLines.fill_height === "pass" ? "var(--ok)" : "var(--text)"}">fill ${esc(m.fill_height_110_nm)} nm</b>`;
      const provenanceBadge = e.provenance === "synthetic"
        ? ' <span class="badge badge-warn" title="Generated by virtual_fab_experiment, not a real chamber run">synthetic</span>'
        : ' <span class="badge badge-ok" title="Measured physical coupon">measured</span>';
      tr.innerHTML = `
        <th scope="row" class="mono">${esc(e.exp_id)}${provenanceBadge}</th>
        <td class="mono">${esc(r.freq_mhz)}M / ${esc(r.power_w)}W</td>
        <td class="mono">${esc(r.gap_mils)}mil / ${esc(r.pressure_torr)}T</td>
        <td class="mono">${(r.ar_sccm / 1000).toFixed(1)}k / ${esc(r.c2h2_sccm)} / ${esc(r.nh3_sccm)} (${r.nc_ratio.toFixed(2)})</td>
        <td class="mono">${esc(m.ob_nm)} nm</td>
        <td class="mono">${depthCell}</td>
        <td class="mono" style="color:var(--muted)">${esc(e.uncalibrated_sim.ph_depth_110_nm)} nm</td>
        <td>
          ${m.crack_detected === null || m.crack_detected === undefined
            ? '<span class="badge">Crack:null</span>'
            : `<span class="badge ${m.crack_detected ? "badge-err" : "badge-ok"}">${m.crack_detected ? "Crack:Yes" : "Crack:No"}</span>`}
          ${m.nodule_defect ? '<span class="badge badge-warn">Nodule</span>' : ""}
        </td>
        <td style="display:flex; gap:0.35rem; align-items:center;">
          ${sampleFile ? `<button type="button" class="btn" data-act-sem="1" aria-label="Inspect SEM for ${esc(e.exp_id)}" style="padding:0.2rem 0.48rem;font-size:0.76rem;">Inspect SEM <span class="visually-hidden">for ${esc(e.exp_id)}</span></button>` : ""}
          <button type="button" class="btn" data-act-del="${esc(e.exp_id)}" aria-label="Delete wafer ${esc(e.exp_id)}" style="padding:0.2rem 0.48rem;font-size:0.76rem;color:var(--err);">Delete</button>
        </td>
      `;
      const semBtn = tr.querySelector("[data-act-sem]");
      if (semBtn && sampleFile) {
        semBtn.addEventListener("click", async () => {
          await withBusyButton(semBtn, async () => {
            qs("#semSampleSelect").value = sampleFile;
            activateTab(qs("#tab-sem"), true);
            await analyzeSelectedSample();
          });
        });
      }
      const delBtn = tr.querySelector("[data-act-del]");
      if (delBtn) {
        delBtn.addEventListener("click", () => openDeleteWaferModal(e.exp_id));
      }
      tbody.appendChild(tr);
    });

    const ruleErrors = brainData.rule_errors || {};
    qs("#humanRulesList").innerHTML = brainData.human_rules.map((r) => `
      <div class="rec-card">
        <div style="display:flex;justify-content:space-between;gap:0.5rem;">
          <strong>${esc(r.rule_id)}: ${esc(r.title)}</strong>
          <span>
            <span class="badge mono">${esc(r.source_node)} → ${esc(r.target_node)} (${r.polarity > 0 ? "+" : "−"})</span>
            <span class="badge ${r.guidance === "avoid" ? "badge-warn" : "badge-ok"}">${r.guidance === "avoid" ? "avoid" : "favor"}</span>
          </span>
        </div>
        <div style="font-size:0.79rem;color:var(--muted);margin-top:0.25rem;">${esc(r.description)}</div>
        <div class="mono" style="font-size:0.76rem;margin-top:0.25rem;">if (${esc(r.condition_expr)}) · weight=${esc(r.penalty_weight)} · ${esc(r.author)}</div>
        ${ruleErrors[r.rule_id] ? `<div class="badge badge-err" style="margin-top:0.25rem;">Invalid condition, never fires: ${esc(ruleErrors[r.rule_id])}</div>` : ""}
      </div>
    `).join("");

    const t0 = brainData.default_uncalibrated_theta;
    const tc = brainData.calibrated_theta;
    qs("#thetaCompareBox").innerHTML = Object.keys(tc).map((k) => `
      <div style="display:flex;justify-content:space-between;padding:0.35rem 0;border-bottom:1px solid var(--border);">
        <span>${esc(k)}</span>
        <span>θ₀ = ${esc(t0[k])}  →  <b style="color:var(--brand)">θ̂_PANG = ${Number(tc[k]).toFixed(4)}</b></span>
      </div>
    `).join("");
  }

  qs("#btnResetBrain").addEventListener("click", async (ev) => {
    const typed = window.prompt(
      "This replaces every ingested wafer, simulation and rule with the 12-wafer seed state.\n" +
      "The current state is saved to data/backups/ first.\n\nType RESET to continue."
    );
    if (typed === null || typed.trim() !== "RESET") {
      showToast("Reset cancelled. Nothing was changed.");
      return;
    }
    await withBusyButton(ev.currentTarget, async () => {
      try {
        await fetchJsonChecked(
          "/api/reset",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirm: "RESET" }),
          },
          "Reset failed"
        );
        clientSpecDirty = false;
        showToast("Reset to the 12-wafer seed. Previous state saved in data/backups/.");
        await refreshAll();
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  function configurePlatformModeAndInitialRoute() {
    if (IS_STATIC_DEMO) {
      if (qs("#platformModeBadge")) {
        qs("#platformModeBadge").textContent = "Interactive Browser Sandbox";
      }
      if (qs("#workspaceSelectWrap")) {
        qs("#workspaceSelectWrap").hidden = true;
      }
    }
    const path = (window.location && window.location.pathname) || "";
    const hash = (window.location && window.location.hash) || "";
    let qMode = null;
    let qTab = null;
    try {
      const sp = new URL(window.location.href).searchParams;
      qMode = sp.get("mode");
      qTab = sp.get("tab");
    } catch (_err) { /* ignore */ }

    if (path.endsWith("/world") || hash === "#world" || qMode === "workbench") {
      if (qs("#guidedProductStudio")) qs("#guidedProductStudio").hidden = true;
      if (qs("#advancedWorkbenchWrapper")) qs("#advancedWorkbenchWrapper").hidden = false;
      if (qs("#advancedHeaderControls")) qs("#advancedHeaderControls").style.display = "inline-flex";
      if (qs("#btnModeGuided")) qs("#btnModeGuided").setAttribute("aria-pressed", "false");
      if (qs("#btnModeWorkbench")) qs("#btnModeWorkbench").setAttribute("aria-pressed", "true");
      const targetTabId = qTab ? `tab-${qTab}` : (path.endsWith("/world") || hash === "#world" ? "tab-knowledge" : "tab-brain");
      const targetTab = qs(`#${CSS.escape(targetTabId)}`) || qs("#tab-brain");
      if (targetTab) activateTab(targetTab, false);
    }
  }

  window.PANGStudioBridge = {
    refreshWorkbench: refreshAll,
    drawAllCanvases,
    showToast,
    activateTabById: (id) => {
      const t = qs(`#${id}`);
      if (t) activateTab(t, false);
    },
    switchWorkspace: async (wsName) => {
      if (isValidWorkspace(wsName)) {
        await setWorkspace(wsName, false);
      }
    },
  };

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawAllCanvases);
  window.addEventListener("resize", drawAllCanvases);

  (async () => {
    configurePlatformModeAndInitialRoute();
    await refreshAll();
  })();
})();
