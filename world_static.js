/* Static-site backend for the Unified PANG Platform & World Model (GitHub Pages build).
 *
 * Answers both `/api/world/*` and unified Studio read-only routes (`/api/brain`, `/api/predict`,
 * `/api/recommend`, `/api/molecular/simulate`, `/api/knowledge_base*`, `/api/data_model`,
 * `/api/campaigns/catalog`) entirely in the browser from `model.json` + `data.json`.
 * `fillEvolution` is a line-for-line port of `pang_brain/world_model.py::fill_evolution`.
 * Also loads under Node (`module.exports`) so `tests/test_static_demo.py` verifies exact Python parity.
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- math
  function erf(x) {
    // Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7)
    const s = x < 0 ? -1 : 1;
    const a = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * a);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return s * y;
  }
  const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };

  // ---------------------------------------------------------------- surrogate
  function encode(model, recipe) {
    return model.inputs.map((k) => {
      if (k === "is_27mhz") return recipe.freq_mhz > 20 ? 1 : 0;
      if (k === "is_trench") return recipe.feature_type === "trench" ? 1 : 0;
      return Number(recipe[k]);
    });
  }

  function forward(model, x) {
    let h = x.map((v, i) => (v - model.x_mean[i]) / model.x_std[i]);
    const nL = model.layers.length;
    model.layers.forEach((L, li) => {
      const nOut = L.b.length;
      const out = L.b.slice();
      for (let i = 0; i < h.length; i += 1) {
        const hi = h[i];
        const row = L.W[i];
        for (let j = 0; j < nOut; j += 1) out[j] += hi * row[j];
      }
      if (li < nL - 1) {
        for (let j = 0; j < nOut; j += 1) out[j] = model.activation === "relu" ? Math.max(0, out[j]) : Math.tanh(out[j]);
      }
      h = out;
    });
    return h;
  }

  function predictRaw(model, recipe) {
    const z = forward(model, encode(model, recipe));
    const out = {};
    model.outputs.forEach((o, k) => {
      let v = z[k] * o.std + o.mean;
      if (o.transform === "log") v = Math.exp(v);
      else if (o.transform === "logit") v = 1 / (1 + Math.exp(-v));
      if (o.clip) v = clamp(v, o.clip[0], o.clip[1]);
      out[o.name] = v;
    });
    return out;
  }

  // ---------------------------------------------------------------- non-rectangular fill evolution (port of world_model.py)
  const SUBSTEPS = 6;

  function moldHalfProfile(cd, nCells) {
    const half = cd / 2;
    return Array.from({ length: nCells }, (_, i) => {
      const zf = (i + 0.5) / nCells;
      const taper = 0.026 * (1 - 2 * zf);
      const flare = 0.042 * Math.exp(-zf / 0.045);
      const bow = zf < 0.48 ? 0.015 * Math.sin((Math.PI * zf) / 0.48) : 0;
      const floorRound = zf > 0.90 ? 0.16 * (((zf - 0.90) / 0.10) ** 2) : 0;
      return round(half * (1 + taper + flare + bow - floorRound), 2);
    });
  }

  function integrateFill(cd, depth, rate, bottomRate, nFrames) {
    const half = cd / 2;
    const nz = rate.length;
    const z = rate.map((_, i) => ((i + 0.5) * depth) / nz);
    const walls = new Array(nz).fill(0);
    let bottom = 0;
    const tEnd = (1.05 * half) / Math.max(Math.min(...rate), 1e-6);
    const dt = tEnd / ((nFrames - 1) * SUBSTEPS);
    const solidMask = () => walls.map((w, i) => w >= half - 1e-9 || z[i] >= depth - bottom);
    const openMask = (solid) => { let blocked = false; return solid.map((s) => { if (s) blocked = true; return !blocked; }); };
    const frames = [];
    let sealDepth = null;
    for (let k = 0; k < nFrames; k += 1) {
      if (k > 0) {
        for (let s = 0; s < SUBSTEPS; s += 1) {
          const solid = solidMask();
          const open = openMask(solid);
          for (let i = 0; i < nz; i += 1) if (open[i]) walls[i] = Math.min(half, walls[i] + dt * rate[i]);
          let last = -1;
          for (let i = 0; i < nz; i += 1) if (z[i] < depth - bottom) last = i;
          if (last >= 0 && open[last]) bottom = Math.min(depth, bottom + dt * bottomRate);
        }
      }
      const solidNow = solidMask();
      if (sealDepth === null && solidNow.some(Boolean)) {
        const first = solidNow.indexOf(true);
        if (first < nz - 1 && !solidNow.slice(first + 1).every(Boolean) && walls[first] >= half - 1e-9) {
          sealDepth = z[first];
        }
      }
      const allSolid = solidNow.every(Boolean);
      const mouthGap = Math.max(0, cd - 2 * walls[0]);
      const sag = allSolid ? 0 : round(0.22 * mouthGap * Math.min(1, bottom / Math.max(20, 0.25 * cd)), 2);
      frames.push({
        t: round(k / (nFrames - 1), 4),
        walls_nm: walls.map((w) => round(w, 2)),
        bottom_nm: round(bottom, 2),
        meniscus_sag_nm: sag,
      });
    }
    const solid = solidMask();
    const open = openMask(solid);
    const voidCells = [];
    for (let i = 0; i < nz; i += 1) if (!solid[i] && !open[i]) voidCells.push(i);
    let finalVoid = null;
    if (voidCells.length) {
      const widths = voidCells.map((i) => cd - 2 * walls[i]);
      let maxIdx = 0;
      for (let j = 1; j < widths.length; j += 1) if (widths[j] > widths[maxIdx]) maxIdx = j;
      const bellyIdx = voidCells[maxIdx];
      finalVoid = {
        top_nm: round(z[voidCells[0]] - (0.5 * depth) / nz, 1),
        bottom_nm: round(z[voidCells[voidCells.length - 1]] + (0.5 * depth) / nz, 1),
        belly_z_nm: round(z[bellyIdx], 1),
        max_width_nm: round(widths[maxIdx], 1),
        shape: "inverted_teardrop",
      };
    }
    return { z_nm: z.map((v) => round(v, 1)), frames, final_void: finalVoid, seal_depth_nm: sealDepth };
  }

  function fillEvolution(o) {
    const { cd, depth, vnet, ph, vw, ob, goal, fillH, upperWall } = o;
    const afmRms = o.afmRms != null ? o.afmRms : 1.45;
    const nFrames = o.nFrames || 48;
    const n = o.nCells || 50;
    const zf = Array.from({ length: n }, (_, i) => (i + 0.5) / n);
    let shape;
    if (vnet && vnet.length) {
      const m = vnet.length;
      shape = zf.map((f) => {
        const x = f * (m - 1);
        const i0 = Math.min(m - 2, Math.floor(x));
        return vnet[i0] + (vnet[i0 + 1] - vnet[i0]) * (x - i0);
      });
      const mx = Math.max(Math.max(...shape), 1e-6);
      shape = shape.map((v) => Math.max(v, 0.05 * mx));
      const mean = shape.reduce((a, b) => a + b, 0) / n;
      shape = shape.map((v) => v / mean);
    } else shape = new Array(n).fill(1);
    const voidFree = 0.986 * depth;
    const moldHalf = moldHalfProfile(cd, n);
    let res;
    if (goal === "partial_fill") {
      const target = clamp(fillH || 0, 0, depth);
      const wall = clamp(upperWall || 0, 0, 0.45 * cd);
      let taperW = zf.map((f) => 0.74 + 0.26 * (f ** 0.85));
      const twMax = Math.max(...taperW);
      taperW = taperW.map((v) => v / twMax);
      const frames = [];
      for (let k = 0; k < nFrames; k += 1) {
        const t = k / (nFrames - 1);
        const botT = target * t;
        const openCd = Math.max(0, cd - 2 * wall * t);
        const sag = round(0.24 * openCd * Math.min(1, botT / Math.max(20, 0.25 * cd)), 2);
        frames.push({
          t: round(t, 4),
          walls_nm: taperW.map((tw) => round(wall * t * tw, 2)),
          bottom_nm: round(botT, 2),
          meniscus_sag_nm: sag,
        });
      }
      res = {
        z_nm: zf.map((f) => round(f * depth, 1)),
        frames,
        final_void: null,
        seal_depth_nm: null,
        mode: "partial_fill",
        reconciled_to: { fill_height_nm: round(target, 1), upper_wall_nm: round(wall, 1) },
      };
    } else if (vw > 0.5 && ph < voidFree) {
      const zz = zf.map((f) => f * depth);
      const cell = depth / n;
      const zp = clamp(ph, 0.04 * depth, depth - 2.5 * cell);
      const w = clamp(vw, 1, 0.9 * cd);
      const width = Math.max(1.5 * cell, 0.045 * depth);
      let ip = 0;
      zz.forEach((v, i) => { if (Math.abs(v - zp) < Math.abs(zz[ip] - zp)) ip = i; });
      const amp = w / (cd - w);
      const taperAmp = Math.min(0.22, 0.55 * amp);
      const bellyCurve = zz.map((v) => {
        const u = clamp((v - zp) / Math.max(cell, depth - zp), 0, 1);
        return 1 + taperAmp * (((u - 0.34) / 0.66) ** 2);
      });
      if (ip + 1 < n) {
        const minBelly = Math.min(...bellyCurve.slice(ip + 1));
        for (let i = ip + 1; i < n; i += 1) bellyCurve[i] /= minBelly;
      }
      const rate = zz.map((v, i) => {
        const base = i < ip ? 0.88 + 0.12 * shape[i] : i === ip ? 1.0 : bellyCurve[i];
        return base * (1 + amp * Math.exp(-(((v - zz[ip]) / width) ** 2)));
      });
      const rp = rate[ip];
      const capBelow = 1 + 0.88 * (rp - 1);
      for (let i = ip + 1; i < n; i += 1) rate[i] = Math.min(rate[i], capBelow);
      for (let i = ip - 1; i >= 0; i -= 1) rate[i] = Math.min(rate[i], rate[i + 1]);
      for (let i = 0; i < ip; i += 1) rate[i] = Math.min(rate[i], 0.999 * rp);
      res = integrateFill(cd, depth, rate, 0.25, nFrames);
      res.mode = "keyhole";
      res.reconciled_to = { ph_nm: round(ph, 1), void_width_nm: round(vw, 1) };
    } else {
      const rate = [];
      shape.forEach((v, i) => rate.push(i === 0 ? v : Math.max(v, rate[i - 1])));
      res = integrateFill(cd, depth, rate, rate[n - 1] * 1.2, nFrames);
      res.mode = "void_free";
      res.reconciled_to = { ph_nm: round(Math.min(ph, depth), 1), void_width_nm: 0 };
    }
    const isVoidFree = res.mode === "void_free";
    res.frames.forEach((fr) => {
      const t = fr.t;
      const obT = round(ob * t, 2);
      fr.ob_nm = obT;
      const mouthOpenFrac = Math.max(0, 1 - (2 * fr.walls_nm[0]) / Math.max(1e-6, cd));
      if (mouthOpenFrac > 0.05) {
        fr.crown_nm = round(-Math.min(0.45 * obT, 0.16 * cd * mouthOpenFrac), 2);
      } else if (isVoidFree) {
        fr.crown_nm = round(0.08 * obT, 2);
      } else {
        fr.crown_nm = round(-0.06 * Math.min(obT, cd), 2);
      }
      fr.afm_rms_nm = round(0.35 + Math.max(0, afmRms - 0.35) * Math.sqrt(t), 2);
    });
    Object.assign(res, {
      cd_nm: cd,
      depth_nm: depth,
      half_cd_nm: cd / 2,
      mold_half_nm: moldHalf,
      mold_taper_deg: 89.25,
      afm_rms_nm: round(afmRms, 2),
    });
    return res;
  }

  // ---------------------------------------------------------------- rule conditions (AST exported by the build)
  function evalAst(node, env) {
    switch (node.t) {
      case "and": return node.v.every((c) => evalAst(c, env));
      case "or": return node.v.some((c) => evalAst(c, env));
      case "not": return !evalAst(node.v, env);
      case "neg": return -evalAst(node.v, env);
      case "pos": return +evalAst(node.v, env);
      case "bin": {
        const a = evalAst(node.l, env), b = evalAst(node.r, env);
        if (node.op === "+") return a + b;
        if (node.op === "-") return a - b;
        if (node.op === "*") return a * b;
        return b === 0 ? NaN : a / b;
      }
      case "cmp": {
        let left = evalAst(node.l, env);
        for (let i = 0; i < node.ops.length; i += 1) {
          const right = evalAst(node.r[i], env);
          const op = node.ops[i];
          const ok = op === "<" ? left < right : op === "<=" ? left <= right : op === ">" ? left > right : op === ">=" ? left >= right : op === "==" ? left === right : left !== right;
          if (!ok) return false;
          left = right;
        }
        return true;
      }
      case "name": return env[node.id];
      case "num": return node.v;
      default: return false;
    }
  }

  // ---------------------------------------------------------------- world-model & studio responses
  function likelihood(p) { return p >= 0.8 ? "likely" : p <= 0.2 ? "unlikely" : "uncertain"; }

  function specLines(spec, post, unc, plasma, goal) {
    const lines = [];
    if (goal === "partial_fill") {
      const h = post.fill_height_110_nm || 0, s = unc.fill_height_110_std || 55;
      const lo = spec.fill_height_target_nm - spec.fill_height_tol_nm, hi = spec.fill_height_target_nm + spec.fill_height_tol_nm;
      lines.push({ line: "fill_height", label: "Fill height 110 nm", target: `${lo.toFixed(0)}–${hi.toFixed(0)} nm`, predicted: `${h.toFixed(0)} ± ${s.toFixed(0)} nm`, prob: round(Phi((hi - h) / s) - Phi((lo - h) / s), 3) });
    } else {
      [["ph_depth_110_nm", "ph_depth_110_std", "PH depth 110 nm"], ["ph_depth_225_nm", "ph_depth_225_std", "PH depth 225 nm"]].forEach(([k, sk, label]) => {
        lines.push({ line: k, label, target: `≥ ${spec.ph_min_nm.toFixed(0)} nm`, predicted: `${post[k].toFixed(0)} ± ${unc[sk].toFixed(0)} nm`, prob: round(Phi((post[k] - spec.ph_min_nm) / unc[sk]), 3) });
      });
    }
    lines.push({ line: "ob", label: "Overburden", target: `≤ ${spec.ob_max_nm.toFixed(0)} nm`, predicted: `${post.ob_nm.toFixed(0)} ± ${unc.ob_std.toFixed(0)} nm`, prob: round(Phi((spec.ob_max_nm - post.ob_nm) / unc.ob_std), 3) });
    if (!spec.crack_allowed) lines.push({ line: "crack", label: "No crack", target: "no crack", predicted: `${Math.round(post.crack_prob * 100)}% crack risk`, prob: round(1 - post.crack_prob, 3) });
    if (spec.density_min_g_cm3 != null) {
      const pDens = Phi((plasma.film_density_g_cm3 - spec.density_min_g_cm3) / 0.025);
      lines.push({ line: "density", label: "Film density (model estimate)", target: `≥ ${spec.density_min_g_cm3.toFixed(2)} g/cm³`, predicted: `${plasma.film_density_g_cm3.toFixed(2)} g/cm³`, prob: round(pDens, 3) });
    }
    if (spec.afm_rq_max_nm != null && post.afm_rms_nm != null) {
      const pAfm = Phi((spec.afm_rq_max_nm - post.afm_rms_nm) / 0.12);
      lines.push({ line: "afm_rq", label: "AFM roughness Rq", target: `≤ ${Number(spec.afm_rq_max_nm).toFixed(2)} nm`, predicted: `${Number(post.afm_rms_nm).toFixed(2)} nm`, prob: round(pAfm, 3) });
    }
    lines.forEach((l) => { l.status = likelihood(l.prob); });
    return lines;
  }

  function nearestMeasured(D, recipe, k) {
    const keys = Object.keys(D.parameter_bounds);
    const rows = [];
    (D.brain.experiments || []).forEach((e) => {
      if (e.provenance !== "measured") return;
      let s = 0;
      keys.forEach((c) => {
        const [lo, hi] = D.parameter_bounds[c];
        const v = Number(e.recipe[c]);
        if (Number.isFinite(v)) s += ((recipe[c] - v) / (hi - lo)) ** 2;
      });
      const m = e.measured || {};
      rows.push({
        exp_id: e.exp_id,
        distance: round(Math.sqrt(s), 3),
        sem_image_path: e.sem_image_path || "",
        recipe: e.recipe,
        measured: {
          ph_depth_110_nm: m.ph_depth_110_nm,
          ph_depth_225_nm: m.ph_depth_225_nm,
          fill_height_110_nm: m.fill_height_110_nm,
          ob_nm: m.ob_nm,
          void_width_110_nm: m.void_width_110_nm,
          afm_rms_nm: m.afm_rms_nm,
          crack_detected: m.crack_detected,
          nodule_defect: m.nodule_defect,
        },
      });
    });
    rows.sort((a, b) => a.distance - b.distance);
    return rows.slice(0, k);
  }

  function fullRecipe(D, recipe) {
    const r = { ...D.defaults, ...recipe };
    r.nc_ratio = r.c2h2_sccm > 0 ? round(r.nh3_sccm / r.c2h2_sccm, 4) : 0;
    r.gap_mm = round(r.gap_mils * 0.0254, 3);
    return r;
  }

  function posteriorOf(D, raw, r) {
    const vf = D.void_free_fraction * r.depth_nm;
    const ph110 = clamp(raw.ph_depth_110_nm, 250, r.depth_nm);
    const ph225 = clamp(raw.ph_depth_225_nm, 350, r.depth_nm);
    const vw110 = ph110 >= vf ? 0 : round(r.hole_cd_nm * Math.min(0.5, (1 - ph110 / r.depth_nm) * 1.15), 1);
    const vw225 = ph225 >= vf ? 0 : round(r.wide_cd_nm * Math.min(0.42, (1 - ph225 / r.depth_nm) * 0.95), 1);
    const afmRms = round(raw["plasma.afm_rms_nm"] != null ? raw["plasma.afm_rms_nm"] : 1.45, 2);
    const openThroat = Math.max(6, r.hole_cd_nm - 2 * raw.upper_wall_nm);
    return {
      ph_depth_110_nm: round(ph110, 1),
      ph_depth_225_nm: round(ph225, 1),
      fill_height_110_nm: round(raw.fill_height_110_nm, 1),
      ob_nm: round(raw.ob_nm, 1),
      dual_cd_step_nm: round(raw.dual_cd_step_nm, 1),
      void_width_110_nm: vw110,
      void_width_225_nm: vw225,
      upper_wall_nm: round(raw.upper_wall_nm, 1),
      superconformal: raw.superconformal >= 0.5,
      pinched_before_target: vw110 > 0,
      crack_prob: round(raw.crack_prob, 3),
      nodule_risk: round(raw.nodule_risk, 3),
      afm_rms_nm: afmRms,
      mold_taper_deg: r.feature_type === "trench" ? 89.4 : 89.22,
      neck_depth_nm: round(clamp(r.hole_cd_nm * 1.25, 55, 0.38 * r.depth_nm), 1),
      meniscus_concavity_nm: round(vw110 === 0 && raw.fill_height_110_nm >= vf ? 0 : 0.24 * openThroat, 1),
      crown_recess_nm: round(vw110 === 0 ? 0.09 * raw.ob_nm : -0.14 * Math.min(raw.ob_nm, r.hole_cd_nm), 1),
    };
  }

  function uncertaintyOf(raw) {
    return {
      ph_depth_110_std: round(raw.ph_depth_110_std, 1),
      ph_depth_225_std: round(raw.ph_depth_225_std, 1),
      fill_height_110_std: round(raw.fill_height_110_std, 1),
      ob_std: round(raw.ob_std, 1),
      crack_std: round(raw.crack_std, 3),
    };
  }

  function nodeActivationsOf(r, plasma, post) {
    const c01 = (v) => round(clamp(v, 0.04, 0.98), 3);
    const gc = Math.max(0.3, plasma.gamma_c2hx || 0.8);
    const gh = plasma.gamma_h_nhx || 0.9;
    return {
      freq_mhz: r.freq_mhz > 20 ? 0.94 : 0.30,
      power_w: c01((r.power_w - 1100) / 950),
      gap_mils: c01((r.gap_mils - 400) / 100),
      pressure_torr: c01((r.pressure_torr - 14) / 8),
      ar_sccm: c01((r.ar_sccm - 7000) / 5000),
      c2h2_sccm: c01((r.c2h2_sccm - 600) / 100),
      nh3_sccm: c01((r.nh3_sccm - 150) / 100),
      temp_c: c01((r.temp_c - 530) / 50),
      ne_dissoc: c01(((plasma.ne_1e10_cm3 || 3) - 1.5) / 8.5),
      ion_energy: c01(((plasma.ion_energy_ev || 15) - 4) / 30),
      hcn_passiv: c01(0.55 * (plasma.hcn_scavenging || 0.5) + 0.35 * (gh / gc)),
      dust_margin: c01(((plasma.dust_margin || 1.3) - 0.5) / 2.2),
      oes_actinometry: c01(((plasma.oes_cn_ar || 0.5) - 0.15) / 0.65),
      rf_harmonics: c01(((plasma.rf_3w_1w_pct || 8.0) - 4.0) / 9.0),
      beta_inv: c01(1.0 - ((plasma.beta_eff || 0.01) - 0.002) / 0.032),
      top_etch: c01((plasma.top_etch_diff || 0.5) / 0.95),
      stress_state: c01(((plasma.stress_mpa || 280) - 150) / 320),
      ph_depth: c01((post.ph_depth_110_nm - 500) / 500),
      ob_nm: c01((post.ob_nm - 30) / 260),
      crack_risk: c01(post.crack_prob),
    };
  }

  function simulate(D, M, recipe, goal) {
    const r = fullRecipe(D, recipe);
    const raw = predictRaw(M, r);
    const post = posteriorOf(D, raw, r);
    const unc = uncertaintyOf(raw);
    const plasma = {};
    M.plasma_outputs.forEach((k) => { plasma[k] = round(raw[`plasma.${k}`], k === "beta_eff" ? 5 : 3); });
    const vf = D.void_free_fraction * r.depth_nm;
    const env = { ...r, ob_nm: raw["layer.cal_ob"], dust_margin: plasma.dust_margin, ion_energy_ev: plasma.ion_energy_ev, beta_eff: plasma.beta_eff };
    const fired = (D.rules || []).filter((rule) => rule.ast && evalAst(rule.ast, env)).map((rule) => rule.title);
    const layer = (target, u, c, s, p) => ({ target, uncalibrated_sim: round(u, 1), calibrated_physics: round(c, 1), human_rule_shift: round(s, 1), data_correction: round(p - c - s, 1), posterior: p });
    const vnet110 = M.profile_outputs.map((k) => round(raw[`v110.${k}`], 2));
    const vnet225 = M.profile_outputs.map((k) => round(raw[`v225.${k}`], 2));
    const nearest = nearestMeasured(D, r, 3);
    const ob225 = Math.max(0, post.ob_nm - (post.dual_cd_step_nm || 0));
    const zScale = r.depth_nm / 1000;
    const zGrid = M.profile_z_nm.map((z) => round(z * zScale, 2));
    const depthProfile = {
      feature_type: r.feature_type,
      z_nm: zGrid,
      v_net_nm_min_110: vnet110,
      v_net_nm_min_225: vnet225,
      superconformal_110: vnet110[vnet110.length - 1] > vnet110[0],
      pinched_before_target: post.void_width_110_nm > 0,
    };
    return {
      brain_version: D.brain.brain_version,
      goal,
      recipe: r,
      client_spec: D.client_spec,
      posterior: post,
      uncertainty: unc,
      plasma,
      extrapolation: { outside_window: nearest.length ? nearest[0].distance > 1.8 : false, nearest_measured_distance: nearest.length ? nearest[0].distance : null },
      human_priors: {
        acq_multiplier: 1.0,
        triggered_rules: fired,
        shifts: { ph110: round(raw["layer.shift_ph110"], 1), ph225: 0, ob: round(raw["layer.shift_ob"], 1), crack: 0 },
      },
      depth_profile: depthProfile,
      layers: [
        layer("PH depth 110 nm", raw["layer.uncal_ph110"], raw["layer.cal_ph110"], raw["layer.shift_ph110"], post.ph_depth_110_nm),
        layer("Overburden", raw["layer.uncal_ob"], raw["layer.cal_ob"], raw["layer.shift_ob"], post.ob_nm),
      ],
      p_void_free_110: round(Phi((post.ph_depth_110_nm - vf) / unc.ph_depth_110_std), 3),
      p_void_free_225: round(Phi((post.ph_depth_225_nm - vf) / unc.ph_depth_225_std), 3),
      p_meets_spec: round(goal === "partial_fill" ? raw.p_spec_partial : raw.p_spec_plug, 3),
      spec_lines: specLines(D.client_spec, post, unc, plasma, goal),
      nearest_measured: nearest,
      data_basis: D.data_basis,
      features: {
        110: fillEvolution({ cd: r.hole_cd_nm, depth: r.depth_nm, vnet: vnet110, ph: post.ph_depth_110_nm, vw: post.void_width_110_nm, ob: post.ob_nm, goal, fillH: post.fill_height_110_nm, upperWall: post.upper_wall_nm, afmRms: post.afm_rms_nm }),
        225: fillEvolution({ cd: r.wide_cd_nm, depth: r.depth_nm, vnet: vnet225, ph: post.ph_depth_225_nm, vw: post.void_width_225_nm, ob: ob225, goal, fillH: post.fill_height_110_nm, upperWall: post.upper_wall_nm, afmRms: post.afm_rms_nm }),
      },
    };
  }

  function predictStudio(D, M, recipe) {
    const sim = simulate(D, M, recipe || {}, "plug_fill");
    const r = sim.recipe;
    const raw = predictRaw(M, r);
    return {
      recipe: r,
      plasma: sim.plasma,
      extrapolation: sim.extrapolation,
      node_activations: nodeActivationsOf(r, sim.plasma, sim.posterior),
      uncalibrated_sim: {
        ph_depth_110_nm: round(raw["layer.uncal_ph110"], 1),
        ob_nm: round(raw["layer.uncal_ob"], 1),
        crack_prob: round(clamp(raw.crack_prob * 0.9, 0.01, 0.99), 3),
      },
      calibrated_physics: {
        ph_depth_110_nm: round(raw["layer.cal_ph110"], 1),
        ob_nm: round(raw["layer.cal_ob"], 1),
        crack_prob: sim.posterior.crack_prob,
        dual_cd_step_nm: sim.posterior.dual_cd_step_nm,
        fill_height_110_nm: sim.posterior.fill_height_110_nm,
        superconformal: sim.posterior.superconformal,
        pinched_before_target: sim.posterior.pinched_before_target,
      },
      pang_posterior: sim.posterior,
      uncertainty: sim.uncertainty,
      human_priors: sim.human_priors,
      depth_profile: sim.depth_profile,
    };
  }

  function sweep(D, M, recipe, goal) {
    const base = fullRecipe(D, recipe);
    const knobs = D.knobs.map((k) => {
      const xs = k.values ? k.values.slice() : Array.from({ length: D.sweep_points }, (_, i) => k.lo + ((k.hi - k.lo) * i) / (D.sweep_points - 1));
      const series = { x: [], ph110: [], ph110_std: [], ph225: [], ph225_std: [], ob: [], ob_std: [], afm_rms: [], crack: [], fill_h: [], fill_h_std: [], p_spec: [] };
      xs.forEach((x) => {
        const r = fullRecipe(D, { ...base, [k.key]: x });
        const raw = predictRaw(M, r);
        const post = posteriorOf(D, raw, r);
        series.x.push(x);
        series.ph110.push(post.ph_depth_110_nm); series.ph110_std.push(round(raw.ph_depth_110_std, 1));
        series.ph225.push(post.ph_depth_225_nm); series.ph225_std.push(round(raw.ph_depth_225_std, 1));
        series.ob.push(post.ob_nm); series.ob_std.push(round(raw.ob_std, 1));
        series.afm_rms.push(post.afm_rms_nm);
        series.crack.push(post.crack_prob);
        series.fill_h.push(post.fill_height_110_nm); series.fill_h_std.push(round(raw.fill_height_110_std, 1));
        series.p_spec.push(round(goal === "partial_fill" ? raw.p_spec_partial : raw.p_spec_plug, 4));
      });
      return { key: k.key, label: k.label, unit: k.unit, current: base[k.key], series };
    });
    return { brain_version: D.brain.brain_version, goal, client_spec: D.client_spec, knobs };
  }

  function optimize(D, body) {
    const goal = body.goal || "plug_fill";
    let rows = (D.optimizer[goal] || []).slice();
    if (body.freq_filter && body.freq_filter !== "both") rows = rows.filter((s) => Math.abs(s.recipe.freq_mhz - Number(body.freq_filter)) < 0.01);
    if (body.allow_two_step === false) rows = rows.filter((s) => !(s.recipe.trim_fraction > 0));
    rows = rows.slice(0, body.batch_size || 3).map((s, i) => ({ ...s, rank: i + 1 }));
    return { brain_version: D.brain.brain_version, goal, logged: false, precomputed: true, suggestions: rows };
  }

  function recommendStudio(D, body) {
    const goal = (body && body.goal) || "plug_fill";
    let rows = ((D.optimizer_studio && D.optimizer_studio[goal]) || []).slice();
    if (body && body.freq_filter && body.freq_filter !== "both") {
      rows = rows.filter((s) => Math.abs(s.prediction.recipe.freq_mhz - Number(body.freq_filter)) < 0.01);
    }
    if (body && body.allow_two_step === false) {
      rows = rows.filter((s) => !(s.prediction.recipe.trim_fraction > 0));
    }
    rows = rows.slice(0, (body && body.batch_size) || 3).map((s, i) => ({ ...s, rank: i + 1 }));
    return {
      workspace: "static_demo",
      brain_version: D.brain.brain_version,
      goal,
      logged_predictions: false,
      suggestions: rows,
    };
  }

  function molecularSimulateStatic(D, M, body) {
    const r = fullRecipe(D, (body && body.recipe) || {});
    let key = "optimal_vhf_passivated_achn";
    if (r.temp_c >= 568 && r.nh3_sccm < 210) key = "high_temp_graphitic_crosslinked";
    else if (r.trim_fraction >= 0.15 || r.nc_ratio >= 0.39) key = "high_n_trim_nitrile_surface";
    else if (r.nc_ratio < 0.28 || r.freq_mhz < 20) key = "low_n_polymeric_ach";
    const arch = (D.molecular_archetypes && D.molecular_archetypes[key]) || null;
    if (!arch) throw new Error("Static molecular archetype bundle not found");
    const pred = predictStudio(D, M, r);
    return {
      ...arch,
      recipe: r,
      coupled_continuum: {
        plasma: pred.plasma,
        posterior: pred.pang_posterior,
      },
    };
  }

  const KB_SHORT_REASON_LABELS = {
    vhf_27mhz: "VHF 27–60 MHz",
    hf_13mhz: "13.56 MHz CCP",
    dual_freq: "Dual-Freq/Harmonic",
    pulsed_rf: "Pulsed/Cyclic RF",
    dc_icp_other: "ICP/Sputter/Atomistic",
    high_p_torr: "High-P Torr PECVD",
    sub_torr: "Sub-Torr Transition",
    low_p_mtorr: "Low-P mTorr",
    high_t_450_650c: "High-T 450–650 °C",
    mid_t_200_449c: "Mid-T 200–449 °C",
    low_t_rt_200c: "Low-T RT–200 °C",
    c2h2_nh3_n2: "C₂H₂ + NH₃/N₂",
    c2h2_ar_hydrocarbon: "C₂H₂/CₓHᵧ + Ar",
    n_doped_carbon: "N-Doped a-C",
    nh3_h2_o2_trim: "H₂/NH₃/O₂ Trim",
    fluorocarbon_har_etch: "CₓFᵧ/O₂ Selectivity",
    ar_inert_model: "Ar/Model CCP",
    via_hole_3d: "3D Via/Hole",
    trench_2d: "2D Trench",
    har_ge_8: "HAR AR ≥ 8",
    mod_ar_2_8: "Moderate AR",
    planar_blanket: "Blanket/Bulk",
    plug_fill: "Plug Gap-Fill",
    partial_fill: "Partial Fill",
    dep_trim_cyclic: "Cyclic Dep-Trim",
    hardmask_selectivity: "Hardmask ρ/Stress/Etch",
    dust_suppression: "Dust/Nodule Control",
    sem_tem: "SEM/HRTEM",
    afm_xrr_xps: "AFM/XRR/XPS/Raman",
    oes_rf_sensors: "OES/QMS/3ω RF",
    knudsen_levelset: "Knudsen/Level-Set",
    pic_fluid_ccp: "PIC-MCC/Fluid CCP",
    md_dft_reaxff: "MD/ReaxFF/DFT",
    bo_ml_surrogate: "BO/ML Surrogate/VM",
  };

  function fmtRangeStatic(lo, hi, unit) {
    const f = (v) => Number(Number(v).toPrecision(6)).toString();
    if (Math.abs(hi - lo) < 1e-6) return `${f(lo)} ${unit}`.trim();
    return `${f(lo)}–${f(hi)} ${unit}`.trim();
  }

  function deriveFacetsFromRecipeStatic(recipe, goal) {
    const r = recipe || {};
    const freq = Number(r.freq_mhz ?? 27.12);
    const pres = Number(r.pressure_torr ?? 18.5);
    const temp = Number(r.temp_c ?? 555.0);
    const arFlow = Number(r.ar_sccm ?? 11000.0);
    const c2h2 = Number(r.c2h2_sccm ?? 620.0);
    const nh3 = Number(r.nh3_sccm ?? 225.0);
    const cd = Math.max(10.0, Number(r.hole_cd_nm ?? 110.0));
    const depth = Math.max(50.0, Number(r.depth_nm ?? 1000.0));
    const ftype = String(r.feature_type || "hole");
    const trim = Number(r.trim_fraction ?? 0.0);
    const arVal = depth / cd;
    const ncRatio = nh3 / Math.max(1.0, c2h2);

    const rf_regime = freq >= 20.0 ? "vhf_27mhz" : "hf_13mhz";
    const pressure_regime = pres >= 1.5 ? "high_p_torr" : pres >= 0.15 ? "sub_torr" : "low_p_mtorr";
    const temp_regime = temp >= 450.0 ? "high_t_450_650c" : temp >= 200.0 ? "mid_t_200_449c" : "low_t_rt_200c";
    const chemistry = c2h2 > 0 && nh3 >= 40.0 ? "c2h2_nh3_n2" : c2h2 > 0 ? "c2h2_ar_hydrocarbon" : "ar_inert_model";
    const geometry = ftype === "trench" ? "trench_2d" : "via_hole_3d";
    const secondary_geometries = arVal >= 8.0 ? ["har_ge_8"] : ["mod_ar_2_8"];
    const process_mode = goal === "partial_fill" ? "partial_fill" : "plug_fill";
    const secondary_modes = ["hardmask_selectivity"];
    if (trim >= 0.04) secondary_modes.unshift("dep_trim_cyclic");
    if (pres >= 19.5 || arFlow <= 8500.0) secondary_modes.unshift("dust_suppression");

    const summary =
      `${freq.toFixed(2)} MHz (${freq >= 20 ? "VHF" : "HF"}) · ` +
      `${pres.toFixed(1)} Torr · ${temp.toFixed(0)} °C · ` +
      `Ar ${(arFlow / 1000).toFixed(1)}k / C₂H₂ ${c2h2.toFixed(0)} / NH₃ ${nh3.toFixed(0)} (N/C ${ncRatio.toFixed(2)}) · ` +
      `${ftype === "trench" ? "2D Trench" : "3D Hole"} CD ${cd.toFixed(0)} nm (AR ${arVal.toFixed(1)}) · ` +
      `${goal === "partial_fill" ? "Partial Fill" : "Plug Fill"}` +
      (trim >= 0.02 ? ` + ${Math.round(trim * 100)}% Trim` : "");

    return {
      filters: { rf_regime, pressure_regime, temp_regime, chemistry, geometry, process_mode, method: "any" },
      numeric_targets: {
        freq_mhz: round(freq, 2),
        pressure_torr: round(pres, 4),
        temp_c: round(temp, 1),
        aspect_ratio: round(arVal, 2),
      },
      secondary_geometries,
      secondary_modes,
      has_pulsed_or_trim: trim >= 0.04,
      summary,
    };
  }

  function scoreNumericProximityStatic(nw, targets) {
    let earned = 0.0;
    let possible = 0.0;
    const reasons = [];
    const notes = [];
    const numFmt = (v) => Number(Number(v).toPrecision(6)).toString();

    const pVal = targets.pressure_torr;
    const pRng = nw.pressure_torr_range;
    if (pVal != null && pVal > 0 && Array.isArray(pRng) && pRng.length === 2 && pRng[0] > 0) {
      possible += 12.0;
      const lo = Number(pRng[0]);
      const hi = Number(pRng[1]);
      if (lo <= pVal && pVal <= hi) {
        earned += 12.0;
        reasons.push(`P=${numFmt(pVal)}T ∈ [${fmtRangeStatic(lo, hi, "T")}]`);
      } else {
        const edge = pVal < lo ? lo : hi;
        const dec = Math.abs(Math.log10(Math.max(1e-6, pVal)) - Math.log10(Math.max(1e-6, edge)));
        earned += 12.0 * Math.max(0.0, 1.0 - dec / 2.2);
        if (dec >= 1.4) notes.push(`Pressure gap ${dec.toFixed(1)} decades (paper: ${fmtRangeStatic(lo, hi, "Torr")})`);
      }
    }

    const tVal = targets.temp_c;
    const tRng = nw.temp_c_range;
    if (tVal != null && Array.isArray(tRng) && tRng.length === 2) {
      possible += 10.0;
      const lo = Number(tRng[0]);
      const hi = Number(tRng[1]);
      if (lo <= tVal && tVal <= hi) {
        earned += 10.0;
        reasons.push(`T=${tVal.toFixed(0)}°C ∈ [${fmtRangeStatic(lo, hi, "°C")}]`);
      } else {
        const diff = tVal < lo ? lo - tVal : tVal - hi;
        earned += 10.0 * Math.max(0.0, 1.0 - diff / 260.0);
        if (diff >= 220.0) notes.push(`Temp gap ${diff.toFixed(0)} °C (paper: ${fmtRangeStatic(lo, hi, "°C")})`);
      }
    }

    const fVal = targets.freq_mhz;
    const fRng = nw.freq_mhz_range;
    if (fVal != null && fVal > 0 && Array.isArray(fRng) && fRng.length === 2 && fRng[0] > 0) {
      possible += 10.0;
      const lo = Number(fRng[0]);
      const hi = Number(fRng[1]);
      if (lo <= fVal && fVal <= hi) {
        earned += 10.0;
        reasons.push(`RF=${numFmt(fVal)}MHz ∈ [${fmtRangeStatic(lo, hi, "MHz")}]`);
      } else {
        const edge = fVal < lo ? lo : hi;
        const octaves = Math.abs(Math.log2(Math.max(0.1, fVal)) - Math.log2(Math.max(0.1, edge)));
        earned += 10.0 * Math.max(0.0, 1.0 - octaves / 2.0);
      }
    }

    const arVal = targets.aspect_ratio;
    const arRng = nw.ar_range;
    if (arVal != null && arVal >= 0 && Array.isArray(arRng) && arRng.length === 2) {
      possible += 10.0;
      const lo = Number(arRng[0]);
      const hi = Number(arRng[1]);
      if (lo <= arVal && arVal <= hi) {
        earned += 10.0;
        reasons.push(`AR=${numFmt(arVal)} ∈ [${fmtRangeStatic(lo, hi, ":1")}]`);
      } else {
        const diff = arVal < lo ? lo - arVal : arVal - hi;
        earned += 10.0 * Math.max(0.0, 1.0 - diff / 8.0);
      }
    }

    return { earned, possible, reasons, notes };
  }

  function scorePaperForConfigStatic(paper, filters, numericTargets, secGeoms, secModes, hasPulsed) {
    const cp = paper.config_profile || {};
    const rfList = cp.rf_regimes || [];
    const pList = cp.pressure_regimes || [];
    const tList = cp.temp_regimes || [];
    const cList = cp.chemistries || [];
    const gList = cp.geometries || [];
    const mList = cp.process_modes || [];
    const dList = cp.methods_diagnostics || [];
    const nw = cp.numeric_windows || {};
    const fidelity = cp.regime_fidelity || "analogous_extrapolated";

    let earned = 0.0;
    let possible = 0.0;
    const reasons = [];
    const notes = [];
    const lbl = (k) => KB_SHORT_REASON_LABELS[k] || k;

    const chemReq = filters.chemistry || "any";
    if (chemReq !== "any") {
      possible += 24.0;
      if (cList.includes(chemReq)) {
        earned += 24.0;
        reasons.push(lbl(chemReq));
      } else if (chemReq === "c2h2_nh3_n2" && (cList.includes("n_doped_carbon") || cList.includes("c2h2_ar_hydrocarbon"))) {
        earned += 14.0;
        reasons.push(lbl(cList.includes("n_doped_carbon") ? "n_doped_carbon" : "c2h2_ar_hydrocarbon"));
      } else if (chemReq === "n_doped_carbon" && cList.includes("c2h2_nh3_n2")) {
        earned += 16.0;
        reasons.push(lbl("c2h2_nh3_n2"));
      } else if (cList.includes("ar_inert_model")) {
        earned += 5.0;
        notes.push("Inert/model precursor chemistry (transport/sheath scaling)");
      }
    }

    const geomReq = filters.geometry || "any";
    if (geomReq !== "any") {
      possible += 20.0;
      const hasPrimaryG = gList.includes(geomReq);
      const matchedSecG = (secGeoms || []).filter((g) => gList.includes(g));
      if (hasPrimaryG && matchedSecG.length) {
        earned += 20.0;
        reasons.push(`${lbl(geomReq)} + ${lbl(matchedSecG[0])}`);
      } else if (hasPrimaryG) {
        earned += (secGeoms && secGeoms.length) ? 14.0 : 16.0;
        reasons.push(lbl(geomReq));
      } else if (matchedSecG.length) {
        earned += 12.0;
        reasons.push(lbl(matchedSecG[0]));
      } else if ((geomReq === "via_hole_3d" || geomReq === "trench_2d") && (gList.includes("trench_2d") || gList.includes("via_hole_3d"))) {
        earned += 9.0;
        notes.push(`2D/3D view-factor difference (${lbl(gList.includes("trench_2d") ? "trench_2d" : "via_hole_3d")})`);
      } else if (gList.includes("planar_blanket")) {
        earned += 4.0;
        notes.push("Planar blanket / bulk study (no feature-scale shadowing)");
      }
    }

    const modeReq = filters.process_mode || "any";
    if (modeReq !== "any") {
      possible += 18.0;
      let modePts = 0.0;
      if (mList.includes(modeReq)) {
        modePts += (secModes && secModes.length) ? 13.0 : 18.0;
        reasons.push(lbl(modeReq));
      }
      const matchedSecM = (secModes || []).filter((m) => mList.includes(m) && m !== modeReq);
      if (matchedSecM.length) {
        modePts = Math.min(18.0, modePts + (modePts > 0 ? 5.0 : 10.0));
        reasons.push(lbl(matchedSecM[0]));
      }
      earned += modePts;
    }

    const rfReq = filters.rf_regime || "any";
    if (rfReq !== "any") {
      possible += 14.0;
      if (rfList.includes(rfReq)) {
        earned += 14.0;
        reasons.push(lbl(rfReq));
      } else if (hasPulsed && rfList.includes("pulsed_rf")) {
        earned += 10.0;
        reasons.push(lbl("pulsed_rf"));
      } else if ((rfReq === "vhf_27mhz" || rfReq === "hf_13mhz") && (rfList.includes("dual_freq") || rfList.includes("hf_13mhz") || rfList.includes("vhf_27mhz"))) {
        earned += 7.0;
        notes.push("Adjacent RF frequency CCP scaling");
      }
    }

    const presReq = filters.pressure_regime || "any";
    if (presReq !== "any") {
      possible += 12.0;
      if (pList.includes(presReq)) {
        earned += 12.0;
        reasons.push(lbl(presReq));
      } else if (pList.includes("sub_torr") || presReq === "sub_torr") {
        earned += 7.0;
        notes.push("Sub-Torr transition pressure");
      } else if (presReq === "high_p_torr" && pList.includes("low_p_mtorr")) {
        earned += 2.0;
        notes.push("Low-P mTorr plasma — extrapolate sheath/Knudsen trend only");
      }
    }

    const tempReq = filters.temp_regime || "any";
    if (tempReq !== "any") {
      possible += 12.0;
      if (tList.includes(tempReq)) {
        earned += 12.0;
        reasons.push(lbl(tempReq));
      } else if (tList.includes("mid_t_200_449c") || tempReq === "mid_t_200_449c") {
        earned += 6.0;
      } else if (tempReq === "high_t_450_650c" && tList.includes("low_t_rt_200c")) {
        earned += 2.0;
        notes.push("Low-T (<200 °C) film — higher H retention than 550 °C ACL");
      }
    }

    const methodReq = filters.method || "any";
    if (methodReq !== "any") {
      possible += 18.0;
      if (dList.includes(methodReq)) {
        earned += 18.0;
        reasons.push(lbl(methodReq));
      }
    }

    if (numericTargets && Object.keys(numericTargets).length) {
      const np = scoreNumericProximityStatic(nw, numericTargets);
      earned += np.earned;
      possible += np.possible;
      np.reasons.forEach((r) => {
        if (!reasons.includes(r)) reasons.push(r);
      });
      np.notes.forEach((n) => {
        if (!notes.includes(n)) notes.push(n);
      });
    }

    const fidelityBonus = fidelity === "exact_pecvd_har" ? 6.0 : fidelity === "direct_subsystem" ? 3.0 : 0.0;
    let rawPct;
    if (possible <= 0.0) {
      rawPct = 76.0 + fidelityBonus * 3.0;
      [rfList[0], pList[0], cList[0], gList[0]].filter(Boolean).forEach((it) => reasons.push(lbl(it)));
    } else {
      const basePct = 100.0 * (earned / possible);
      const isPecvdTarget =
        (!filters.pressure_regime || filters.pressure_regime === "any" || filters.pressure_regime === "high_p_torr") &&
        (!filters.chemistry || filters.chemistry === "any" || filters.chemistry === "c2h2_nh3_n2" || filters.chemistry === "n_doped_carbon");
      rawPct = Math.min(100.0, basePct * 0.94 + (isPecvdTarget ? fidelityBonus : 3.0));
    }

    return {
      score: round(rawPct, 1),
      matched_reasons: reasons.slice(0, 7),
      extrapolation_notes: notes.slice(0, 2),
      regime_fidelity: fidelity,
      window_summary: cp.window_summary || "",
      numeric_windows: nw,
    };
  }

  function scorePaperSimilarityStatic(anchor, candidate) {
    const cpA = anchor.config_profile || {};
    const cpB = candidate.config_profile || {};
    const axes = [
      ["chemistries", 24.0],
      ["geometries", 18.0],
      ["process_modes", 18.0],
      ["rf_regimes", 14.0],
      ["pressure_regimes", 12.0],
      ["temp_regimes", 10.0],
      ["methods_diagnostics", 14.0],
    ];
    let earned = 0.0;
    let possible = 0.0;
    const reasons = [];
    const lbl = (k) => KB_SHORT_REASON_LABELS[k] || k;

    axes.forEach(([axis, w]) => {
      const sa = new Set(cpA[axis] || []);
      const sb = new Set(cpB[axis] || []);
      const union = new Set([...sa, ...sb]);
      if (!union.size) return;
      possible += w;
      const inter = [...sa].filter((x) => sb.has(x)).sort();
      earned += w * (inter.length / union.size);
      if (inter.length) reasons.push(lbl(inter[0]));
    });

    const tagsA = new Set(anchor.tags || []);
    const tagsB = new Set(candidate.tags || []);
    const tagUnion = new Set([...tagsA, ...tagsB]);
    if (tagUnion.size) {
      possible += 14.0;
      const tagInter = [...tagsA].filter((x) => tagsB.has(x));
      earned += 14.0 * (tagInter.length / tagUnion.size);
    }

    if (anchor.domain === candidate.domain) {
      earned += 6.0;
      possible += 6.0;
    }

    return {
      score: round(Math.min(100.0, 100.0 * (earned / Math.max(1.0, possible))), 1),
      matched_reasons: reasons.slice(0, 6),
      extrapolation_notes: [],
      regime_fidelity: cpB.regime_fidelity || "analogous_extrapolated",
      window_summary: cpB.window_summary || "",
      numeric_windows: cpB.numeric_windows || {},
    };
  }

  function buildConfigBriefStatic(configSummary, papers, matchedRows) {
    const top10 = papers.slice(0, 10);
    const exactCnt = top10.filter((p) => p.regime_fidelity === "exact_pecvd_har").length;
    const directCnt = top10.filter((p) => p.regime_fidelity === "direct_subsystem").length;
    const takeaways = papers.slice(0, 3).map((p) => ({
      paper_id: p.id,
      citation: p.citation,
      score: p.relevance_score,
      takeaway: p.takeaway,
    }));
    const benchHi = matchedRows.slice(0, 3).map((r) => ({
      row_label: r.row_label,
      dataset_id: r.dataset_id,
      provenance: r.provenance,
      metrics_summary: r.metrics_summary,
      source_ref: r.source_ref,
    }));
    const caveat =
      exactCnt === 0 && papers.length
        ? "Top matches are subsystem or analogous-regime studies; verify pressure/temperature extrapolation before committing patterned wafers."
        : exactCnt > 0
        ? `${exactCnt} exact PECVD/HAR source(s) and ${directCnt} direct subsystem source(s) anchor the top 10 results.`
        : "";
    return {
      headline: `For ${configSummary}, here are the most relevant papers & quantitative benchmarks:`,
      exact_in_top10: exactCnt,
      direct_in_top10: directCnt,
      regime_guidance: caveat,
      top_takeaways: takeaways,
      benchmark_highlights: benchHi,
    };
  }

  function searchKnowledgeBase(D, payload) {
    const req = payload || {};
    const resolvedFilters = {
      rf_regime: "any",
      pressure_regime: "any",
      temp_regime: "any",
      chemistry: "any",
      geometry: "any",
      process_mode: "any",
      method: "any",
    };
    const resolvedNumeric = {};
    let secGeoms = [];
    let secModes = [];
    let hasPulsed = false;
    const lit = (D.kb && D.kb.literature) || [];
    let configSummary = `All Process Configurations (Full ${lit.length}-Paper Corpus)`;

    const presets = (D.kb && D.kb.search_presets) || [];
    if (req.preset_id) {
      const pr = presets.find((p) => p.preset_id === req.preset_id);
      if (pr) {
        Object.assign(resolvedFilters, pr.filters || {});
        Object.assign(resolvedNumeric, pr.numeric_targets || {});
        secGeoms = (pr.secondary_geometries || []).slice();
        secModes = (pr.secondary_modes || []).slice();
        configSummary = `Preset · ${pr.label}`;
      }
    }

    if (req.recipe) {
      const derived = deriveFacetsFromRecipeStatic(req.recipe, req.goal || "plug_fill");
      Object.assign(resolvedFilters, derived.filters);
      Object.assign(resolvedNumeric, derived.numeric_targets);
      secGeoms = derived.secondary_geometries;
      secModes = derived.secondary_modes;
      hasPulsed = derived.has_pulsed_or_trim;
      configSummary = derived.summary;
    }

    if (req.numeric_targets && typeof req.numeric_targets === "object") {
      ["freq_mhz", "pressure_torr", "temp_c", "aspect_ratio"].forEach((nk) => {
        const nv = req.numeric_targets[nk];
        if (nv !== null && nv !== undefined && nv !== "") resolvedNumeric[nk] = Number(nv);
      });
      if (!req.recipe && !req.preset_id) {
        const fIn = req.filters || {};
        if (resolvedNumeric.freq_mhz != null && (!fIn.rf_regime || fIn.rf_regime === "any")) {
          resolvedFilters.rf_regime = resolvedNumeric.freq_mhz >= 20.0 ? "vhf_27mhz" : "hf_13mhz";
        }
        if (resolvedNumeric.pressure_torr != null && (!fIn.pressure_regime || fIn.pressure_regime === "any")) {
          const pv = resolvedNumeric.pressure_torr;
          resolvedFilters.pressure_regime = pv >= 1.5 ? "high_p_torr" : pv >= 0.15 ? "sub_torr" : "low_p_mtorr";
        }
        if (resolvedNumeric.temp_c != null && (!fIn.temp_regime || fIn.temp_regime === "any")) {
          const tv = resolvedNumeric.temp_c;
          resolvedFilters.temp_regime = tv >= 450.0 ? "high_t_450_650c" : tv >= 200.0 ? "mid_t_200_449c" : "low_t_rt_200c";
        }
      }
    }

    const numParts = [];
    if (resolvedNumeric.freq_mhz != null) numParts.push(`${resolvedNumeric.freq_mhz} MHz`);
    if (resolvedNumeric.pressure_torr != null) numParts.push(`${resolvedNumeric.pressure_torr} Torr`);
    if (resolvedNumeric.temp_c != null) numParts.push(`${resolvedNumeric.temp_c} °C`);
    if (resolvedNumeric.aspect_ratio != null) numParts.push(`AR ${resolvedNumeric.aspect_ratio}:1`);

    if (req.filters && typeof req.filters === "object") {
      Object.entries(req.filters).forEach(([k, v]) => {
        if (k in resolvedFilters && v) resolvedFilters[k] = String(v);
      });
      if (!req.recipe && !req.preset_id) {
        const activeCats = Object.values(resolvedFilters)
          .filter((v) => v && v !== "any")
          .map((v) => KB_SHORT_REASON_LABELS[v] || v);
        const combined = [...numParts, ...activeCats].slice(0, 6);
        if (combined.length) configSummary = `Custom Configuration · ${combined.join(" · ")}`;
      }
    } else if (numParts.length && !req.recipe && !req.preset_id) {
      configSummary = `Numeric Window · ${numParts.join(" · ")}`;
    }

    const anchorPaper = req.similar_to_paper_id
      ? lit.find((p) => p.id === req.similar_to_paper_id) || null
      : null;
    if (anchorPaper) {
      configSummary = `Similar Papers to [${anchorPaper.id}] · ${anchorPaper.title.slice(0, 64)}`;
    }

    const queryStr = String(req.query || "");
    const domain = String(req.domain || "all");
    const topK = Math.max(1, Math.min(140, Number(req.top_k || 24)));
    const tokens = queryStr.trim().toLowerCase().split(/\s+/).filter(Boolean);

    const figs = (D.kb && D.kb.figures) || [];
    const rules = (D.brain && D.brain.literature_logic_rules) || [];
    const dsMap = D.datasets || {};

    const figsByPaper = {};
    figs.forEach((f) => {
      const pid = f.paper_id || "";
      if (!figsByPaper[pid]) figsByPaper[pid] = [];
      figsByPaper[pid].push(f);
    });

    const dsByPaper = {};
    const allLoadedDs = Object.values(dsMap);
    allLoadedDs.forEach((dsFull) => {
      (dsFull.rows || []).forEach((r) => {
        const pid = r.paper_id || "";
        if (pid) {
          if (!dsByPaper[pid]) dsByPaper[pid] = [];
          if (!dsByPaper[pid].includes(dsFull.id)) dsByPaper[pid].push(dsFull.id);
        }
      });
    });

    const scoredPapers = [];
    const hasNumeric = Object.keys(resolvedNumeric).length > 0;
    lit.forEach((p) => {
      if (anchorPaper && p.id === anchorPaper.id) return;
      if (domain !== "all" && p.domain !== domain) return;
      if (tokens.length) {
        const nw = (p.config_profile && p.config_profile.numeric_windows) || {};
        const hay = `${p.id || ""} ${p.title || ""} ${p.citation || ""} ${p.takeaway || ""} ${(p.tags || []).join(" ")} ${(p.config_profile && p.config_profile.window_summary) || ""} ${(nw.key_metrics || []).join(" ")}`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) return;
      }
      const sc = anchorPaper
        ? scorePaperSimilarityStatic(anchorPaper, p)
        : scorePaperForConfigStatic(p, resolvedFilters, hasNumeric ? resolvedNumeric : null, secGeoms, secModes, hasPulsed);
      const pid = p.id;
      const pFigs = (figsByPaper[pid] || []).map((f) => ({ id: f.id, title: f.title, category: f.category || "" }));
      scoredPapers.push({
        ...p,
        relevance_score: sc.score,
        matched_reasons: sc.matched_reasons,
        extrapolation_notes: sc.extrapolation_notes,
        regime_fidelity: sc.regime_fidelity,
        window_summary: sc.window_summary,
        numeric_windows: sc.numeric_windows,
        linked_dataset_ids: dsByPaper[pid] || [],
        linked_figures: pFigs,
      });
    });

    const fidRank = (f) => (f === "exact_pecvd_har" ? 1 : f === "direct_subsystem" ? 0.5 : 0);
    scoredPapers.sort((a, b) => {
      if (b.relevance_score !== a.relevance_score) return b.relevance_score - a.relevance_score;
      if (fidRank(b.regime_fidelity) !== fidRank(a.regime_fidelity)) return fidRank(b.regime_fidelity) - fidRank(a.regime_fidelity);
      if (b.linked_dataset_ids.length !== a.linked_dataset_ids.length) return b.linked_dataset_ids.length - a.linked_dataset_ids.length;
      return b.linked_figures.length - a.linked_figures.length;
    });

    const limitedPapers = scoredPapers.slice(0, topK);
    const topPaperScores = {};
    limitedPapers.slice(0, 16).forEach((p) => {
      topPaperScores[p.id] = p.relevance_score;
    });
    if (anchorPaper) topPaperScores[anchorPaper.id] = 98.0;

    const includeOwner =
      !anchorPaper &&
      (resolvedFilters.pressure_regime === "high_p_torr" || resolvedFilters.pressure_regime === "any") &&
      (resolvedFilters.geometry === "via_hole_3d" || resolvedFilters.geometry === "har_ge_8" || resolvedFilters.geometry === "any") &&
      !tokens.length;

    const matchedRows = [];
    allLoadedDs.forEach((dsFull) => {
      const cols = dsFull.columns || [];
      const labelCol = cols[0] || "sample_id";
      const metricCols = cols.slice(1).filter((c) => c !== "provenance" && c !== "paper_id" && c !== "source_ref").slice(0, 4);
      (dsFull.rows || []).forEach((r) => {
        const pid = r.paper_id || "";
        const prov = r.provenance || "literature";
        let rowScore = topPaperScores[pid] || 0.0;
        if (prov === "measured_owner" && includeOwner) {
          rowScore = 96.0;
        } else if (tokens.length) {
          const rowHay = `${dsFull.title || ""} ${Object.values(r).map((v) => String(v)).join(" ")}`.toLowerCase();
          if (tokens.every((t) => rowHay.includes(t))) rowScore = Math.max(rowScore, 84.0);
        }
        if (rowScore <= 0.0) return;
        const summaryPairs = metricCols
          .filter((mc) => r[mc] !== "" && r[mc] !== null && r[mc] !== undefined)
          .map((mc) => `${mc}: ${r[mc]}`);
        matchedRows.push({
          dataset_id: dsFull.id,
          dataset_title: dsFull.title,
          row_label: String(r[labelCol] ?? "—"),
          provenance: prov,
          paper_id: pid,
          relevance_score: round(rowScore, 1),
          metrics_summary: summaryPairs.join(" · "),
          source_ref: String(r.source_ref || ""),
        });
      });
    });
    matchedRows.sort((a, b) => {
      if (b.relevance_score !== a.relevance_score) return b.relevance_score - a.relevance_score;
      if (b.dataset_id !== a.dataset_id) return b.dataset_id.localeCompare(a.dataset_id);
      return b.row_label.localeCompare(a.row_label);
    });

    const topPids = new Set(limitedPapers.slice(0, 12).map((p) => p.id));
    const matchedFigs = figs.filter((f) => topPids.has(f.paper_id)).slice(0, 8);
    const matchedRules = rules.filter((r) => (r.paper_ids || []).some((pid) => topPids.has(pid)));
    const totalBenchmarkRows = allLoadedDs.reduce((acc, ds) => acc + (ds.rows ? ds.rows.length : 0), 0);

    return {
      config_summary: configSummary,
      active_filters: resolvedFilters,
      active_numeric_targets: resolvedNumeric,
      secondary_geometries: secGeoms,
      secondary_modes: secModes,
      similar_to_paper_id: anchorPaper ? anchorPaper.id : null,
      query: queryStr,
      domain,
      total_corpus_papers: lit.length,
      total_benchmark_datasets: allLoadedDs.length,
      total_benchmark_rows: totalBenchmarkRows,
      total_matching_papers: scoredPapers.length,
      returned_paper_count: limitedPapers.length,
      configuration_brief: buildConfigBriefStatic(configSummary, limitedPapers, matchedRows),
      papers: limitedPapers,
      matched_dataset_rows: matchedRows.slice(0, 16),
      matched_figures: matchedFigs,
      matched_rules: matchedRules,
    };
  }

  function makeBackend(loader) {
    const ready = loader();
    let guidedCursor = "step0";
    let staticSprintProg = "tsmc_n2_plug";
    let staticKbVer = "v2.1.0";
    let staticSpecObMax = null;
    let staticB2Clean = false;
    const STATIC_RBAC = {
      process_technologist: ["audit:read", "spec:edit", "spec:lock", "wafer:ingest", "sim:dispatch", "kb:promote", "kb:rollback", "doe:dispatch", "signoff:approve"],
      metrology_operator: ["audit:read", "wafer:ingest"],
      simulation_engineer: ["audit:read", "sim:dispatch"],
      viewer: ["audit:read"],
    };
    function enforceStaticRbac(role, perm) {
      const r = String(role || "process_technologist").toLowerCase();
      const allowed = STATIC_RBAC[r] || [];
      if (!allowed.includes(perm)) {
        const err = new Error(`Role '${r}' is not permitted to perform '${perm}'.`);
        err.status = 403;
        throw err;
      }
    }
    function redactProprietaryForViewer(govObj, role) {
      if (String(role || "").toLowerCase() !== "viewer" || !govObj) return govObj;
      govObj.proprietary_redacted = true;
      if (govObj.active_commit && Array.isArray(govObj.active_commit.rules)) {
        govObj.active_commit.rules = govObj.active_commit.rules.map((r) =>
          (r.ip_tier === "BIG_SEMI_PROPRIETARY_CHAMBER" || r.ip_tier === "AMAT_PROPRIETARY_CHAMBER")
            ? { ...r, condition_expr: "[REDACTED — BIG-SEMI PROPRIETARY]", prior_adjustments: {} }
            : r
        );
      }
      return govObj;
    }
    return {
      ready,
      isStaticDemo: true,
      async handle(rawPath, body) {
        const { D, M } = await ready;
        const cleanPath = String(rawPath || "").split("?")[0];
        const gs = D.guided_snapshots || {};
        const sb = D.sprints_bundle || {};
        const clone = (obj) => structuredClone(obj ?? {});

        if (cleanPath.startsWith("/api/sprints/")) {
          const role = String((body && body.role) || "process_technologist").toLowerCase();
          if (cleanPath === "/api/sprints/auth/token") {
            if (!STATIC_RBAC[role]) {
              const err = new Error(`Unknown RBAC role '${role}'.`);
              err.status = 403;
              throw err;
            }
            return {
              role,
              actor: (body && body.actor) || "cleanroom.ui",
              token: `v1|${role}|static|9999999999|static-hmac`,
            };
          }
          if (cleanPath === "/api/sprints/reset") {
            enforceStaticRbac(role, "spec:lock");
            staticSprintProg = "tsmc_n2_plug";
            staticKbVer = "v2.1.0";
            staticSpecObMax = null;
            staticB2Clean = false;
          }
          if (cleanPath === "/api/sprints/overview" || cleanPath === "/api/sprints/reset") {
            const qIdx = String(rawPath || "").indexOf("?");
            if (qIdx >= 0) {
              const sp = new URLSearchParams(String(rawPath).slice(qIdx + 1));
              if (sp.get("program_id")) staticSprintProg = sp.get("program_id");
            }
            const s1 = clone((sb.programs && sb.programs[staticSprintProg]) || sb.sprint1_initial || {});
            if (staticSpecObMax != null && s1.selected_program && s1.selected_program.spec) {
              s1.selected_program.spec.ob_max_nm = staticSpecObMax;
              s1.selected_program.spec_version = 2;
            }
            const gov = redactProprietaryForViewer(clone(sb.sprint5_governance || {}), role);
            gov.active_version = staticKbVer;
            const s2Chambers = clone((sb.sprint2_cassette && sb.sprint2_cassette.chambers) || []);
            if (staticB2Clean) {
              s2Chambers.forEach((c) => {
                if (c.chamber_id === "CHAMBER-PRODUCER-B2") {
                  c.cum_carbon_um = 0.15;
                  c.wafers_since_clean = 0;
                  c.clean_advisory = false;
                }
              });
            }
            return {
              active_program_id: staticSprintProg,
              sprint1: s1,
              sprint2: { chambers: s2Chambers },
              sprint4_jobs: { total_jobs: 2, running_jobs: 0, completed_jobs: 2, jobs: [] },
              sprint5: gov,
            };
          }
          if (cleanPath === "/api/sprints/sprint1/switch_program") {
            enforceStaticRbac(role, "audit:read");
            staticSprintProg = (body && body.program_id) || "tsmc_n2_plug";
            return clone((sb.programs && sb.programs[staticSprintProg]) || sb.sprint1_initial || {});
          }
          if (cleanPath === "/api/sprints/sprint1/update_spec") {
            enforceStaticRbac(role, "spec:edit");
            staticSpecObMax = (body && body.spec_updates && body.spec_updates.ob_max_nm) || 82;
            const s1 = clone((sb.programs && sb.programs[staticSprintProg]) || sb.sprint1_initial || {});
            if (s1.selected_program && s1.selected_program.spec) {
              s1.selected_program.spec.ob_max_nm = staticSpecObMax;
              s1.selected_program.spec_version = 2;
            }
            return s1;
          }
          if (cleanPath === "/api/sprints/sprint2/stream_cassette") {
            enforceStaticRbac(role, "wafer:ingest");
            staticB2Clean = false;
            return clone(sb.sprint2_cassette || {});
          }
          if (cleanPath === "/api/sprints/sprint2/chamber_clean") {
            enforceStaticRbac(role, "wafer:ingest");
            staticB2Clean = true;
            const c = clone(sb.sprint2_cassette || {});
            (c.chambers || []).forEach((ch) => {
              if (ch.chamber_id === "CHAMBER-PRODUCER-B2") {
                ch.cum_carbon_um = 0.15;
                ch.wafers_since_clean = 0;
                ch.clean_advisory = false;
              }
            });
            return { cleaned_chamber: { chamber_id: "CHAMBER-PRODUCER-B2", cum_carbon_um: 0.15, clean_advisory: false }, status: { chambers: c.chambers || [] } };
          }
          if (cleanPath === "/api/sprints/sprint3/inspect_coupon") {
            enforceStaticRbac(role, "wafer:ingest");
            return { coupon: clone(sb.sprint3_coupon || {}), benchmark: clone(sb.sprint3_benchmark || {}) };
          }
          if (cleanPath === "/api/sprints/sprint4/submit") {
            enforceStaticRbac(role, "sim:dispatch");
            return clone(body && body.mode === "grid12" ? sb.sprint4_grid12 : sb.sprint4_single);
          }
          if (cleanPath === "/api/sprints/sprint5/action") {
            const act = (body && body.action) || "diff";
            if (act === "promote_first_candidate" || act === "promote_custom") {
              enforceStaticRbac(role, "kb:promote");
              staticKbVer = "v2.2.0";
              const g = clone(sb.sprint5_governance || {});
              g.active_version = staticKbVer;
              return g;
            }
            if (act === "rollback") {
              enforceStaticRbac(role, "kb:rollback");
              staticKbVer = "v2.2.1";
              const g = clone(sb.sprint5_governance || {});
              g.active_version = staticKbVer;
              return g;
            }
            if (act === "recommend_lineage") {
              const bo = clone(sb.sprint5_bo_lineage || {});
              bo.kb_version = staticKbVer;
              return bo;
            }
            return { diff: clone((sb.sprint5_governance && sb.sprint5_governance.latest_diff_vs_v1) || {}), governance: clone(sb.sprint5_governance || {}) };
          }
          if (cleanPath === "/api/sprints/sprint6/action") {
            const act = (body && body.action) || "qualification_signoff";
            if (act === "export_runsheet") {
              enforceStaticRbac(role, "doe:dispatch");
              if (body && Array.isArray(body.custom_recipes) && body.custom_recipes.some((r) => Number(r.power_w) > 2050)) {
                const err = new Error("Chamber hardware interlock blocked recipe dispatch: ILK-RF-PWR: RF Forward Power <= 2050 W (got 2350.0)");
                err.status = 422;
                throw err;
              }
              return clone(sb.sprint6_runsheet || {});
            }
            if (act === "chamber_transfer") {
              enforceStaticRbac(role, "doe:dispatch");
              return clone(sb.sprint6_transfer || {});
            }
            enforceStaticRbac(role, "signoff:approve");
            const s6Mode = (body && body.mode) || "measured_qualification";
            if (s6Mode === "synthetic_preview") {
              const prev = clone(sb.sprint6_signoff || {});
              prev.mode = "synthetic_preview";
              prev.qualified = false;
              prev.qualification_eligible = false;
              prev.is_synthetic_preview = true;
              prev.evidence_provenance = "synthetic";
              prev.cycle_time_reduction_pct = null;
              return prev;
            }
            return {
              program_id: staticSprintProg,
              mode: "measured_qualification",
              qualified: false,
              qualification_eligible: false,
              is_synthetic_preview: false,
              evidence_provenance: "measured",
              cpk_gate_threshold: 1.33,
              min_required_measured_wafers: 5,
              n_measured_repeatability_wafers: 1,
              traceable_wafer_ids: [],
              ineligibility_reason:
                "Static preview holds only 1 anchor wafer matching the target recipe; at least 5 traceable measured repeatability wafers are required for fab qualification sign-off.",
              min_cpk: null,
              cpk_metrics: {},
              cycle_time_reduction_pct: null,
            };
          }
        }

        if (cleanPath === "/api/workflow/state") return clone(gs[guidedCursor] || gs.step0 || {});
        if (cleanPath === "/api/workflow/reset") {
          guidedCursor = "step0";
          return clone(gs.step0 || {});
        }
        if (cleanPath === "/api/workflow/step1_spec") {
          const pid = body && body.preset_id;
          guidedCursor = pid === "tsmc_cowos_partial" ? "step1_partial" : "step1";
          const st = clone(gs[guidedCursor] || gs.step1 || gs.step0);
          if (body && body.custom_spec && st && st.step1_spec) {
            st.step1_spec.selected_preset = "custom";
            Object.assign(st.step1_spec.active_spec, body.custom_spec);
            if (body.afm_rq_max_nm != null) st.step1_spec.afm_rq_max_nm = Number(body.afm_rq_max_nm);
          }
          return st;
        }
        if (cleanPath === "/api/workflow/step2_load_data" || cleanPath === "/api/workflow/step2_upload") {
          const did = body && body.dataset_id;
          guidedCursor =
            did === "big_semi_high_pressure_dust_6" || did === "amat_high_pressure_dust_6"
              ? "step2_dust6"
              : did === "big_semi_seasoning_and_afm_8"
                ? "step2_season8"
                : "step2";
          return clone(gs[guidedCursor] || gs.step2 || gs.step0);
        }
        if (cleanPath === "/api/workflow/step3_select_kb") {
          const kbk = (body && body.kb_key) || "kb_v2_1_hybrid_full";
          guidedCursor =
            kbk === "kb_v1_0_public"
              ? "step3_v1_0"
              : kbk === "kb_v2_0_big_semi_chamber" || kbk === "kb_v2_0_amat_chamber"
                ? "step3_v2_0"
                : "step3";
          return clone(gs[guidedCursor] || gs.step3 || gs.step0);
        }
        if (cleanPath === "/api/workflow/step4_simulate") {
          guidedCursor = "step4";
          const st = clone(gs.step4 || gs.step0);
          if (body && body.mode === "custom" && body.custom_recipe && st && st.step4_sim_and_understanding) {
            const pred = predictStudio(D, M, body.custom_recipe);
            const r = pred.recipe;
            const p = pred.plasma;
            const post = pred.pang_posterior;
            st.step4_sim_and_understanding.simulation_cards.unshift({
              sim_tag: "SIM-LIVE-01",
              purpose: body.custom_purpose || "Live Browser Surrogate Probe",
              recipe: r,
              ccp_plasma: {
                ne_1e10_cm3: p.ne_1e10_cm3,
                ion_energy_ev: p.ion_energy_ev,
                beta_eff: p.beta_eff,
                oes_cn_ar: p.oes_cn_ar,
                dust_margin: p.dust_margin,
                knudsen_110: p.knudsen_110,
                thiele_110: round(9.09 * Math.sqrt(1.5 * Math.max(1e-5, p.beta_eff)), 3),
                gap_status: "NOMINAL_CCP_WINDOW",
              },
              knudsen_feature: {
                ph_depth_110_nm: post.ph_depth_110_nm,
                ph_depth_225_nm: post.ph_depth_225_nm,
                ob_nm: post.ob_nm,
                void_width_110_nm: post.void_width_110_nm,
                superconformal: post.superconformal,
                afm_rms_nm: post.afm_rms_nm,
              },
              molecular_3d: {
                archetype_key: "optimal_vhf_passivated_achn",
                archetype_title: "VHF Passivated a-C:H:N Network",
                formula: "C24H18N4",
                num_atoms: 46,
                mmff_energy_kcal_mol: 48.2,
                predicted_density_g_cm3: p.film_density_g_cm3,
                sp2_fraction: p.sp2_fraction,
                f_etch_barrier_ev: p.f_etch_barrier_ev,
              },
            });
            st.step4_sim_and_understanding.simulation_count = st.step4_sim_and_understanding.simulation_cards.length;
          }
          return st;
        }
        if (cleanPath === "/api/workflow/step5_optimize") {
          guidedCursor = guidedCursor === "step7" || guidedCursor === "step5_r2" ? "step5_r2" : "step5_r1";
          return clone(gs[guidedCursor] || gs.step5_r1);
        }
        if (cleanPath === "/api/workflow/step6_ingest") {
          guidedCursor = guidedCursor === "step5_r2" || guidedCursor === "step7" || guidedCursor === "step6_r2" ? "step6_r2" : "step6_r1";
          return clone(gs[guidedCursor] || gs.step6_r1);
        }
        if (cleanPath === "/api/workflow/step7_update_kb") {
          guidedCursor = "step7";
          return clone(gs.step7 || gs.step6_r1);
        }
        if (cleanPath === "/api/workflow/step8_converge_loop") {
          guidedCursor = "step6_r2";
          return clone(gs.step6_r2 || gs.step0);
        }

        if (cleanPath === "/api/world/knobs") return { knobs: D.knobs, defaults: D.defaults };
        if (cleanPath === "/api/brain") return D.brain;
        if (cleanPath === "/api/pyramid") {
          return {
            gate_status: "DISPATCH_NEXT_DOE_ROUND",
            recommended_decision: "Use Guided Product Flow (Steps 0–8) or click Run Closed-Loop Criteria Demo.",
            layers: (gs.step0 && gs.step0.intro && gs.step0.intro.pyramid_layers) || [],
            wafer_criteria_matrix: [],
          };
        }
        if (cleanPath === "/api/demo/converge_to_spec") {
          const fin = clone(gs.step6_r2 || {});
          const traj = (fin.step8_convergence && fin.step8_convergence.trajectory) || [];
          const win = (fin.step8_convergence && fin.step8_convergence.winning_wafer) || null;
          return {
            converged: true,
            rounds_executed: 2,
            winning_wafer: win,
            rounds: traj.filter((t) => t.round > 0).map((t) => ({
              round: t.round,
              pass_count: t.pass_count,
              batch_size: t.count,
              best_ph_110_nm: t.best_ph_110_nm,
              lowest_ob_nm: t.lowest_ob_nm,
            })),
          };
        }
        if (cleanPath === "/api/auto_ingest/scan") {
          return { ingested_files: [], quarantined_files: [], note: "Browser sandbox inbox scanned (0 pending files)." };
        }
        if (cleanPath === "/api/spec") {
          if (body && typeof body === "object") Object.assign(D.client_spec, body);
          return { client_spec: D.client_spec, brain_version: D.brain.brain_version };
        }
        if (cleanPath === "/api/ingest/virtual_wafer") {
          const pred = predictStudio(D, M, (body && body.recipe) || {});
          const eid = (body && body.exp_id) || `SBX-${(D.brain.experiments || []).length + 1}`;
          const rec = {
            exp_id: eid,
            provenance: "synthetic",
            recipe: pred.recipe,
            measured: {
              ph_depth_110_nm: pred.pang_posterior.ph_depth_110_nm,
              ph_depth_225_nm: pred.pang_posterior.ph_depth_225_nm,
              ob_nm: pred.pang_posterior.ob_nm,
              void_width_110_nm: pred.pang_posterior.void_width_110_nm,
              crack_detected: pred.pang_posterior.crack_prob > 0.5,
              nodule_defect: false,
              afm_rms_nm: pred.pang_posterior.afm_rms_nm,
              film_density_g_cm3: pred.plasma.film_density_g_cm3,
            },
          };
          D.brain.experiments.push(rec);
          D.brain.brain_version += 1;
          return { workspace: "sandbox", experiment: rec, brain_snapshot: { brain_version: D.brain.brain_version } };
        }
        if (cleanPath === "/api/reset") {
          guidedCursor = "step0";
          return { status: "reset", brain_version: D.brain.brain_version };
        }
        if (cleanPath === "/api/world/review_flags") return D.flags;
        if (cleanPath === "/api/knowledge_base") return D.kb;
        if (cleanPath === "/api/knowledge_base/search") {
          let reqPayload = body && typeof body === "object" ? { ...body } : {};
          const qIdx = String(rawPath || "").indexOf("?");
          if (qIdx >= 0) {
            const sp = new URLSearchParams(String(rawPath).slice(qIdx + 1));
            if (sp.get("q") && !reqPayload.query) reqPayload.query = sp.get("q");
            if (sp.get("domain") && !reqPayload.domain) reqPayload.domain = sp.get("domain");
            if (sp.get("preset_id") && !reqPayload.preset_id) reqPayload.preset_id = sp.get("preset_id");
            if (sp.get("similar_to_paper_id") && !reqPayload.similar_to_paper_id) reqPayload.similar_to_paper_id = sp.get("similar_to_paper_id");
            if (sp.get("top_k") && !reqPayload.top_k) reqPayload.top_k = Number(sp.get("top_k"));
            const fKeys = ["rf_regime", "pressure_regime", "temp_regime", "chemistry", "geometry", "process_mode", "method"];
            const qFilters = {};
            fKeys.forEach((fk) => {
              if (sp.get(fk)) qFilters[fk] = sp.get(fk);
            });
            if (Object.keys(qFilters).length) reqPayload.filters = { ...(reqPayload.filters || {}), ...qFilters };
            const nKeys = ["freq_mhz", "pressure_torr", "temp_c", "aspect_ratio"];
            const qNum = {};
            nKeys.forEach((nk) => {
              if (sp.get(nk) !== null && sp.get(nk) !== "") qNum[nk] = Number(sp.get(nk));
            });
            if (Object.keys(qNum).length) reqPayload.numeric_targets = { ...(reqPayload.numeric_targets || {}), ...qNum };
          }
          return searchKnowledgeBase(D, reqPayload);
        }
        if (cleanPath === "/api/data_model" || cleanPath === "/api/schema/data_model") {
          return D.data_model || { schema_id: "pang.pecvd.carbon.v2", layer_count: 8, total_typed_fields: 62, csv_columns: [], layers: [] };
        }
        if (cleanPath === "/api/campaigns/catalog" || cleanPath === "/api/campaigns/presets") {
          return { presets: [], preset_packs: [], ...(D.campaign_catalog || {}) };
        }
        if (cleanPath === "/api/prediction_log") {
          return (D.brain && D.brain.prediction_audit) || { total_logged: 0, recipe_deviation_count: 0, entries: [], measured_summary: { count: 0 } };
        }
        if (cleanPath === "/api/predict") return predictStudio(D, M, body || {});
        if (cleanPath === "/api/recommend" || cleanPath === "/api/optimize") return recommendStudio(D, body || {});
        if (cleanPath === "/api/molecular/simulate") return molecularSimulateStatic(D, M, body || {});
        if (cleanPath === "/api/world/simulate") return simulate(D, M, (body && body.recipe) || {}, (body && body.goal) || "plug_fill");
        if (cleanPath === "/api/world/sweep") return sweep(D, M, (body && body.recipe) || {}, (body && body.goal) || "plug_fill");
        if (cleanPath === "/api/world/optimize") return optimize(D, body || {});
        const m = cleanPath.match(/^\/api\/knowledge_base\/(dataset|training)\/(.+)$/);
        if (m) {
          const table = (m[1] === "training" ? D.training : D.datasets)[decodeURIComponent(m[2])];
          if (table) return table;
        }
        return { ok: true, workspace: "sandbox" };
      },
    };
  }

  const api = {
    erf,
    Phi,
    forward,
    predictRaw,
    encode,
    moldHalfProfile,
    integrateFill,
    fillEvolution,
    evalAst,
    simulate,
    predictStudio,
    sweep,
    optimize,
    recommendStudio,
    specLines,
    nearestMeasured,
    searchKnowledgeBase,
    makeBackend,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.WM_FIG_BASE = "figures/";
    root.WM_BACKEND = makeBackend(async () => {
      const [D, M] = await Promise.all([fetch("data.json").then((r) => r.json()), fetch("model.json").then((r) => r.json())]);
      const note = root.document && root.document.getElementById("wmStaticNote");
      if (note) {
        const a = M.accuracy;
        note.hidden = false;
        note.textContent = `Shareable Static Snapshot (built ${D.built_at} from PANG Brain v${D.brain.brain_version}). Browser neural surrogate trained on ${a.n_train} Brain predictions (held-out median |error|: ${a.median_abs_err.ph_depth_110_nm} nm PH₁₁₀, ${a.median_abs_err.ob_nm} nm OB) + precomputed 3D MMFF94s conformers & CC-BY micrographs. Run local server (127.0.0.1:8765) for live cleanroom ingestion.`;
      }
      return { D, M };
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
