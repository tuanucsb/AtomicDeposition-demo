/* Modular 3D Molecular Studio + Open-Source `tblite` (GFN2-xTB) & `ASE` Quantum MD Controller (`S10.2`). */
(function () {
  "use strict";

  function initMolecularStudio(deps) {
    const {
      qs,
      qsa,
      esc,
      setupHiDpiCanvas,
      themePalette,
      fetchJsonChecked,
      readJsonSafe,
      formatApiError,
      withBusyButton,
      downloadBlob,
      showToast,
      readRecipe,
      getWorkspace,
      setWorkspace,
      refreshAll,
      isStaticDemo,
    } = deps;

    let molSimData = null;
    let qmMdData = null;
    let activeFrameIdx = -1;
    let framePlayTimer = null;
    let molAbortCtrl = null;
    const molView = { rx: 0.35, ry: 0.55, autoSpin: true, dragging: false, lx: 0, ly: 0 };

    function activeAtomsAndBonds() {
      const src = qmMdData || molSimData;
      if (!src || !src.cluster_3d) return null;
      const baseAtoms = src.cluster_3d.atoms || [];
      const bonds = src.cluster_3d.bonds || [];
      if (qmMdData && qmMdData.trajectory && Array.isArray(qmMdData.trajectory.frames) && activeFrameIdx >= 0) {
        const frame = qmMdData.trajectory.frames[activeFrameIdx];
        if (frame && Array.isArray(frame.positions) && frame.positions.length === baseAtoms.length) {
          return {
            atoms: baseAtoms.map((a, idx) => ({
              ...a,
              x: frame.positions[idx][0],
              y: frame.positions[idx][1],
              z: frame.positions[idx][2],
            })),
            bonds,
            frame,
          };
        }
      }
      return { atoms: baseAtoms, bonds, frame: null };
    }

    function drawMolecule3dCanvas() {
      const setup = setupHiDpiCanvas(qs("#mol3dCanvas"));
      const geom = activeAtomsAndBonds();
      if (!setup || !geom || !geom.atoms.length) return;
      const { ctx, w, h } = setup;
      const pal = themePalette();
      const { atoms, bonds, frame } = geom;

      ctx.fillStyle = "#080d18";
      ctx.fillRect(0, 0, w, h);

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

      const scale = (Math.min(w, h) * 0.40) / maxSpan;
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

      const sortedBonds = [...bonds]
        .filter((b) => projected[b.begin] && projected[b.end])
        .sort((b1, b2) => {
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
        ctx.fillStyle = a.is_incident_radical ? "#f59e0b" : st.fill;
        ctx.arc(a.px, a.py, a.is_incident_radical ? rPx * 1.18 : rPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = a.is_incident_radical ? "#fef3c7" : st.rim;
        ctx.lineWidth = a.is_incident_radical ? 1.4 : 0.85;
        ctx.stroke();
      });

      ctx.font = "600 10.5px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("● C", 12, h - 10);
      ctx.fillStyle = "#38bdf8";
      ctx.fillText("● N", 48, h - 10);
      ctx.fillStyle = "#f8fafc";
      ctx.fillText("● H", 84, h - 10);
      if (qmMdData && qmMdData.chemisorption) {
        ctx.fillStyle = "#f59e0b";
        ctx.fillText(`● Incident ${qmMdData.chemisorption.species}•`, 122, h - 10);
      }
      ctx.fillStyle = pal.muted;
      ctx.textAlign = "right";
      if (frame) {
        const unit = qmMdData.mode === "qm_geometry_opt" ? `opt step ${frame.step}` : `t=${frame.t_fs.toFixed(1)} fs · T=${frame.temperature_k} K`;
        ctx.fillText(`${qmMdData.method} · ${unit}`, w - 12, h - 10);
      } else {
        ctx.fillText("Drag to rotate 3D", w - 12, h - 10);
      }
    }

    function drawQmTrajectoryPlot() {
      const canvas = qs("#molQmTrajCanvas");
      const wrap = qs("#molQmTrajWrap");
      if (!canvas || !wrap) return;
      if (!qmMdData || !qmMdData.trajectory || !qmMdData.trajectory.frames || qmMdData.trajectory.frames.length < 2) {
        wrap.hidden = true;
        return;
      }
      wrap.hidden = false;
      const setup = setupHiDpiCanvas(canvas);
      if (!setup) return;
      const { ctx, w, h } = setup;
      const pal = themePalette();
      const traj = qmMdData.trajectory;
      const frames = traj.frames;
      const isOpt = qmMdData.mode === "qm_geometry_opt";

      ctx.fillStyle = pal.surface;
      ctx.fillRect(0, 0, w, h);

      const pad = { l: 54, r: 54, t: 24, b: 30 };
      const pw = Math.max(80, w - pad.l - pad.r);
      const ph = Math.max(60, h - pad.t - pad.b);

      const e0 = frames[0].potential_energy_ev;
      const xs = frames.map((f) => (isOpt ? f.step : f.t_fs));
      const dEs = frames.map((f) => f.potential_energy_ev - e0);
      const y2s = frames.map((f) => (isOpt ? f.max_force_ev_a : f.temperature_k));

      const xMin = xs[0], xMax = Math.max(xs[xs.length - 1], xMin + 1e-3);
      let eMin = Math.min(...dEs), eMax = Math.max(...dEs);
      if (Math.abs(eMax - eMin) < 0.05) { eMin -= 0.1; eMax += 0.1; }
      const ePad = (eMax - eMin) * 0.12;
      eMin -= ePad; eMax += ePad;

      let y2Min = 0;
      let y2Max = Math.max(...y2s, isOpt ? 0.5 : (traj.target_temp_k || 800) * 1.18);
      if (y2Max <= y2Min + 1e-3) y2Max = y2Min + 1;

      const sx = (v) => pad.l + ((v - xMin) / (xMax - xMin)) * pw;
      const syE = (v) => pad.t + ph - ((v - eMin) / (eMax - eMin)) * ph;
      const sy2 = (v) => pad.t + ph - ((v - y2Min) / (y2Max - y2Min)) * ph;

      // Grid
      ctx.strokeStyle = pal.border;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 3; i++) {
        const gy = pad.t + (ph * i) / 3;
        ctx.beginPath();
        ctx.moveTo(pad.l, gy);
        ctx.lineTo(w - pad.r, gy);
        ctx.stroke();
      }

      // Target chuck temperature dashed guide (for MD modes)
      if (!isOpt && traj.target_temp_k) {
        const ty = sy2(traj.target_temp_k);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "#f59e0b88";
        ctx.beginPath();
        ctx.moveTo(pad.l, ty);
        ctx.lineTo(w - pad.r, ty);
        ctx.stroke();
        ctx.restore();
      }

      // Secondary curve (Temperature K or max|F| eV/A)
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      frames.forEach((_, i) => {
        const px = sx(xs[i]), py = sy2(y2s[i]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Primary curve (Delta E_pot eV)
      ctx.strokeStyle = "#0ea5e9";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      frames.forEach((_, i) => {
        const px = sx(xs[i]), py = syE(dEs[i]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Active scrubber frame cursor
      if (activeFrameIdx >= 0 && activeFrameIdx < frames.length) {
        const cx = sx(xs[activeFrameIdx]);
        ctx.save();
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, pad.t);
        ctx.lineTo(cx, pad.t + ph);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "#0ea5e9";
        ctx.beginPath();
        ctx.arc(cx, syE(dEs[activeFrameIdx]), 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Axis labels & legend
      ctx.font = "600 10.5px ui-monospace, monospace";
      ctx.fillStyle = "#0ea5e9";
      ctx.textAlign = "left";
      ctx.fillText(`ΔE_pot (eV) [${qmMdData.method}]`, pad.l, 15);
      ctx.fillStyle = "#f59e0b";
      ctx.textAlign = "right";
      ctx.fillText(isOpt ? "max|F| (eV/Å)" : `T (K) · target ${traj.target_temp_k} K`, w - pad.r, 15);

      ctx.fillStyle = pal.muted;
      ctx.textAlign = "right";
      ctx.fillText(eMax.toFixed(2), pad.l - 6, pad.t + 6);
      ctx.fillText(eMin.toFixed(2), pad.l - 6, pad.t + ph + 3);
      ctx.textAlign = "left";
      ctx.fillText(isOpt ? y2Max.toFixed(2) : Math.round(y2Max) + "K", w - pad.r + 6, pad.t + 6);
      ctx.fillText(isOpt ? "0.0" : "0K", w - pad.r + 6, pad.t + ph + 3);

      ctx.textAlign = "center";
      ctx.fillText(isOpt ? "BFGS Optimization Step" : "Quantum MD Time (fs)", pad.l + pw / 2, h - 8);
      ctx.textAlign = "left";
      ctx.fillText(isOpt ? "0" : "0 fs", pad.l, h - 8);
      ctx.textAlign = "right";
      ctx.fillText(isOpt ? `${xMax}` : `${xMax.toFixed(1)} fs`, w - pad.r, h - 8);
    }

    function stopFramePlayback() {
      if (framePlayTimer) {
        clearInterval(framePlayTimer);
        framePlayTimer = null;
      }
      const playBtn = qs("#btnMolPlayTraj");
      if (playBtn) {
        playBtn.setAttribute("aria-pressed", "false");
        playBtn.textContent = "▶ Play Trajectory";
      }
    }

    function syncFrameControls() {
      const wrap = qs("#molFrameControls");
      const range = qs("#molFrameRange");
      const lbl = qs("#molFrameLabel");
      if (!wrap || !range || !lbl) return;
      if (!qmMdData || !qmMdData.trajectory || !qmMdData.trajectory.frames || !qmMdData.trajectory.frames.length) {
        wrap.hidden = true;
        return;
      }
      const frames = qmMdData.trajectory.frames;
      wrap.hidden = false;
      range.min = "0";
      range.max = String(frames.length - 1);
      range.value = String(Math.max(0, Math.min(frames.length - 1, activeFrameIdx)));
      const f = frames[Math.max(0, Math.min(frames.length - 1, activeFrameIdx))];
      lbl.textContent =
        qmMdData.mode === "qm_geometry_opt"
          ? `Step ${f.step}/${qmMdData.trajectory.n_steps} · E=${f.potential_energy_ev.toFixed(2)} eV · max|F|=${f.max_force_ev_a.toFixed(3)} eV/Å`
          : `Frame ${activeFrameIdx + 1}/${frames.length} · t=${f.t_fs.toFixed(1)} fs · T=${f.temperature_k} K · RMSD=${f.rmsd_from_init_a.toFixed(3)} Å`;
    }

    function renderQmSummary(res) {
      const es = res.electronic_structure || {};
      const qb = res.quantum_bonding || {};
      const tr = res.trajectory || {};
      const ch = res.chemisorption;
      const box = qs("#molQmSummaryStrip");
      if (!box) return;
      box.hidden = false;
      const gapTxt = es.homo_lumo_gap_ev !== null && es.homo_lumo_gap_ev !== undefined
        ? `${esc(es.homo_lumo_gap_ev)} eV (HOMO ${esc(es.homo_ev)} / LUMO ${esc(es.lumo_ev)})`
        : "n/a";
      const chemTxt = ch
        ? ` · <b>${esc(ch.species)}• Impact (${esc(ch.impact_kinetic_energy_ev)} eV):</b> min d=${esc(ch.final_min_distance_a)} Å, max Wiberg BO=${esc(ch.max_radical_surface_wiberg_bo)} (${ch.chemisorbed ? "CHEMISORBED" : "scattered/physisorbed"})`
        : "";
      box.innerHTML = `
        <span><b>${esc(res.engine)} (${esc(res.license)}):</b> ΔE=${esc(tr.delta_e_ev)} eV · ⟨T⟩=${esc(tr.mean_temp_k)} K · RMSD=${esc(tr.final_rmsd_a)} Å · ${esc(tr.elapsed_ms)} ms</span>
        <span><b>Electronic &amp; Wiberg Quantum Bonds:</b> Gap=${gapTxt} · μ=${esc(es.dipole_debye)} D · Bonds=${esc(qb.initial_bond_count)}→${esc(qb.final_bond_count)} (+${esc(qb.bonds_formed_count)}/-${esc(qb.bonds_broken_count)}) · ⟨BO_CC⟩=${esc(qb.mean_cc_wiberg_order)}${chemTxt}</span>
      `;
    }

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
            body: JSON.stringify({ recipe: rcp, n_conformers: 4, seed: 42, workspace: getWorkspace() }),
            signal: molAbortCtrl.signal,
          },
          "Molecular simulation failed"
        );
        // Clear prior QM trajectory when user scrubs chamber knobs so 3D cluster matches new recipe immediately
        stopFramePlayback();
        qmMdData = null;
        activeFrameIdx = -1;
        syncFrameControls();
        drawQmTrajectoryPlot();
        if (qs("#molQmSummaryStrip")) qs("#molQmSummaryStrip").hidden = true;

        const c3d = molSimData.cluster_3d || {};
        const arch = molSimData.archetype || {};
        const cp = molSimData.coupled_priors || {};
        const engines = molSimData.available_open_source_engines || {};
        const xtbEng = engines.tblite_gfn2_xtb;
        if (qs("#molEngineStatusBadge")) {
          if (isStaticDemo) {
            qs("#molEngineStatusBadge").textContent = "Static Demo · Precomputed 3D";
          } else if (xtbEng && xtbEng.available) {
            qs("#molEngineStatusBadge").textContent = `tblite ${xtbEng.version || ""} GFN2-xTB + ASE Ready`;
            qs("#molEngineStatusBadge").className = "badge badge-ok mono";
          } else {
            qs("#molEngineStatusBadge").textContent = "RDKit MMFF94s Only";
          }
        }
        if (qs("#molArchetypeBadge")) qs("#molArchetypeBadge").textContent = `${c3d.n_atoms}-Atom · ${c3d.force_field}`;
        if (qs("#molClusterTitle")) qs("#molClusterTitle").textContent = arch.label || "3D a-C:H:N Network";
        if (qs("#molFormulaBadge")) qs("#molFormulaBadge").textContent = `${c3d.formula} (${c3d.molecular_weight_da} Da)`;
        if (qs("#molClusterDesc")) {
          qs("#molClusterDesc").textContent = `${arch.regime_condition} — ${arch.description}`;
        }
        if (qs("#molMetricsStrip")) {
          qs("#molMetricsStrip").innerHTML = `
            <span><b>3D Relaxed (RDKit):</b> E_min=${esc(c3d.minimized_energy_kcal_mol)} kcal/mol (ΔE=${esc(c3d.relaxation_delta_kcal_mol)}) · V_vdW=${esc(c3d.vdw_volume_a3)} Å³ · R_g=${esc(c3d.radius_of_gyration_a)} Å</span>
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

    async function runQuantumMd() {
      const btn = qs("#btnRunQmMd");
      if (isStaticDemo) {
        showToast("Real tblite GFN2-xTB Quantum MD requires the local FastAPI backend (`uv run python server.py`).");
        return;
      }
      if (!window.PANGAsyncJobs) return;
      await withBusyButton(btn, async () => {
        const rcp = readRecipe();
        const mode = (qs("#molQmMode") && qs("#molQmMode").value) || "thermal_nvt_md";
        const method = (qs("#molQmMethod") && qs("#molQmMethod").value) || "GFN2-xTB";
        const nSteps = Number((qs("#molQmSteps") && qs("#molQmSteps").value) || 20);
        const progressEl = qs("#molQmProgress");
        const statusEl = qs("#molQmLiveStatus");
        try {
          const job = await window.PANGAsyncJobs.submitAndPoll(
            "/api/jobs/quantum_md",
            {
              recipe: rcp,
              mode,
              method,
              n_steps: nSteps,
              timestep_fs: 0.5,
              incident_radical: "auto",
              seed: 42,
              workspace: getWorkspace(),
              wait_sync: false,
            },
            { progressEl, statusEl, intervalMs: 220 }
          );
          if (job && job.result) {
            qmMdData = job.result;
            const frames = (qmMdData.trajectory && qmMdData.trajectory.frames) || [];
            activeFrameIdx = Math.max(0, frames.length - 1);
            if (qs("#molArchetypeBadge")) {
              qs("#molArchetypeBadge").textContent = `${qmMdData.cluster_3d.n_atoms}-Atom · ${qmMdData.method} QM`;
            }
            renderQmSummary(qmMdData);
            syncFrameControls();
            drawMolecule3dCanvas();
            drawQmTrajectoryPlot();
            showToast(
              `Completed real ${qmMdData.method} ${qmMdData.mode} (${frames.length} frames, Gap=${qmMdData.electronic_structure.homo_lumo_gap_ev} eV).`
            );
          }
        } catch (err) {
          showToast(err.message || "Quantum MD run failed");
        }
      });
    }

    // Bind 3D drag rotation
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

    if (qs("#btnRunQmMd")) {
      qs("#btnRunQmMd").addEventListener("click", runQuantumMd);
    }

    if (qs("#molFrameRange")) {
      qs("#molFrameRange").addEventListener("input", (e) => {
        stopFramePlayback();
        activeFrameIdx = Number(e.currentTarget.value);
        syncFrameControls();
        drawMolecule3dCanvas();
        drawQmTrajectoryPlot();
      });
    }

    if (qs("#btnMolPlayTraj")) {
      qs("#btnMolPlayTraj").addEventListener("click", (e) => {
        const btn = e.currentTarget;
        if (framePlayTimer) {
          stopFramePlayback();
          return;
        }
        if (!qmMdData || !qmMdData.trajectory || !qmMdData.trajectory.frames || qmMdData.trajectory.frames.length < 2) {
          return;
        }
        btn.setAttribute("aria-pressed", "true");
        btn.textContent = "⏸ Pause Trajectory";
        framePlayTimer = setInterval(() => {
          const n = qmMdData.trajectory.frames.length;
          activeFrameIdx = (activeFrameIdx + 1) % n;
          syncFrameControls();
          drawMolecule3dCanvas();
          drawQmTrajectoryPlot();
        }, 180);
      });
    }

    setInterval(() => {
      if (!molView.autoSpin || molView.dragging || (!molSimData && !qmMdData)) return;
      if (qs("#panel-knowledge") && qs("#panel-knowledge").hasAttribute("hidden")) return;
      molView.ry += 0.025;
      drawMolecule3dCanvas();
    }, 55);

    // Export molecular decks
    qsa("[data-mol-dl]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await withBusyButton(btn, async () => {
          const fmt = btn.getAttribute("data-mol-dl");
          if (isStaticDemo && molSimData) {
            const c3d = molSimData.cluster_3d || {};
            const decks = molSimData.external_md_decks || {};
            const map = {
              pdb: [`pecvd_${c3d.formula || "achn"}.pdb`, "chemical/x-pdb", c3d.pdb_block],
              sdf: [`pecvd_${c3d.formula || "achn"}.sdf`, "chemical/x-mdl-sdfile", c3d.sdf_block],
              lammps_reaxff: ["in.pecvd_achn_reaxff", "text/plain", decks.lammps_reaxff_in],
              lammps_data: ["data.pecvd_achn.lmp", "text/plain", decks.lammps_data_lmp],
              lammps_airebo: ["in.pecvd_achn_airebo", "text/plain", decks.lammps_airebo_in],
              ase_py: ["run_pecvd_gap20_md.py", "text/x-python", decks.ase_gap20_bridge_py],
            };
            const entry = map[fmt];
            if (entry && entry[2]) {
              downloadBlob(entry[0], entry[1], entry[2]);
              showToast(`Exported molecular file: ${entry[0]}`);
              return;
            }
          }
          const rcp = readRecipe();
          const resp = await fetch(`/api/molecular/export/${encodeURIComponent(fmt)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipe: rcp, n_conformers: 4, seed: 42, workspace: getWorkspace() }),
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
            const rcp = readRecipe();
            const out = await fetchJsonChecked(
              "/api/molecular/simulate",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ recipe: rcp, n_conformers: 4, seed: 42, workspace: "sandbox", ingest_to_sandbox: true }),
              },
              "Failed to push molecular simulation"
            );
            setWorkspace("sandbox");
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

    return {
      updateMolecularSimulation,
      drawMolecule3dCanvas,
      drawQmTrajectoryPlot,
      runQuantumMd,
    };
  }

  window.PANGMolecularStudio = {
    initMolecularStudio,
  };
})();
