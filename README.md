# AtomicDeposition · Guided PECVD Qualification & World Model (Interactive Demo)

Live interactive demo of the **AtomicDeposition PANG Platform** for CCP-PECVD amorphous-carbon (`a-C:H:N`) HAR gap-fill qualification:

1. **Guided Product Flow (Steps 0–8):**
   - **Step 0 (Intro & Architecture):** 4-Layer PECVD Decision-Making Pyramid, `?` definition toggletips, and 6-Sprint Cleanroom Productization Plan.
   - **Step 1 (Client Spec):** TSMC N2 / A16 Dual-CD (`110 nm` & `225 nm`, `1.0 µm` deep) seamless plug acceptance criteria (`PH >= 985 nm`, `OB <= 85 nm`, `ρ >= 1.80 g/cm³`).
   - **Step 2 (Load Data):** Prebuilt 8-wafer Producer baseline lot (`0/8` pass) + 6-wafer high-pressure dust stress lot + custom CSV/JSON upload.
   - **Step 3 (Versioned Knowledge Base):** Switch between `KB v1.0`, `KB v2.0`, and `KB v2.1`, inspect Public Science (`102` papers) vs. Proprietary OEM IP vs. Customer Data, and search configuration-matched literature.
   - **Steps 4A & 4B (Multi-Scale Sim & Mechanism Figures):** Coupled CCP + Ballistic Knudsen + 3D `a-C:H:N` Molecular simulations plus cross-section and operating-window figures.
   - **Steps 5–8 (Closed-Loop Bayesian Optimization -> Convergence):** Proposes 3-wafer DoE batches, ingests Round-1 metrology, promotes discovered rule `PROP-TSMC-06` (`KB v2.2`), and converges in Round 2 (`TSMC-R2-W1` meets 100% of spec).
2. **Full 6-Tab Engineering Workbench:** Toggle anytime from the top header to explore animated non-rectangular gap-fill cross-sections, 3D AFM scans, 10-knob sensitivity sweeps, 3D molecular clusters, and the 20-node causal DAG.

Predictions, not measurements. The page runs a browser neural + analytical surrogate trained on 6448 of the PANG Brain's predictions (median held-out error 6.5 nm for PH depth, 3.1 nm for overburden). Built 2026-11-27 15:27 UTC from Brain v6. Source code is private.

