/* Static-site backend for the World Model page (GitHub Pages build).
 *
 * Answers the same requests world_model.js makes to /api/world/* and /api/knowledge_base, but in the
 * browser: predictions come from a neural-network copy of the PANG Brain trained on the brain's own
 * outputs (model.json, built by scripts/build_static_demo.py); everything else comes from data.json.
 * The fill drawing is a line-for-line port of pang_brain/world_model.py::fill_evolution.
 * Also loads under Node (module.exports) so tests can check it against the Python.
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

  // ---------------------------------------------------------------- fill evolution (port of world_model.py)
  const SUBSTEPS = 6;

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
      frames.push({ t: round(k / (nFrames - 1), 4), walls_nm: walls.map((w) => round(w, 2)), bottom_nm: round(bottom, 2) });
    }
    const solid = solidMask();
    const open = openMask(solid);
    const voidCells = [];
    for (let i = 0; i < nz; i += 1) if (!solid[i] && !open[i]) voidCells.push(i);
    let finalVoid = null;
    if (voidCells.length) {
      const widths = voidCells.map((i) => cd - 2 * walls[i]);
      finalVoid = {
        top_nm: round(z[voidCells[0]] - (0.5 * depth) / nz, 1),
        bottom_nm: round(z[voidCells[voidCells.length - 1]] + (0.5 * depth) / nz, 1),
        max_width_nm: round(Math.max(...widths), 1),
      };
    }
    return { z_nm: z.map((v) => round(v, 1)), frames, final_void: finalVoid };
  }

  function fillEvolution(o) {
    const { cd, depth, vnet, ph, vw, ob, goal, fillH, upperWall } = o;
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
    let res;
    if (goal === "partial_fill") {
      const target = clamp(fillH || 0, 0, depth);
      const wall = clamp(upperWall || 0, 0, 0.45 * cd);
      const frames = [];
      for (let k = 0; k < nFrames; k += 1) {
        const t = k / (nFrames - 1);
        frames.push({ t: round(t, 4), walls_nm: new Array(n).fill(round(wall * t, 2)), bottom_nm: round(target * t, 2) });
      }
      res = { z_nm: zf.map((f) => round(f * depth, 1)), frames, final_void: null, mode: "partial_fill", reconciled_to: { fill_height_nm: round(target, 1), upper_wall_nm: round(wall, 1) } };
    } else if (vw > 0.5 && ph < voidFree) {
      const zz = zf.map((f) => f * depth);
      const cell = depth / n;
      const zp = clamp(ph, 0.04 * depth, depth - 2.5 * cell);
      const w = clamp(vw, 1, 0.9 * cd);
      const width = Math.max(1.5 * cell, 0.04 * depth);
      let ip = 0;
      zz.forEach((v, i) => { if (Math.abs(v - zp) < Math.abs(zz[ip] - zp)) ip = i; });
      const amp = w / (cd - w);
      const rate = zz.map((v, i) => (i < ip ? 0.9 + 0.1 * shape[i] : 1.0) * (1 + amp * Math.exp(-(((v - zp) / width) ** 2))));
      const rp = rate[ip];
      for (let i = ip + 1; i < n; i += 1) rate[i] = Math.min(rate[i], 0.97 * rp);
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
    res.frames.forEach((fr) => { fr.ob_nm = round(ob * fr.t, 2); });
    Object.assign(res, { cd_nm: cd, depth_nm: depth, half_cd_nm: cd / 2 });
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

  // ---------------------------------------------------------------- world-model responses
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
      const ok = plasma.film_density_g_cm3 >= spec.density_min_g_cm3;
      lines.push({ line: "density", label: "Film density (model estimate)", target: `≥ ${spec.density_min_g_cm3.toFixed(2)} g/cm³`, predicted: `${plasma.film_density_g_cm3.toFixed(2)} g/cm³ (no measurement)`, prob: ok ? 0.75 : 0.25 });
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
      rows.push({ exp_id: e.exp_id, distance: round(Math.sqrt(s), 3), recipe: e.recipe, measured: { ph_depth_110_nm: m.ph_depth_110_nm, ph_depth_225_nm: m.ph_depth_225_nm, fill_height_110_nm: m.fill_height_110_nm, ob_nm: m.ob_nm, void_width_110_nm: m.void_width_110_nm, crack_detected: m.crack_detected, nodule_defect: m.nodule_defect } });
    });
    rows.sort((a, b) => a.distance - b.distance);
    return rows.slice(0, k);
  }

  function fullRecipe(D, recipe) {
    const r = { ...D.defaults, ...recipe };
    r.nc_ratio = round(r.nh3_sccm / Math.max(1, r.c2h2_sccm), 4);
    r.gap_mm = round(r.gap_mils * 0.0254, 3);
    return r;
  }

  function posteriorOf(D, raw, r) {
    const vf = D.void_free_fraction * r.depth_nm;
    const ph110 = clamp(raw.ph_depth_110_nm, 250, r.depth_nm);
    const ph225 = clamp(raw.ph_depth_225_nm, 350, r.depth_nm);
    return {
      ph_depth_110_nm: round(ph110, 1),
      ph_depth_225_nm: round(ph225, 1),
      fill_height_110_nm: round(raw.fill_height_110_nm, 1),
      ob_nm: round(raw.ob_nm, 1),
      dual_cd_step_nm: round(raw.dual_cd_step_nm, 1),
      void_width_110_nm: ph110 >= vf ? 0 : round(r.hole_cd_nm * Math.min(0.5, (1 - ph110 / r.depth_nm) * 1.15), 1),
      void_width_225_nm: ph225 >= vf ? 0 : round(r.wide_cd_nm * Math.min(0.42, (1 - ph225 / r.depth_nm) * 0.95), 1),
      upper_wall_nm: round(raw.upper_wall_nm, 1),
      superconformal: raw.superconformal >= 0.5,
      crack_prob: round(raw.crack_prob, 3),
      nodule_risk: round(raw.nodule_risk, 3),
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

  function simulate(D, M, recipe, goal) {
    const r = fullRecipe(D, recipe);
    const raw = predictRaw(M, r);
    const post = posteriorOf(D, raw, r);
    const unc = uncertaintyOf(raw);
    const plasma = {};
    M.plasma_outputs.forEach((k) => { plasma[k] = raw[`plasma.${k}`]; });
    const vf = D.void_free_fraction * r.depth_nm;
    const env = { ...r, ob_nm: raw["layer.cal_ob"] };
    const fired = (D.rules || []).filter((rule) => rule.ast && evalAst(rule.ast, env)).map((rule) => rule.title);
    const layer = (target, u, c, s, p) => ({ target, uncalibrated_sim: round(u, 1), calibrated_physics: round(c, 1), human_rule_shift: round(s, 1), data_correction: round(p - c - s, 1), posterior: p });
    const vnet110 = M.profile_outputs.map((k) => raw[`v110.${k}`]);
    const vnet225 = M.profile_outputs.map((k) => raw[`v225.${k}`]);
    const nearest = nearestMeasured(D, r, 3);
    const ob225 = Math.max(0, post.ob_nm - (post.dual_cd_step_nm || 0));
    return {
      brain_version: D.brain.brain_version,
      goal,
      recipe: r,
      client_spec: D.client_spec,
      posterior: post,
      uncertainty: unc,
      plasma,
      extrapolation: { outside_window: false, nearest_measured_distance: nearest.length ? nearest[0].distance : null },
      human_priors: { triggered_rules: fired },
      depth_profile: { z_nm: M.profile_z_nm, v_net_nm_min_110: vnet110, v_net_nm_min_225: vnet225 },
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
        110: fillEvolution({ cd: r.hole_cd_nm, depth: r.depth_nm, vnet: vnet110, ph: post.ph_depth_110_nm, vw: post.void_width_110_nm, ob: post.ob_nm, goal, fillH: post.fill_height_110_nm, upperWall: post.upper_wall_nm }),
        225: fillEvolution({ cd: r.wide_cd_nm, depth: r.depth_nm, vnet: vnet225, ph: post.ph_depth_225_nm, vw: post.void_width_225_nm, ob: ob225, goal, fillH: post.fill_height_110_nm, upperWall: post.upper_wall_nm }),
      },
    };
  }

  function sweep(D, M, recipe, goal) {
    const base = fullRecipe(D, recipe);
    const knobs = D.knobs.map((k) => {
      const xs = k.values ? k.values.slice() : Array.from({ length: D.sweep_points }, (_, i) => k.lo + ((k.hi - k.lo) * i) / (D.sweep_points - 1));
      const series = { x: [], ph110: [], ph110_std: [], ph225: [], ph225_std: [], ob: [], ob_std: [], crack: [], fill_h: [], fill_h_std: [], p_spec: [] };
      xs.forEach((x) => {
        const r = fullRecipe(D, { ...base, [k.key]: x });
        const raw = predictRaw(M, r);
        const post = posteriorOf(D, raw, r);
        series.x.push(x);
        series.ph110.push(post.ph_depth_110_nm); series.ph110_std.push(round(raw.ph_depth_110_std, 1));
        series.ph225.push(post.ph_depth_225_nm); series.ph225_std.push(round(raw.ph_depth_225_std, 1));
        series.ob.push(post.ob_nm); series.ob_std.push(round(raw.ob_std, 1));
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

  function makeBackend(loader) {
    const ready = loader();
    return {
      ready,
      async handle(path, body) {
        const { D, M } = await ready;
        if (path === "/api/world/knobs") return { knobs: D.knobs, defaults: D.defaults };
        if (path === "/api/brain") return D.brain;
        if (path === "/api/world/review_flags") return D.flags;
        if (path === "/api/knowledge_base") return D.kb;
        if (path === "/api/world/simulate") return simulate(D, M, body.recipe || {}, body.goal || "plug_fill");
        if (path === "/api/world/sweep") return sweep(D, M, body.recipe || {}, body.goal || "plug_fill");
        if (path === "/api/world/optimize") return optimize(D, body || {});
        const m = path.match(/^\/api\/knowledge_base\/(dataset|training)\/(.+)$/);
        if (m) {
          const table = (m[1] === "training" ? D.training : D.datasets)[decodeURIComponent(m[2])];
          if (table) return table;
        }
        throw new Error(`404: ${path} is not part of the static demo`);
      },
    };
  }

  const api = { erf, Phi, forward, predictRaw, encode, integrateFill, fillEvolution, evalAst, simulate, sweep, optimize, specLines, nearestMeasured, makeBackend };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.WM_FIG_BASE = "figures/";
    root.WM_BACKEND = makeBackend(async () => {
      const [D, M] = await Promise.all([fetch("data.json").then((r) => r.json()), fetch("model.json").then((r) => r.json())]);
      const note = root.document && root.document.getElementById("wmStaticNote");
      if (note) {
        const a = M.accuracy;
        note.textContent = `Shareable snapshot built ${D.built_at} from PANG Brain v${D.brain.brain_version}. Predictions here come from a browser copy of the brain: a neural network trained on ${a.n_train} of the brain's own predictions; on ${a.n_holdout} held-out recipes its median error is ${a.median_abs_err.ph_depth_110_nm} nm for PH depth 110 nm and ${a.median_abs_err.ob_nm} nm for overburden. The optimizer batch was computed by the full brain at build time.`;
      }
      return { D, M };
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
