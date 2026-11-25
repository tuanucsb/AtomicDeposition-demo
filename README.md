# PECVD Gap-Fill World Model (static demo)

Interactive demo of the PANG Brain world model for CCP-PECVD amorphous-carbon gap-fill:
turn the recipe knobs, see the predicted fill (animated cross-section), the chance of meeting the
client spec, how each knob moves the prediction, and the optimizer's proposed next batch.
A second tab tracks the knowledge base (literature, datasets, figures, wafer provenance).

Predictions, not measurements. The page runs a browser copy of the brain: a neural network trained
on 6448 of the brain's own predictions (median held-out error
8.3 nm for PH depth, 2.9 nm for overburden). Built 2026-11-25 23:47 UTC
from brain v6. Source code is private.

## Figure credits (republished under their CC-BY licenses)
- `fig01_har10_trench_sem_550c_natcomm2024.png`: 10:1 Aspect-Ratio Trench Cross-Section SEMs at 550 °C (SC = 0.69 -> 0.97) — Souqui / Pedersen et al., Nat. Commun. 15, 10638 (2024), Fig. 2 (CC-BY 4.0), https://doi.org/10.1038/s41467-024-55007-1
- `fig02_lhar_penetration_sem_natcomm2024.png`: Lateral High-Aspect-Ratio (500 nm Gap) Penetration Depth SEM & EDX Profile — Souqui / Pedersen et al., Nat. Commun. 15, 10638 (2024), Fig. 4 (CC-BY 4.0), https://doi.org/10.1038/s41467-024-55007-1
- `fig03_sub100nm_gapfill_sem_natcomm2019.png`: Sub-100 nm (45 nm Half-Pitch) Interconnect Trench Vapor Gap-Fill TEM & EDS — Krishtab et al. (IMEC), Nat. Commun. 10, 3729 (2019), Fig. 4 (CC-BY 4.0), https://doi.org/10.1038/s41467-019-11703-x
- `fig04_pecvd_acnx_fesem_cross_section_scirep2022.png`: Fractured Cross-Section & Surface FESEM of Carbon Nitride (CNx) Thin Films — Al-Kuhaili / Omer et al., Sci. Rep. 12, 9902 (2022), Fig. 2 (CC-BY 4.0), https://doi.org/10.1038/s41598-022-14078-0
- `fig08_pecvd_acnx_raman_nc_temp_scirep2022.png`: Raman D/G & Nitrile C≡N (2150 cm⁻¹) Temperature Contour Map of CNx Films — Al-Kuhaili / Omer et al., Sci. Rep. 12, 9902 (2022), Fig. 4 (CC-BY 4.0), https://doi.org/10.1038/s41598-022-14078-0
- `fig09_ndoped_ac_atomic_strain_scirep2019.png`: Atomic Structures of Nitrogen-Doped Amorphous Carbon (1.56 to 7.81 at.% N) — Jung / Lee et al., Sci. Rep. 9, 19064 (2019), Fig. 1 (CC-BY 4.0), https://doi.org/10.1038/s41598-019-55488-x
- `fig16_c2h2_n2_oes_spectra_cn_c2_ch_scirep2017.png`: Optical Emission Spectra (OES) of Pure C2H2 vs. Nitrogen-Mixed C2H2 RF Plasma — Ghoranneviss et al., Sci. Rep. 7, 9699 (2017), Fig. 2 (CC-BY 4.0), https://doi.org/10.1038/s41598-017-09747-4
- `fig24_autonomous_oes_bayesian_opt_febba2023.png`: Closed-Loop Plasma Bayesian Optimization Converging in 3–5 Runs via OES — Fébba et al., APL Mater. 11, 071119 / arXiv:2305.11122 (2023), Fig. 6 (CC-BY 4.0), https://doi.org/10.1063/5.0159406
- `fig27_ach_cross_section_hrtem_eels_natcomm2017.png`: Cross-Sectional HRTEM & Nanometer EELS π*(C=C) / σ*(C–H) Profile of a-C:H — Chen, Kato & Nosaka, Nat. Commun. 8, 1675 (2017), Fig. 2 (CC-BY 4.0), https://doi.org/10.1038/s41467-017-01717-8
- `fig28_uv_vis_raman_n_carbon_scirep2015.png`: Multi-Wavelength UV (325 nm) & Visible (488 nm) Raman of Ar/N2 Carbon Films — Dwivedi et al., Sci. Rep. 5, 7772 (2015), Fig. 4 (CC-BY 4.0), https://doi.org/10.1038/srep07772
- `fig29_xps_c1s_sp2_sp3_cn_hybridization_scirep2015.png`: Core-Level C 1s XPS Deconvolution (sp² C, sp³ C & C–N/C–O) of Carbon Overcoats — Dwivedi et al., Sci. Rep. 5, 7772 (2015), Fig. 5 (CC-BY 4.0), https://doi.org/10.1038/srep07772
- `fig30_xps_n1s_pyridinic_pyrrolic_bonding_scirep2015.png`: N 1s XPS Spectra Resolving Pyridinic/Graphitic Nitrogen Incorporation in Carbon — Dwivedi et al., Sci. Rep. 5, 7772 (2015), Fig. 6 (CC-BY 4.0), https://doi.org/10.1038/srep07772
- `fig31_ndoped_ac_bond_angle_strain_dist_scirep2019.png`: Radial Pair g(r) & Bond-Angle Strain Distributions in Pure vs. 7.81 at.% N-Doped a-C — Jung / Lee et al., Sci. Rep. 9, 19064 (2019), Fig. 3 (CC-BY 4.0), https://doi.org/10.1038/s41598-019-55488-x
- `fig32_ndoped_ac_fluorine_etch_barrier_mep_scirep2019.png`: Fluorine Etch-Atom Penetration Energy Barrier: N-Doped a-C (4.92 eV) vs. Pure a-C (1.74 eV) — Jung / Lee et al., Sci. Rep. 9, 19064 (2019), Fig. 7 (CC-BY 4.0), https://doi.org/10.1038/s41598-019-55488-x
- `fig33_c2h2_n2_atr_ftir_cn_nh_ch_spectra_scirep2017.png`: ATR-FTIR Spectra of C2H2+N2 RF Plasma Films Across Nitrogen Flow & RF Power — Ghoranneviss et al., Sci. Rep. 7, 9699 (2017), Fig. 5 (CC-BY 4.0), https://doi.org/10.1038/s41598-017-09747-4
- `fig35_realtime_hn_radical_control_har_profile_kambara2022.png`: Real-Time H/(H+N) Radical Ratio Control Eliminating 65 nm HAR Profile Taper — Kambara et al., Jpn. J. Appl. Phys. 62, SA0803 (2022), Figs. 7–8 (CC-BY 4.0), https://doi.org/10.35848/1347-4065/ac9189
- `fig36_ml_har_profile_cd_depth_extraction_kambara2022.png`: Automated Machine-Learning Extraction of CD1, CD2 & Depth from Cross-Section SEMs — Kambara et al., Jpn. J. Appl. Phys. 62, SA0803 (2022), Fig. 35 (CC-BY 4.0), https://doi.org/10.35848/1347-4065/ac9189

Figures under other licenses are not included; the page links to their sources.