## Figure credits (republished under their CC-BY licenses)
- `fig01_har10_trench_sem_550c_natcomm2024.png`: 10:1 Aspect-Ratio Trench Cross-Section SEMs at 550 °C (SC = 0.69 -> 0.97) — Souqui / Pedersen et al., Nat. Commun. 15, 10638 (2024), Fig. 2 (CC-BY 4.0), https://doi.org/10.1038/s41467-024-55007-1
- `fig02_lhar_penetration_sem_natcomm2024.png`: Lateral High-Aspect-Ratio (500 nm Gap) Penetration Depth SEM & EDX Profile — Souqui / Pedersen et al., Nat. Commun. 15, 10638 (2024), Fig. 4 (CC-BY 4.0), https://doi.org/10.1038/s41467-024-55007-1
- `fig03_sub100nm_gapfill_sem_natcomm2019.png`: Sub-100 nm (45 nm Half-Pitch) Interconnect Trench Vapor Gap-Fill TEM & EDS — Krishtab et al. (IMEC), Nat. Commun. 10, 3729 (2019), Fig. 4 (CC-BY 4.0), https://doi.org/10.1038/s41467-019-11703-x
- `fig04_pecvd_acnx_fesem_cross_section_scirep2022.png`: Fractured Cross-Section & Surface FESEM of Carbon Nitride (CNx) Thin Films — Addie et al., Sci. Rep. 12, 9902 (2022), Fig. 2 (CC-BY 4.0), https://doi.org/10.1038/s41598-022-14078-0
- `fig08_pecvd_acnx_raman_nc_temp_scirep2022.png`: Raman D/G & Nitrile C≡N (2150 cm⁻¹) Temperature Contour Map of CNx Films — Addie et al., Sci. Rep. 12, 9902 (2022), Fig. 4 (CC-BY 4.0), https://doi.org/10.1038/s41598-022-14078-0
- `fig09_ndoped_ac_atomic_strain_scirep2019.png`: Atomic Structures of Nitrogen-Doped Amorphous Carbon (1.56 to 7.81 at.% N) — Park et al., Sci. Rep. 9, 18961 (2019), Fig. 1 (CC-BY 4.0), https://doi.org/10.1038/s41598-019-55488-x
- `fig16_c2h2_n2_oes_spectra_cn_c2_ch_scirep2017.png`: Optical Emission Spectra (OES) of Pure C2H2 vs. Nitrogen-Mixed C2H2 RF Plasma — Ghoranneviss et al., Sci. Rep. 7, 9699 (2017), Fig. 2 (CC-BY 4.0), https://doi.org/10.1038/s41598-017-09747-4
- `fig24_autonomous_oes_bayesian_opt_febba2023.png`: Closed-Loop Plasma Bayesian Optimization Converging in 3–5 Runs via OES — Fébba et al., APL Mater. 11, 071119 / arXiv:2305.11122 (2023), Fig. 6 (CC-BY 4.0), https://doi.org/10.1063/5.0159406
- `fig27_ach_cross_section_hrtem_eels_natcomm2017.png`: Cross-Sectional HRTEM & Nanometer EELS π*(C=C) / σ*(C–H) Profile of a-C:H — Chen, Kato & Nosaka, Nat. Commun. 8, 1675 (2017), Fig. 2 (CC-BY 4.0), https://doi.org/10.1038/s41467-017-01717-8
- `fig28_uv_vis_raman_n_carbon_scirep2015.png`: Multi-Wavelength UV (325 nm) & Visible (488 nm) Raman of Ar/N2 Carbon Films — Dwivedi et al., Sci. Rep. 5, 7772 (2015), Fig. 4 (CC-BY 4.0), https://doi.org/10.1038/srep07772
- `fig29_xps_c1s_sp2_sp3_cn_hybridization_scirep2015.png`: Core-Level C 1s XPS Deconvolution (sp² C, sp³ C & C–N/C–O) of Carbon Overcoats — Dwivedi et al., Sci. Rep. 5, 7772 (2015), Fig. 5 (CC-BY 4.0), https://doi.org/10.1038/srep07772
- `fig30_xps_n1s_pyridinic_pyrrolic_bonding_scirep2015.png`: N 1s XPS Spectra Resolving Pyridinic/Graphitic Nitrogen Incorporation in Carbon — Dwivedi et al., Sci. Rep. 5, 7772 (2015), Fig. 6 (CC-BY 4.0), https://doi.org/10.1038/srep07772
- `fig31_ndoped_ac_bond_angle_strain_dist_scirep2019.png`: Radial Pair g(r) & Bond-Angle Strain Distributions in Pure vs. 7.81 at.% N-Doped a-C — Park et al., Sci. Rep. 9, 18961 (2019), Fig. 3 (CC-BY 4.0), https://doi.org/10.1038/s41598-019-55488-x
- `fig32_ndoped_ac_fluorine_etch_barrier_mep_scirep2019.png`: Fluorine Etch-Atom Penetration Energy Barrier: N-Doped a-C (4.92 eV) vs. Pure a-C (1.74 eV) — Park et al., Sci. Rep. 9, 18961 (2019), Fig. 7 (CC-BY 4.0), https://doi.org/10.1038/s41598-019-55488-x
- `fig33_c2h2_n2_atr_ftir_cn_nh_ch_spectra_scirep2017.png`: ATR-FTIR Spectra of C2H2+N2 RF Plasma Films Across Nitrogen Flow & RF Power — Ghoranneviss et al., Sci. Rep. 7, 9699 (2017), Fig. 5 (CC-BY 4.0), https://doi.org/10.1038/s41598-017-09747-4
- `fig35_realtime_hn_radical_control_har_profile_kambara2022.png`: Real-Time H/(H+N) Radical Ratio Control Eliminating 65 nm HAR Profile Taper — Kambara et al., Jpn. J. Appl. Phys. 62, SA0803 (2022), Figs. 7–8 (CC-BY 4.0), https://doi.org/10.35848/1347-4065/ac9189
- `fig36_ml_har_profile_cd_depth_extraction_kambara2022.png`: Automated Machine-Learning Extraction of CD1, CD2 & Depth from Cross-Section SEMs — Kambara et al., Jpn. J. Appl. Phys. 62, SA0803 (2022), Fig. 35 (CC-BY 4.0), https://doi.org/10.35848/1347-4065/ac9189
- `fig37_c2h2_n2_rf_pecvd_3d_afm_roughness_scirep2017.png`: 5×5 µm² 3D AFM Surface Topography & Roughness Table of C2H2/N2 RF Plasma Carbon — Ghafouri et al., Sci. Rep. 7, 9149 (2017), Fig. 9 & Table 4 (CC-BY 4.0), https://doi.org/10.1038/s41598-017-09747-4
- `fig38_acnx_3d_afm_grain_roughness_temp_scirep2022.png`: 500×500 nm² 3D AFM Topography, Grain Histograms & Thermal Smoothing of a-CNx — Addie et al., Sci. Rep. 12, 9902 (2022), Fig. 1(a–f) (CC-BY 4.0), https://doi.org/10.1038/s41598-022-14078-0
- `fig39_gapfill_afm_topography_natcomm2019.png`: 5 µm AFM Roughness Maps (Ra = 4.8 vs 8.6 nm) & Ellipsometry/SEM Thickness Uncertainty — Krishtab et al., Nat. Commun. 10, 3729 (2019), Fig. 2(a–d) (CC-BY 4.0), https://doi.org/10.1038/s41467-019-11703-x

Figures under other licenses are not included; the page links to their sources.
