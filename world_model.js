/* PANG World Model page: knobs -> brain prediction -> animated fill, sensitivity, optimizer, knowledge base. */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : null);
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const fmt = (v, d = 0) => (num(v) ? Number(v).toFixed(d) : "–");
  const pct = (p) => (num(p) ? `${Math.round(p * 100)}%` : "–");

  const state = {
    knobs: [], defaults: {}, recipe: {}, goal: "plug_fill", ftype: "hole",
    sim: null, sweep: null, metric: "ph110", brain: null, flags: { literature: {}, training: {} },
    t: 1, playing: false, kbLoaded: false, kb: null, litDomain: "all",
  };

  // ------------------------------------------------------------------ utilities
  function toast(msg) {
    const el = $("#wmToast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 5000);
  }

  async function api(path, body) {
    // Static (GitHub Pages) build: world_static.js answers in the browser instead of the server
    if (window.WM_BACKEND) return window.WM_BACKEND.handle(path, body);
    const opts =body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? data);
      throw new Error(`${res.status}: ${d}`);
    }
    return data;
  }

  let PAL = null;
  function cssColor(name) {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    $(".wm-root").appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }
  function palette() {
    if (!PAL) {
      PAL = {};
      for (const [k, v] of Object.entries({ surface: "--surface-1", text: "--text-primary", text2: "--text-secondary", muted: "--text-muted", grid: "--grid", series: "--series-1", mold: "--mold", carbon: "--carbon", critical: "--critical" })) PAL[k] = cssColor(v);
    }
    return PAL;
  }
  function withAlpha(rgb, a) {
    const m = rgb.match(/\d+(\.\d+)?/g);
    return m ? `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${a})` : rgb;
  }

  // ------------------------------------------------------------------ tabs
  function setupTabs() {
    const tabs = $$('[role="tab"]');
    const activate = (tab, focus) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        $(`#${t.getAttribute("aria-controls")}`).hidden = !on;
      });
      if (focus) tab.focus();
      if (tab.id === "tab-kb" && !state.kbLoaded) loadKB();
      if (tab.id === "tab-sim") drawFrame();
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => activate(t, false));
      t.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          const j = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
          activate(tabs[j], true);
          e.preventDefault();
        }
      });
    });
  }

  // ------------------------------------------------------------------ knobs
  function knobText(k, v) {
    if (k.key === "freq_mhz") return `${v} MHz`;
    if (k.key === "trim_fraction") return `${Math.round(v * 100)}%`;
    const d = (k.step ?? 1) < 1 ? 1 : 0;
    return `${fmt(v, d)} ${k.unit}`;
  }

  function buildKnobs() {
    const box = $("#wmKnobs");
    box.innerHTML = state.knobs.map((k) => {
      const discrete = Array.isArray(k.values);
      const attrs = discrete ? `min="0" max="${k.values.length - 1}" step="1"` : `min="${k.lo}" max="${k.hi}" step="${k.step}"`;
      return `<div class="wm-knob"><label for="knob-${esc(k.key)}"><span>${esc(k.label)}</span><b id="knobv-${esc(k.key)}"></b></label>
        <input type="range" id="knob-${esc(k.key)}" data-key="${esc(k.key)}" ${attrs} /></div>`;
    }).join("");
    state.knobs.forEach((k) => {
      const input = $(`#knob-${k.key}`);
      input.addEventListener("input", () => {
        const v = Array.isArray(k.values) ? k.values[Number(input.value)] : Number(input.value);
        state.recipe[k.key] = v;
        updateKnobLabel(k);
        scheduleSim();
      });
    });
  }

  function updateKnobLabel(k) {
    const v = state.recipe[k.key];
    const text = knobText(k, v);
    $(`#knobv-${k.key}`).textContent = text;
    $(`#knob-${k.key}`).setAttribute("aria-valuetext", text);
  }

  function setKnobs(recipe) {
    state.knobs.forEach((k) => {
      let v = recipe[k.key];
      if (!num(v)) v = state.defaults[k.key];
      if (Array.isArray(k.values)) {
        const idx = k.values.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(k.values[best] - v) ? i : best), 0);
        v = k.values[idx];
        $(`#knob-${k.key}`).value = String(idx);
      } else {
        v = Math.min(k.hi, Math.max(k.lo, v));
        $(`#knob-${k.key}`).value = String(v);
      }
      state.recipe[k.key] = v;
      updateKnobLabel(k);
    });
    if (recipe.feature_type) {
      state.ftype = recipe.feature_type;
      $$('input[name="ftype"]').forEach((r) => { r.checked = r.value === state.ftype; });
    }
  }

  function currentRecipe() {
    return { ...state.defaults, ...state.recipe, feature_type: state.ftype };
  }

  function buildPresets() {
    const sel = $("#wmPreset");
    const measured = (state.brain?.experiments || []).filter((e) => e.provenance === "measured");
    sel.innerHTML = `<option value="__default">Default recipe</option>` +
      (measured.length ? `<optgroup label="Measured wafers">${measured.map((e) => `<option value="${esc(e.exp_id)}">${esc(e.exp_id)} (measured)</option>`).join("")}</optgroup>` : "");
    sel.addEventListener("change", () => {
      if (sel.value === "__default") setKnobs(state.defaults);
      else {
        const e = measured.find((x) => x.exp_id === sel.value);
        if (e) setKnobs(e.recipe);
      }
      scheduleSim();
    });
  }

  // ------------------------------------------------------------------ simulate
  let simTimer = null;
  let sweepTimer = null;
  let simSeq = 0;
  let sweepSeq = 0;

  function scheduleSim() {
    clearTimeout(simTimer);
    simTimer = setTimeout(runSim, 90);
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(runSweep, 500);
  }

  async function runSim() {
    const seq = ++simSeq;
    try {
      const res = await api("/api/world/simulate", { recipe: currentRecipe(), goal: state.goal });
      if (seq !== simSeq) return;
      state.sim = res;
      stopPlay();
      setTime(1);
      renderReadout();
    } catch (err) {
      toast(`Prediction failed: ${err.message}`);
    }
  }

  // ------------------------------------------------------------------ readout
  function renderReadout() {
    const s = state.sim;
    const post = s.posterior;
    const unc = s.uncertainty;
    const plasma = s.plasma;
    const plug = s.goal === "plug_fill";

    $("#wmPspec").textContent = pct(s.p_meets_spec);
    $("#wmSpecName").textContent = `Against: ${s.client_spec.name}`;
    $("#wmSpecLines").innerHTML = s.spec_lines.map((ln) => `
      <li><span class="wm-status ${esc(ln.status)}">${esc(ln.status)}</span>
        <span>${esc(ln.label)} <span class="wm-note">${esc(ln.target)} · predicted ${esc(ln.predicted)}</span></span>
        <span class="wm-mono">${pct(ln.prob)}</span></li>`).join("");

    const rows = plug ? [
      ["PH depth 110 nm", `${fmt(post.ph_depth_110_nm)} ± ${fmt(unc.ph_depth_110_std)} nm`],
      ["PH depth 225 nm", `${fmt(post.ph_depth_225_nm)} ± ${fmt(unc.ph_depth_225_std)} nm`],
      ["Void width 110 / 225 nm", `${fmt(post.void_width_110_nm, 1)} / ${fmt(post.void_width_225_nm, 1)} nm`],
      ["Chance void-free 110 / 225", `${pct(s.p_void_free_110)} / ${pct(s.p_void_free_225)}`],
    ] : [
      ["Fill height 110 nm", `${fmt(post.fill_height_110_nm)} ± ${fmt(unc.fill_height_110_std)} nm`],
      ["Upper sidewall", `${fmt(post.upper_wall_nm, 1)} nm`],
    ];
    rows.push(
      ["Overburden", `${fmt(post.ob_nm)} ± ${fmt(unc.ob_std)} nm`],
      ["Dual-CD step", `${fmt(post.dual_cd_step_nm, 1)} nm`],
      ["Crack risk", pct(post.crack_prob)],
      ["Superconformal growth", post.superconformal ? "yes" : "no"],
    );
    $("#wmOutcomes").innerHTML = rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");

    $("#wmLayers").innerHTML = s.layers.map((L) => `
      <div class="wm-layers" style="margin-bottom:8px">
        <div class="wm-label">${esc(L.target)}</div>
        <div class="wm-layer"><span>Simulator, textbook kinetics</span><span>${fmt(L.uncalibrated_sim)} nm</span></div>
        <div class="wm-layer"><span>Simulator, kinetics calibrated to wafers (θ̂)</span><span>${fmt(L.calibrated_physics)} nm</span></div>
        <div class="wm-layer"><span>Human-rule shift</span><span>${L.human_rule_shift >= 0 ? "+" : ""}${fmt(L.human_rule_shift)} nm</span></div>
        <div class="wm-layer"><span>Data correction (Gaussian process)</span><span>${num(L.data_correction) && L.data_correction >= 0 ? "+" : ""}${fmt(L.data_correction)} nm</span></div>
        <div class="wm-layer total"><span>Brain prediction</span><span>${fmt(L.posterior)} nm</span></div>
      </div>`).join("") + `<p class="wm-note">Clipping to the physical range can make the parts not add up exactly.</p>`;

    const kv = [
      ["Sticking β_eff", fmt(plasma.beta_eff, 4)],
      ["Ion energy E_i", `${fmt(plasma.ion_energy_ev, 1)} eV`],
      ["Electron density", `${fmt(plasma.ne_1e10_cm3, 2)} ×10¹⁰ cm⁻³`],
      ["Dust margin τ_nuc/τ_res", `${fmt(plasma.dust_margin, 2)} (need ≥ 1.5)`],
      ["Knudsen no. (110 nm)", fmt(plasma.knudsen_110, 0)],
      ["Residence time", `${fmt(plasma.tau_res_ms, 1)} ms`],
      ["Film density (model)", `${fmt(plasma.film_density_g_cm3, 2)} g/cm³`],
    ];
    $("#wmPlasma").innerHTML = kv.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join("");

    const fired = s.human_priors?.triggered_rules || [];
    const ex = s.extrapolation || {};
    let warn = "";
    if (ex.outside_window || (num(ex.nearest_measured_distance) && ex.nearest_measured_distance > 1.0)) {
      warn = `<div class="wm-warn">Far from any measured wafer (distance ${fmt(ex.nearest_measured_distance, 2)} in normalized knob space${ex.outside_window ? ", outside the calibrated window" : ""}). Treat this as extrapolation.</div>`;
    }
    $("#wmRules").innerHTML = warn + (fired.length ? `Human rules active: ${fired.map(esc).join(" · ")}` : "No human rules triggered.");

    $("#wmNearest").innerHTML = (s.nearest_measured || []).map((n) => {
      const m = n.measured || {};
      const depth = num(m.ph_depth_110_nm) ? `PH ${fmt(m.ph_depth_110_nm)} nm` : num(m.fill_height_110_nm) ? `fill ${fmt(m.fill_height_110_nm)} nm` : "PH not measured";
      return `<div class="wm-layer" style="margin-bottom:6px"><span><b>${esc(n.exp_id)}</b> · distance ${fmt(n.distance, 2)}<br/><span class="wm-note">measured ${esc(depth)}, OB ${fmt(m.ob_nm)} nm, crack ${m.crack_detected == null ? "not measured" : m.crack_detected ? "yes" : "no"}</span></span>
        <span><button type="button" class="wm-btn" data-load-exp="${esc(n.exp_id)}">Load</button></span></div>`;
    }).join("") || `<p class="wm-note">No measured wafers yet.</p>`;
    $$("[data-load-exp]").forEach((b) => b.addEventListener("click", () => {
      const e = (state.brain?.experiments || []).find((x) => x.exp_id === b.dataset.loadExp);
      if (e) { setKnobs(e.recipe); $("#wmPreset").value = e.exp_id; scheduleSim(); }
    }));

    const modes = Object.entries(s.features).map(([cd, F]) => `${cd} nm: ${F.mode.replace("_", "-")}`).join(" · ");
    $("#wmModeBadge").textContent = modes;
    $("#wmCanvasText").textContent = describeFill(s);
  }

  function describeFill(s) {
    const parts = Object.entries(s.features).map(([cd, F]) => {
      if (F.mode === "partial_fill") return `${cd} nm feature: bottom-up fill to ${fmt(F.reconciled_to.fill_height_nm)} nm, mouth open`;
      const v = F.final_void;
      return v ? `${cd} nm feature: keyhole void from ${fmt(v.top_nm)} to ${fmt(v.bottom_nm)} nm deep, up to ${fmt(v.max_width_nm, 1)} nm wide` : `${cd} nm feature: void-free`;
    });
    return `${parts.join("; ")}; overburden ${fmt(s.posterior.ob_nm)} nm.`;
  }

  // ------------------------------------------------------------------ canvas
  function frameAt(F, t) {
    const n = F.frames.length;
    const x = Math.min(1, Math.max(0, t)) * (n - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(n - 1, i0 + 1);
    const a = x - i0;
    const f0 = F.frames[i0];
    const f1 = F.frames[i1];
    const lerp = (p, q) => p + (q - p) * a;
    return {
      walls_nm: f0.walls_nm.map((w, i) => lerp(w, f1.walls_nm[i])),
      bottom_nm: lerp(f0.bottom_nm, f1.bottom_nm),
      ob_nm: lerp(f0.ob_nm, f1.ob_nm),
    };
  }

  function drawFrame() {
    const cv = $("#wmCanvas");
    if (!cv || cv.offsetParent === null) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = palette();
    ctx.fillStyle = P.surface;
    ctx.fillRect(0, 0, W, H);
    const s = state.sim;
    if (!s) return;

    const L = s.recipe.depth_nm;
    const feats = [["110", s.features["110"]], ["225", s.features["225"]]];
    const padL = 54, padR = 64, padT = 30, padB = 22, gap = 70;
    const panelW = (W - padL - padR - gap) / 2;
    const obMax = Math.max(60, ...feats.map(([, F]) => F.frames[F.frames.length - 1].ob_nm));
    const sy = (H - padT - padB - 16) / (L + obMax);
    const yMold = padT + obMax * sy + 8;
    const yBot = yMold + L * sy;
    const sx = (panelW * 0.46) / s.recipe.wide_cd_nm;

    // depth ruler
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = P.muted;
    ctx.strokeStyle = P.grid;
    ctx.lineWidth = 1;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let d = 0; d <= L + 1e-6; d += L / 4) {
      const y = yMold + d * sy;
      ctx.beginPath(); ctx.moveTo(padL - 6, y); ctx.lineTo(padL - 2, y); ctx.stroke();
      ctx.fillText(`${Math.round(d)}`, padL - 9, y);
    }
    ctx.save();
    ctx.translate(14, (yMold + yBot) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("depth (nm)", 0, 0);
    ctx.restore();

    const plug = s.goal === "plug_fill";
    feats.forEach(([cd, F], idx) => {
      const x0 = padL + idx * (panelW + gap);
      const cx = x0 + panelW / 2;
      const fr = frameAt(F, state.t);
      const half = F.cd_nm / 2;
      const hw = half * sx;
      const holeL = cx - hw;
      const holeR = cx + hw;
      const nz = F.z_nm.length;
      const cellH = (L / nz) * sy;

      // mold with the feature cut into it
      ctx.fillStyle = P.mold;
      ctx.fillRect(x0, yMold, panelW, L * sy + 10);
      ctx.fillStyle = P.surface;
      ctx.fillRect(holeL, yMold, 2 * hw, L * sy);

      // cell states: solid, open (connected to mouth), trapped (void)
      const solid = fr.walls_nm.map((w, i) => w >= half - 0.05 || F.z_nm[i] >= L - fr.bottom_nm);
      let blocked = false;
      const trapped = solid.map((sd) => { if (blocked) return !sd; if (sd) blocked = true; return false; });

      // carbon: sidewalls, sealed cells, bottom fill
      ctx.fillStyle = P.carbon;
      fr.walls_nm.forEach((w, i) => {
        const y = yMold + i * cellH;
        const wpx = Math.min(w, half) * sx;
        if (solid[i]) ctx.fillRect(holeL, y, 2 * hw, cellH + 0.6);
        else { ctx.fillRect(holeL, y, wpx, cellH + 0.6); ctx.fillRect(holeR - wpx, y, wpx, cellH + 0.6); }
      });
      const bpx = fr.bottom_nm * sy;
      ctx.fillRect(holeL, yBot - bpx, 2 * hw, bpx);

      // planar overburden on the field; over the feature once the mouth has sealed
      const obPx = fr.ob_nm * sy;
      const mouthW = Math.min(fr.walls_nm[0], half) * sx;
      ctx.fillRect(x0, yMold - obPx, holeL - x0 + mouthW, obPx);
      ctx.fillRect(holeR - mouthW, yMold - obPx, x0 + panelW - (holeR - mouthW), obPx);
      if (solid[0]) ctx.fillRect(holeL, yMold - obPx, 2 * hw, obPx);

      // trapped void outline
      const tIdx = trapped.map((tr, i) => (tr ? i : -1)).filter((i) => i >= 0);
      if (tIdx.length) {
        ctx.strokeStyle = P.critical;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        tIdx.forEach((i, k) => {
          const y = yMold + i * cellH;
          const wpx = Math.min(fr.walls_nm[i], half) * sx;
          if (k === 0) ctx.moveTo(holeL + wpx, y); else ctx.lineTo(holeL + wpx, y);
          ctx.lineTo(holeL + wpx, y + cellH);
        });
        for (let k = tIdx.length - 1; k >= 0; k -= 1) {
          const i = tIdx[k];
          const y = yMold + i * cellH;
          const wpx = Math.min(fr.walls_nm[i], half) * sx;
          ctx.lineTo(holeR - wpx, y + cellH);
          ctx.lineTo(holeR - wpx, y);
        }
        ctx.closePath();
        ctx.stroke();
        const yv = yMold + ((tIdx[0] + tIdx[tIdx.length - 1] + 1) / 2) * cellH;
        ctx.fillStyle = P.critical;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText("void", holeL - 6, yv);
      }

      // predicted end-state marker with ±1σ bracket
      const markNm = plug ? s.posterior[cd === "110" ? "ph_depth_110_nm" : "ph_depth_225_nm"] : s.posterior.fill_height_110_nm;
      const sigNm = plug ? s.uncertainty[cd === "110" ? "ph_depth_110_std" : "ph_depth_225_std"] : s.uncertainty.fill_height_110_std;
      if (num(markNm)) {
        const yMark = plug ? yMold + markNm * sy : yBot - markNm * sy;
        const yA = plug ? yMold + Math.max(0, markNm - sigNm) * sy : yBot - Math.min(L, markNm + sigNm) * sy;
        const yB = plug ? yMold + Math.min(L, markNm + sigNm) * sy : yBot - Math.max(0, markNm - sigNm) * sy;
        ctx.fillStyle = withAlpha(P.series, 0.18);
        ctx.fillRect(holeR + 10, Math.min(yA, yB), 8, Math.abs(yB - yA));
        ctx.strokeStyle = P.series;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(holeR + 8, yMark); ctx.lineTo(holeR + 20, yMark); ctx.stroke();
        ctx.fillStyle = P.text2;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const lab = plug ? (markNm >= L * 0.986 ? "PH 1000 (void-free)" : `PH ${Math.round(markNm)} ± ${Math.round(sigNm)}`) : `fill ${Math.round(markNm)} ± ${Math.round(sigNm)}`;
        ctx.fillText(lab, holeR + 24, yMark);
      }

      // predicted crack risk in the overburden at the end of the deposition
      if (state.t > 0.95 && s.posterior.crack_prob >= 0.5) {
        ctx.strokeStyle = P.critical;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        const yc = yMold - obPx * 0.5;
        for (let x = x0 + 8, k = 0; x < holeL - 8; x += 7, k += 1) {
          const y = yc + (k % 2 ? -2.5 : 2.5);
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // panel title
      ctx.fillStyle = P.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.font = "600 12px system-ui, sans-serif";
      const ar = (L / F.cd_nm).toFixed(1);
      ctx.fillText(`${cd} nm ${s.recipe.feature_type === "trench" ? "trench" : "hole"} · AR ${ar}`, cx, 16);
      ctx.font = "11px system-ui, sans-serif";
    });

    // legend
    const items = [[P.carbon, "a-C:H:N carbon"], [P.mold, "dielectric"], [P.critical, "trapped void"]];
    let lx = padL;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    items.forEach(([c, t]) => {
      ctx.fillStyle = c; ctx.fillRect(lx, H - 10, 10, 8);
      ctx.fillStyle = P.text2; ctx.fillText(t, lx + 14, H - 6);
      lx += ctx.measureText(t).width + 34;
    });
    if (s.posterior.crack_prob >= 0.5) { ctx.fillStyle = P.text2; ctx.fillText(`zigzag = predicted crack risk ${pct(s.posterior.crack_prob)}`, lx, H - 6); }
  }

  // ------------------------------------------------------------------ player
  function setTime(t) {
    state.t = Math.min(1, Math.max(0, t));
    const p = Math.round(state.t * 100);
    $("#wmTime").value = String(p);
    $("#wmTime").setAttribute("aria-valuetext", `${p}% of deposition`);
    $("#wmTimeLabel").textContent = `t = ${p}%`;
    drawFrame();
  }
  function stopPlay() {
    state.playing = false;
    $("#wmPlay").textContent = "▶ Play fill";
  }
  function play() {
    if (state.playing) { stopPlay(); return; }
    state.playing = true;
    $("#wmPlay").textContent = "❚❚ Pause";
    if (state.t >= 1) setTime(0);
    let last = performance.now();
    const step = (now) => {
      if (!state.playing) return;
      setTime(state.t + (now - last) / 4500);
      last = now;
      if (state.t >= 1) { stopPlay(); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ------------------------------------------------------------------ sensitivity sweeps
  const METRICS = {
    ph110: { label: "PH depth 110 nm", y: "ph110", s: "ph110_std", unit: "nm", thr: (sp) => ({ v: sp.ph_min_nm, text: `spec ≥ ${sp.ph_min_nm}` }) },
    ob: { label: "Overburden", y: "ob", s: "ob_std", unit: "nm", thr: (sp) => ({ v: sp.ob_max_nm, text: `spec ≤ ${sp.ob_max_nm}` }) },
    crack: { label: "Crack risk", y: "crack", unit: "%", pctScale: true, thr: null },
    p_spec: { label: "Chance to meet spec", y: "p_spec", unit: "%", pctScale: true, thr: null },
    fill_h: { label: "Fill height 110 nm", y: "fill_h", s: "fill_h_std", unit: "nm", thr: (sp) => ({ v: sp.fill_height_target_nm, text: `target ${sp.fill_height_target_nm}` }) },
  };

  async function runSweep() {
    const seq = ++sweepSeq;
    try {
      const res = await api("/api/world/sweep", { recipe: currentRecipe(), goal: state.goal });
      if (seq !== sweepSeq) return;
      state.sweep = res;
      renderSweeps();
    } catch (err) {
      toast(`Sensitivity sweep failed: ${err.message}`);
    }
  }

  function metricDomain(m) {
    if (m.pctScale) return [0, 1];
    let lo = Infinity, hi = -Infinity;
    state.sweep.knobs.forEach((k) => k.series[m.y].forEach((v, i) => {
      const sd = m.s ? k.series[m.s][i] : 0;
      lo = Math.min(lo, v - sd); hi = Math.max(hi, v + sd);
    }));
    const t = m.thr ? m.thr(state.sweep.client_spec) : null;
    if (t) { lo = Math.min(lo, t.v); hi = Math.max(hi, t.v); }
    // Depths cannot exceed the feature depth; round the range to 50 nm so ticks read cleanly
    const depth = state.sim?.recipe?.depth_nm ?? 1000;
    if (m.y === "ph110" || m.y === "fill_h") hi = Math.min(hi, depth);
    return [Math.max(0, Math.floor(lo / 50) * 50), Math.ceil(hi / 50) * 50 || 50];
  }

  function fmtMetric(m, v) { return m.pctScale ? pct(v) : `${fmt(v)} ${m.unit}`; }

  function renderSweeps() {
    if (!state.sweep) return;
    const m = METRICS[state.metric];
    const [y0, y1] = metricDomain(m);
    const Wv = 240, Hv = 130, l = 40, r = 8, t = 8, b = 22;
    const X = (f) => l + f * (Wv - l - r);
    const Y = (v) => t + (1 - (v - y0) / (y1 - y0)) * (Hv - t - b);
    const spec = state.sweep.client_spec;
    const thr = m.thr ? m.thr(spec) : null;

    const html = state.sweep.knobs.map((k, ki) => {
      const xs = k.series.x;
      const ys = k.series[m.y];
      const sd = m.s ? k.series[m.s] : null;
      const discrete = xs.length <= 2;
      const fx = (i) => (discrete ? 0.25 + 0.5 * i : (xs[i] - xs[0]) / (xs[xs.length - 1] - xs[0] || 1));
      let marks = "";
      if (discrete) {
        xs.forEach((x, i) => {
          const cx = X(fx(i));
          if (sd) marks += `<line x1="${cx}" x2="${cx}" y1="${Y(ys[i] + sd[i])}" y2="${Y(Math.max(y0, ys[i] - sd[i]))}" stroke="var(--series-1)" stroke-width="2" stroke-linecap="round" opacity="0.35"/>`;
          const cur = Math.abs(x - k.current) < 1e-6;
          marks += `<circle cx="${cx}" cy="${Y(ys[i])}" r="${cur ? 5 : 4}" fill="var(--series-1)" stroke="var(--surface-1)" stroke-width="2"/>`;
        });
      } else {
        if (sd) {
          const up = xs.map((_, i) => `${X(fx(i))},${Y(Math.min(y1, ys[i] + sd[i]))}`);
          const dn = xs.map((_, i) => `${X(fx(i))},${Y(Math.max(y0, ys[i] - sd[i]))}`).reverse();
          marks += `<polygon points="${up.concat(dn).join(" ")}" fill="var(--series-1)" opacity="0.12"/>`;
        }
        marks += `<polyline points="${xs.map((_, i) => `${X(fx(i))},${Y(ys[i])}`).join(" ")}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
        const fc = (k.current - xs[0]) / (xs[xs.length - 1] - xs[0] || 1);
        if (fc >= -0.001 && fc <= 1.001) {
          const j = Math.min(xs.length - 2, Math.max(0, Math.floor(fc * (xs.length - 1))));
          const a = fc * (xs.length - 1) - j;
          const yc = ys[j] + (ys[j + 1] - ys[j]) * a;
          marks += `<circle cx="${X(fc)}" cy="${Y(yc)}" r="4.5" fill="var(--series-1)" stroke="var(--surface-1)" stroke-width="2"/>`;
        }
      }
      const thrLine = thr && thr.v >= y0 && thr.v <= y1
        ? `<line x1="${l}" x2="${Wv - r}" y1="${Y(thr.v)}" y2="${Y(thr.v)}" stroke="var(--text-muted)" stroke-width="1"/><text x="${Wv - r}" y="${Y(thr.v) - 3}" text-anchor="end" font-size="9" fill="var(--text-muted)">${esc(thr.text)}</text>` : "";
      const yt = [y0, (y0 + y1) / 2, y1].map((v) => `<line x1="${l}" x2="${Wv - r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)" stroke-width="1"/><text x="${l - 4}" y="${Y(v) + 3}" text-anchor="end" font-size="9" fill="var(--text-muted)">${m.pctScale ? Math.round(v * 100) + "%" : Math.round(v)}</text>`).join("");
      const xl = discrete
        ? xs.map((x, i) => `<text x="${X(fx(i))}" y="${Hv - 6}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${esc(x)}</text>`).join("")
        : `<text x="${l}" y="${Hv - 6}" font-size="9" fill="var(--text-muted)">${esc(knobText(k, xs[0]))}</text><text x="${Wv - r}" y="${Hv - 6}" text-anchor="end" font-size="9" fill="var(--text-muted)">${esc(knobText(k, xs[xs.length - 1]))}</text>`;
      return `<div class="wm-sweep" data-ki="${ki}"><h4>${esc(k.label)}</h4>
        <svg viewBox="0 0 ${Wv} ${Hv}" role="img" aria-label="${esc(m.label)} versus ${esc(k.label)}">${yt}${thrLine}${marks}${xl}
          <line class="xh" x1="0" x2="0" y1="${t}" y2="${Hv - b}" stroke="var(--text-muted)" stroke-width="1" visibility="hidden"/>
          <rect class="hit" x="${l}" y="0" width="${Wv - l - r}" height="${Hv}" fill="transparent"/></svg>
        <div class="tip" hidden></div></div>`;
    }).join("");
    $("#wmSweeps").innerHTML = html;

    $$(".wm-sweep").forEach((el) => {
      const k = state.sweep.knobs[Number(el.dataset.ki)];
      const svg = $("svg", el);
      const tip = $(".tip", el);
      const xh = $(".xh", el);
      const xs = k.series.x;
      const discrete = xs.length <= 2;
      $(".hit", el).addEventListener("mousemove", (ev) => {
        const box = svg.getBoundingClientRect();
        const vx = ((ev.clientX - box.left) / box.width) * Wv;
        const f = Math.min(1, Math.max(0, (vx - l) / (Wv - l - r)));
        const i = discrete ? (f < 0.5 ? 0 : 1) : Math.round(f * (xs.length - 1));
        const px = discrete ? X(0.25 + 0.5 * i) : X(i / (xs.length - 1));
        xh.setAttribute("x1", px); xh.setAttribute("x2", px); xh.setAttribute("visibility", "visible");
        const v = k.series[m.y][i];
        const sd = m.s ? k.series[m.s][i] : null;
        tip.textContent = `${knobText(k, xs[i])}: ${fmtMetric(m, v)}${sd != null ? ` ± ${fmt(sd)}` : ""}`;
        tip.style.left = `${(px / Wv) * 100}%`;
        tip.style.top = `${((Y(v) + 18) / Hv) * box.height}px`;
        tip.hidden = false;
      });
      $(".hit", el).addEventListener("mouseleave", () => { tip.hidden = true; xh.setAttribute("visibility", "hidden"); });
    });

    renderSweepTable();
  }

  function renderSweepTable() {
    const box = $("#wmSweepTable");
    if (box.hidden || !state.sweep) return;
    const m = METRICS[state.metric];
    const rows = state.sweep.knobs.flatMap((k) => k.series.x.map((x, i) => `<tr><td>${esc(k.label)}</td><td>${esc(knobText(k, x))}</td><td>${esc(fmtMetric(m, k.series[m.y][i]))}</td><td>${m.s ? fmt(k.series[m.s][i]) : "–"}</td></tr>`));
    box.innerHTML = `<div class="wm-table-wrap" tabindex="0" role="region" aria-label="Sensitivity table"><table class="wm-table"><thead><tr><th>Knob</th><th>Value</th><th>${esc(m.label)}</th><th>±1σ</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  }

  // ------------------------------------------------------------------ optimizer
  async function runOptimize() {
    const btn = $("#wmOptimize");
    btn.disabled = true;
    $("#wmOptOut").innerHTML = `<p class="wm-note">Searching candidate recipes…</p>`;
    try {
      const res = await api("/api/world/optimize", {
        goal: state.goal,
        batch_size: Number($("#wmBatch").value),
        freq_filter: $("#wmFreqFilter").value,
        allow_two_step: $("#wmTwoStep").checked,
      });
      state.opt = res;
      $("#wmOptOut").innerHTML = `<div class="wm-opt-list">${res.suggestions.map((sg, i) => {
        const r = sg.recipe, p = sg.posterior, u = sg.uncertainty;
        const outcome = state.goal === "plug_fill"
          ? `PH ${fmt(p.ph_depth_110_nm)} ± ${fmt(u.ph_depth_110_std)} nm · OB ${fmt(p.ob_nm)} ± ${fmt(u.ob_std)} nm · crack ${pct(p.crack_prob)}`
          : `fill ${fmt(p.fill_height_110_nm)} ± ${fmt(u.fill_height_110_std)} nm · OB ${fmt(p.ob_nm)} nm`;
        return `<div class="wm-opt"><b>#${esc(sg.rank ?? i + 1)} · ${esc(sg.role || "candidate")}</b>
          <span>Chance to meet spec <b>${pct(sg.p_meets_spec)}</b></span>
          <span class="wm-mono">${esc(r.freq_mhz)} MHz · ${fmt(r.power_w)} W · ${fmt(r.gap_mils)} mils · ${fmt(r.pressure_torr, 1)} Torr · Ar ${fmt(r.ar_sccm / 1000, 1)} slm · C₂H₂ ${fmt(r.c2h2_sccm)} · NH₃ ${fmt(r.nh3_sccm)} · ${fmt(r.temp_c)} °C · trim ${pct(r.trim_fraction)}</span>
          <span>${esc(outcome)}</span>
          <span class="wm-note">${esc(sg.rationale || "")}</span>
          <span><button type="button" class="wm-btn" data-load-opt="${i}">Load into simulator</button></span></div>`;
      }).join("")}</div>`;
      $$("[data-load-opt]").forEach((b) => b.addEventListener("click", () => {
        const sg = state.opt.suggestions[Number(b.dataset.loadOpt)];
        setKnobs(sg.recipe);
        $("#wmPreset").value = "__default";
        scheduleSim();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }));
    } catch (err) {
      $("#wmOptOut").innerHTML = `<p class="wm-note">Optimizer failed: ${esc(err.message)}</p>`;
    } finally {
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------------ knowledge base
  async function loadKB() {
    state.kbLoaded = true;
    try {
      const kb = await api("/api/knowledge_base");
      state.kb = kb;
      renderKB();
    } catch (err) {
      state.kbLoaded = false;
      toast(`Knowledge base failed to load: ${err.message}`);
    }
  }

  function renderKB() {
    const kb = state.kb;
    const brain = state.brain || { experiments: [], counts: {} };
    const exps = brain.experiments || [];
    const measured = exps.filter((e) => e.provenance === "measured").length;
    const flagsLit = state.flags.literature || {};
    const flagsTr = state.flags.training || {};
    const pending = kb.literature.filter((e) => flagsLit[e.id]).length + kb.training_manifest.filter((t) => flagsTr[t.id]).length;
    const domains = {};
    kb.literature.forEach((e) => { domains[e.domain] = (domains[e.domain] || 0) + 1; });

    const tiles = [
      [kb.literature_count, "papers, preprints & patents"],
      [kb.figure_count, "extracted figures"],
      [kb.datasets.length, "datasets"],
      [kb.training_manifest.length, "training tables"],
      [measured, "measured wafers"],
      [exps.length - measured, "synthetic wafers"],
      [brain.counts?.simulations ?? "–", "simulation runs"],
      [brain.counts?.human_rules ?? "–", "human rules"],
      [pending, "metadata corrections pending"],
    ];
    $("#kbTiles").innerHTML = tiles.map(([n, l]) => `<div class="wm-tile"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join("");

    $("#kbWafers").innerHTML = exps.map((e) => {
      const r = e.recipe || {};
      const m = e.measured || {};
      const sc = e.spec_check;
      const meets = sc ? (sc.meets_spec ? "yes" : Object.values(sc.lines || {}).includes("fail") ? "no" : "not fully measured") : "–";
      const depth = num(m.ph_depth_110_nm) ? `${fmt(m.ph_depth_110_nm)} nm` : num(m.fill_height_110_nm) ? `fill ${fmt(m.fill_height_110_nm)} nm` : "–";
      const defects = [m.crack_detected ? "crack" : null, m.nodule_defect ? "nodule" : null].filter(Boolean).join(", ") || "none";
      return `<tr><td><b>${esc(e.exp_id)}</b></td>
        <td><span class="wm-badge ${e.provenance === "measured" ? "measured" : "synthetic"}">${esc(e.provenance || "unknown")}</span>${e.provenance_inferred ? ' <span class="wm-note">(inferred)</span>' : ""}</td>
        <td class="wm-mono">${esc(r.freq_mhz)} MHz · ${fmt(r.power_w)} W · ${fmt(r.pressure_torr, 1)} T · N/C ${fmt(r.nc_ratio, 2)} · ${fmt(r.temp_c)} °C</td>
        <td>${esc(depth)}</td><td>${fmt(m.ob_nm)} nm</td><td>${esc(defects)}</td><td>${esc(meets)}</td></tr>`;
    }).join("");

    const dom = $("#kbDomains");
    dom.innerHTML = [["all", `All (${kb.literature.length})`], ...Object.entries(domains).map(([d, n]) => [d, `${d.replaceAll("_", " ")} (${n})`])]
      .map(([d, t]) => `<button type="button" class="wm-chip" data-domain="${esc(d)}" aria-pressed="${d === state.litDomain}">${esc(t)}</button>`).join("");
    $$("[data-domain]", dom).forEach((b) => b.addEventListener("click", () => {
      state.litDomain = b.dataset.domain;
      $$("[data-domain]", dom).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderLit();
    }));
    renderLit();

    const dsCards = [
      ...kb.datasets.map((d) => ({ ...d, kind: "dataset" })),
      ...kb.training_manifest.map((d) => ({ ...d, kind: "training" })),
    ];
    $("#kbDatasets").innerHTML = dsCards.map((d) => `
      <div class="wm-ds"><b>${esc(d.title || d.id)}</b> <span class="wm-badge">${d.kind === "training" ? "training table" : "dataset"}</span>
        ${flagsTr[d.id] ? `<div class="wm-badge flag" title="${esc(flagsTr[d.id])}">review flag</div><div class="wm-note">${esc(flagsTr[d.id])}</div>` : ""}
        <div class="wm-note">${esc((d.description || "").slice(0, 240))}${(d.description || "").length > 240 ? "…" : ""}</div>
        <div class="wm-note">${esc(d.row_count ?? "?")} rows · ${esc((d.columns || []).length)} columns</div>
        <details data-ds="${esc(d.id)}" data-kind="${esc(d.kind)}"><summary>View rows</summary><div class="wm-note">Loading…</div></details></div>`).join("");
    $$("details[data-ds]").forEach((det) => det.addEventListener("toggle", async () => {
      if (!det.open || det.dataset.loaded) return;
      det.dataset.loaded = "1";
      const path = det.dataset.kind === "training" ? "training" : "dataset";
      try {
        const data = await api(`/api/knowledge_base/${path}/${encodeURIComponent(det.dataset.ds)}`);
        const cols = data.columns || Object.keys((data.rows || [])[0] || {});
        const rows = (data.rows || []).slice(0, 40);
        const prov = {};
        (data.rows || []).forEach((rw) => { if (rw.provenance) prov[rw.provenance] = (prov[rw.provenance] || 0) + 1; });
        const provTxt = Object.keys(prov).length ? `<p class="wm-note">Row provenance: ${Object.entries(prov).map(([k, n]) => `${esc(k)} ${n}`).join(" · ")}</p>` : "";
        det.querySelector("div").outerHTML = `${provTxt}<div class="wm-table-wrap" tabindex="0" role="region" aria-label="Rows of ${esc(det.dataset.ds)}"><table class="wm-table"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((rw) => `<tr>${cols.map((c) => `<td>${esc(typeof rw[c] === "object" ? JSON.stringify(rw[c]) : rw[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      } catch (err) {
        det.querySelector("div").textContent = `Could not load rows: ${err.message}`;
      }
    }));

    const figBase = window.WM_FIG_BASE || "/kb_figures/";
    $("#kbFigures").innerHTML = kb.figures.map((f) => {
      const cap = `<figcaption><b>${esc(f.title)}</b><br/>${esc(f.citation || f.paper_id || "")}${f.license ? ` · ${esc(f.license)}` : ""}</figcaption>`;
      if (f.redistributable === false) {
        const srcUrl = safeUrl(f.source_url);
        return `<figure class="wm-fig"><div class="wm-fig-missing">Not republished here (license)${srcUrl ? `<br/><a href="${esc(srcUrl)}" target="_blank" rel="noopener">View at source</a>` : ""}</div>${cap}</figure>`;
      }
      const src = `${figBase}${encodeURIComponent(f.file)}`;
      return `<figure class="wm-fig"><a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${esc(f.title)}" loading="lazy"/></a>${cap}</figure>`;
    }).join("");
  }

  function renderLit() {
    const q = ($("#kbSearch").value || "").trim().toLowerCase();
    const flags = state.flags.literature || {};
    const rows = state.kb.literature.filter((e) => (state.litDomain === "all" || e.domain === state.litDomain)
      && (!q || [e.citation, e.title, e.takeaway, e.id].join(" ").toLowerCase().includes(q)));
    $("#kbLit").innerHTML = rows.map((e) => {
      const url = safeUrl(e.url);
      const title = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title);
      const status = flags[e.id] ? `<span class="wm-badge flag">correction pending</span><div class="wm-note">${esc(flags[e.id])}</div>` : `<span class="wm-note">—</span>`;
      return `<tr><td><b>${esc(e.citation)}</b><br/>${title}<div class="wm-note">${esc(e.year ?? "")}${e.is_oa ? " · open access" : ""}${e.license ? ` · ${esc(e.license)}` : ""}</div></td>
        <td>${esc((e.domain || "").replaceAll("_", " "))}</td><td>${esc(e.takeaway)}</td><td class="wm-mono">${esc((e.tags || []).join(", "))}</td><td>${status}</td></tr>`;
    }).join("") || `<tr><td colspan="5" class="wm-note">No matches.</td></tr>`;
  }

  // ------------------------------------------------------------------ init
  async function init() {
    setupTabs();
    try {
      const [knobs, brain, flags] = await Promise.all([api("/api/world/knobs"), api("/api/brain"), api("/api/world/review_flags")]);
      state.knobs = knobs.knobs;
      state.defaults = knobs.defaults;
      state.brain = brain;
      state.flags = flags;
      const exps = brain.experiments || [];
      const meas = exps.filter((e) => e.provenance === "measured").length;
      $("#wmBasis").textContent = `Brain v${brain.brain_version} · ${meas} measured + ${exps.length - meas} synthetic wafers · ${brain.counts?.simulations ?? 0} sims · ${brain.counts?.human_rules ?? 0} rules`;
      buildKnobs();
      setKnobs(state.defaults);
      buildPresets();
    } catch (err) {
      toast(`Could not load the brain: ${err.message}`);
      return;
    }
    $$('input[name="goal"]').forEach((r) => r.addEventListener("change", () => { state.goal = r.value; scheduleSim(); }));
    $$('input[name="ftype"]').forEach((r) => r.addEventListener("change", () => { state.ftype = r.value; scheduleSim(); }));
    $("#wmResetKnobs").addEventListener("click", () => { setKnobs(state.defaults); $("#wmPreset").value = "__default"; scheduleSim(); });
    $("#wmPlay").addEventListener("click", play);
    $("#wmTime").addEventListener("input", (e) => { stopPlay(); setTime(Number(e.target.value) / 100); });
    $$("[data-metric]").forEach((b) => b.addEventListener("click", () => {
      state.metric = b.dataset.metric;
      $$("[data-metric]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderSweeps();
    }));
    $("#wmSweepTableToggle").addEventListener("click", (e) => {
      const box = $("#wmSweepTable");
      box.hidden = !box.hidden;
      e.currentTarget.setAttribute("aria-pressed", String(!box.hidden));
      renderSweepTable();
    });
    $("#wmOptimize").addEventListener("click", runOptimize);
    $("#kbSearch").addEventListener("input", () => { if (state.kb) renderLit(); });
    new ResizeObserver(() => drawFrame()).observe($("#wmCanvas"));
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { PAL = null; drawFrame(); renderSweeps(); });
    runSim();
    runSweep();
  }

  init();
})();
