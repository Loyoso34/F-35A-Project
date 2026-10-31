# Public data sources — F-35A Lightning II flight model

This file records where every number in the flight model comes from. Each value is
tagged:

| Tag | Meaning |
|-----|---------|
| **[V]** | **Verified public data** — published by the manufacturer, the operator or an official fact sheet. |
| **[E]** | **Engineering approximation** — derived from public geometry, published data for a comparable aircraft, or a standard aerospace method. The derivation is shown. |
| **[T]** | **Tuned approximation** — chosen so the simulation reproduces publicly observed *behaviour* when no usable public number exists. |

No classified data is used, reproduced or inferred. Where the real aircraft's
characteristics are not public (control laws, detailed aerodynamic tables, exact
inertias, exact installed thrust schedules), this model uses generic aerospace
methods and says so.

---

## 1. Geometry and mass

| Quantity | Value | Tag | Source / derivation |
|---|---|---|---|
| Length | 15.7 m (51.4 ft) | **[V]** | Lockheed Martin F-35A specification; USAF F-35A fact sheet. |
| Wingspan | 10.7 m (35.0 ft) | **[V]** | Lockheed Martin F-35A specification; USAF F-35A fact sheet. |
| Height | 4.38 m (14.4 ft) | **[V]** | Lockheed Martin F-35A specification. |
| Wing area | 42.7 m² (460 ft²) | **[V]** | Lockheed Martin F-35A specification. |
| Aspect ratio | 2.68 | **[E]** | b²/S = 10.7² / 42.7. |
| Mean aerodynamic chord | 4.0 m | **[E]** | Derived from the published planform: trapezoidal MAC of a 10.7 m span, 42.7 m² wing with the published root/tip chord ratio read off official three-view imagery. |
| Empty weight | 13 300 kg (29 300 lb) | **[V]** | USAF F-35A fact sheet. |
| Internal fuel | 8 278 kg (18 250 lb) | **[V]** | Lockheed Martin F-35A specification (internal fuel capacity). Rounded to 8 300 kg in code. |
| Max takeoff weight | 31 800 kg (70 000 lb) | **[V]** | USAF F-35A fact sheet. |
| Simulated clean takeoff mass | 21 600 kg | **[E]** | Empty + full internal fuel. This is the mass the model uses at spawn. |

**Measured model geometry** (airframe bounding box, excluding light billboards and
the additive exhaust plume): length **15.75 m**, span **10.70 m**, height **4.48 m**
with the gear extended — against the published 15.7 / 10.7 / 4.38 m. The exhaust
section length and the vertical-tail height are set *from* those published figures
rather than chosen by eye. The model is the **F-35A (CTOL)** only: there is no lift
fan, no STOVL roll post, no enlarged wing, no wing fold and no arrestor hook.

## 2. Centre of gravity and inertia

The real F-35A CG range and inertia tensor are **not public**. The values below are
engineering approximations and are labelled as such in the code.

| Quantity | Value | Tag | Derivation |
|---|---|---|---|
| CG longitudinal station | 0.32 c̄ aft of the MAC leading edge | **[E]** | Conventional relaxed-stability fighter placement. Real value not public. |
| I_xx (roll) | 38 100 kg·m² | **[E]** | Scaled from published F-16A values (I_xx 12 875 kg·m² at 9 300 kg, NASA/USAF public flight-dynamics reports) by mass ratio 21 600/9 300 = 2.32 and span ratio (10.7/9.45)² = 1.28. |
| I_yy (pitch) | 197 300 kg·m² | **[E]** | Same method: F-16A I_yy 75 674 kg·m², × 2.32 × (15.7/14.8)² = 1.13. |
| I_zz (yaw) | 240 100 kg·m² | **[E]** | Same method: F-16A I_zz 85 552 kg·m², × 2.32 × 1.21. |
| I_xz (product) | 3 700 kg·m² | **[E]** | Same method from F-16A I_xz 1 331 kg·m². |

The *ratios* matter more than the absolute values, because inertia (gyroscopic)
coupling is driven by (I_zz − I_xx)/I_yy and (I_xx − I_yy)/I_zz. Those ratios are
1.02 and −0.67 here, which is typical for a single-engine fighter.

## 3. Aerodynamics

The real F-35 aerodynamic database is not public. The model uses **standard
published aerodynamic theory** with coefficients fitted to public *performance and
behaviour* statements.

| Quantity | Value | Tag | Derivation |
|---|---|---|---|
| Lift model | Polhamus leading-edge-suction analogy | **[E]** | E. C. Polhamus, *A concept of the vortex lift of sharp-edge delta wings based on a leading-edge-suction analogy*, NASA TN D-3767 (1966). Public method. CL = K_p·sinα·cos²α + K_v·sin²α·cosα. Appropriate for the F-35's chined forebody and highly swept leading edge, which generate vortex lift. |
| K_p (potential-flow term) | 3.25 | **[E]** | Low-aspect-ratio lifting-line: CL_α = πAR/(1+√(1+(AR/2)²)) = π·2.68/(1+√(1+1.796)) = 3.15 /rad, plus a small body/chine contribution. |
| K_v (vortex-lift term) | 2.60 | **[T]** | Chosen so CL_max ≈ 2.0 occurs near 40° AoA, which reproduces the publicly demonstrated ability to fly controlled at very high AoA (~50°) and at low speed. |
| Vortex breakdown | begins ~42°, complete ~75° | **[T]** | Models the loss of vortex lift at extreme AoA. Chosen so CL decays smoothly instead of collapsing. |
| CD0 (clean) | 0.0190 | **[E]** | Clean parasite drag for a stealth fighter with internal carriage (open conceptual-design estimates for the F-35 class are ~0.019–0.025). The earlier 0.0165 gave an idle deceleration of only ~1.5 kt/s from 480 kt at low level. |
| Oswald efficiency e | 0.78 | **[E]** | Typical for a low-AR fighter planform. |
| Wave drag rise | starts M 0.92, peaks M 1.12 | **[E]** | Standard transonic drag-rise shape. Magnitude tuned so level-flight maximum is ≈ M 1.6 at altitude, matching the published maximum speed. |
| Max speed | Mach 1.6 | **[V]** | USAF F-35A fact sheet. Used as the *target* the drag model must reproduce, not as a hard limit in code. |
| Max load factor | 9 g | **[V]** | USAF F-35A fact sheet ("9 g" for the F-35A). Used as the FCS command limit. |
| Service ceiling | above 50 000 ft | **[V]** | USAF F-35A fact sheet. |
| Negative AoA envelope | soft −10°, full cut −16° | **[T]** | No public figure. Full forward stick targets −10°; the limiter is a continuous band from −10° to −16°. The negative load-factor target is limited to what −10° can produce at the current speed, altitude and Mach, so the g limit (−3 g) is reached only at sufficient speed. |
| Maximum AoA demonstrated | ≈ 50° | **[V]** | Publicly released F-35 high-AoA flight-test information and official F-35 demonstration material. Used as the design point for the FCS AoA limiter. |
| Lateral/directional derivatives | see `js/aerodata.js` | **[E]/[T]** | Conventional fighter values with AoA scheduling. C_nβ is reduced but **kept positive** at high AoA, reflecting the F-35's canted vertical tails, which retain directional stability where a conventional tail would not. |
| Roll damping C_lp (total) | −0.363 | **[E]** | Not a single typed constant. The wing's share is produced by a **strip model**: at roll rate *p* the down-going wing sees local Δα = +p·(0.32b)/V and the up-going wing −Δα, and each half-wing's CL is evaluated on the *same* lift curve. In the linear region this yields C_lp(wing) = −k·1.28·K_p = −0.28 with k = 0.068. A residual −0.080 covers fuselage and tail. |
| C_ldr (roll due to rudder) | −0.012 | **[E]** | The vertical tails act above the CG, so rudder deflection produces a small roll in the same direction as the yaw it commands. |
| Wave-drag magnitude C_Dwave | 0.0443 | **[E]** | Solved from the thrust/drag equilibrium at the published maximum speed rather than guessed: at 36 000 ft and M 1.6, q̄·S ≈ 1.73 MN and installed AB thrust ≈ 110 kN, so CD0(supersonic) must be ≈ 0.062. The model reaches M 1.57 at 36 000–40 000 ft. Reduced from 0.047 when CD0 was raised so that the supersonic total (CD0 + wave ≈ 0.060 at M 1.6) is unchanged. |

### Emergent stall, wing drop and autorotation

The strip model above is the reason there is **no stall mode** anywhere in the code.
Below stall the down-going wing gains lift, so the term opposes the roll — that *is*
roll damping. Above stall the down-going wing is past CL_max and *loses* lift, the
difference changes sign, and the same single expression now *drives* the roll. Wing
drop and autorotation therefore emerge from one continuous equation instead of from
a threshold, a timer, or an artificial torque.

### Body-axis sign convention

The aerodynamic body frame is x forward, y right, z down; the render frame is
+X right, +Y up, −Z forward. Therefore

    ω = p·x_fwd + q·y_right + r·z_down  =  (q, −r, −p) in render axes.

The yaw component is **−r**. This matters: with the sign inverted, positive *r*
(nose right in the aerodynamic convention) rotates the nose *left*, which turns
C_nβ·sinβ from weathercock **stability** into weathercock **instability** and makes
sideslip diverge under positive feedback. `test/axischk.mjs` verifies the mapping
numerically.

### What "100 knots at high AoA" means in this model

Public demonstration material shows controlled flight at very high AoA around
100 kt. This model does **not** hardcode that. It falls out of the physics:

At 40° AoA, CL ≈ 2.0 and the thrust vector has a large vertical component. With
max afterburner, T·sin(40°) = 191 kN × 0.643 = 123 kN, which supports ~58 % of the
21 600 kg weight on its own. The wing then only has to carry the remainder, so the
equilibrium speed drops far below the 1-g stall speed. The model reproduces this
because thrust is applied along the body axis and resolved into the flight-path
frame, not because a number was typed in.

## 4. Propulsion — Pratt & Whitney F135-PW-100

| Quantity | Value | Tag | Source |
|---|---|---|---|
| Military (dry) thrust | 124.5 kN (28 000 lbf) | **[V]** | Pratt & Whitney F135 public specification; widely published F-35A figure. |
| Maximum (afterburning) thrust | 191.3 kN (43 000 lbf) | **[V]** | Pratt & Whitney F135 public specification. |
| Thrust lapse with density | (ρ/ρ₀)^0.85 | **[E]** | Standard turbofan lapse exponent for a low-bypass military engine. |
| Ram effect with Mach | 1 − 0.28M + 0.42M² | **[E]** | Standard shape for a low-bypass afterburning turbofan: net thrust dips slightly around M 0.3 then rises with ram recovery. Fitted so full-AB thrust at M 1.6 is ≈ 1.44 × the static value. |
| Supersonic inlet recovery loss | ram × (1 − 0.55 (M − 1.3)²) above M 1.3 | **[E]** | The F-35 uses a fixed-geometry diverterless (DSI) inlet, whose pressure recovery falls off with shock losses at higher supersonic Mach. Without this term the ram-recovery curve kept thrust growing faster than drag and the model crept to M 1.74 in a long full-AB run; with it the equilibrium is M 1.59–1.60 at 36 000 ft, matching the published M 1.6. Subsonic thrust is unchanged. |
| Spool time, idle → military | ≈ 4.5 s to 90 % | **[T]** | No public F135 spool schedule exists. Chosen as typical for a large military turbofan. |
| Idle ram drag | net idle thrust × (1 − 1.45 M) | **[E]** | At idle the engine's gross thrust barely exceeds its inlet momentum drag, so net idle thrust falls with flight speed and reaches ~0 around M 0.7. Static idle thrust (and therefore ground behaviour) is unchanged. |
| Afterburner light-off | 0.22 s delay, then ≈ 1.5 s staged rise; ≈ 0.35 s cut | **[E]** | Typical for an augmented turbofan: ignition and manifold fill, then zone-by-zone light-up. No public F135 figure. The rise follows an S-curve, so thrust (and the plume) never switch on like a binary light. |

**Note on thrust figures.** Public sources sometimes quote the F135 by *thrust
class* rather than an exact installed number, and installed thrust differs from
uninstalled bench thrust. This model uses the two widely published figures above
consistently and does not mix sources.

## 5. Flight control system

The F-35's actual control laws are **classified and are not modelled**. What this
simulator implements is a *generic modern-fighter fly-by-wire architecture*
constructed only from publicly described **behaviour**:

- Public F-35 flight-test material describes **care-free handling** at high AoA.
- The F-35A is publicly described as a **9 g** aircraft.
- Public material describes sustained controlled flight at **very high AoA**.

From those three public statements the model implements: a g-command law at high
dynamic pressure blending to an AoA-command law at low dynamic pressure, an AoA
limiter, a g limiter, velocity-vector roll, and an AoA-scheduled roll-rate limit.
All gains are **[T]**. No claim is made that these match the real aircraft.

Generic design choices, also **[T]** (common to modern fly-by-wire fighters, not
F-35 data):

- **Continuous limiters.** The AoA and g limits are smooth bands in both directions;
  the commanded load factor saturates softly at the aerodynamic envelope (C¹ knee)
  instead of being clipped, and no limit switches the command discontinuously.
- **Gear-down (takeoff/landing) law.** With the gear down, on the ground and in the
  air, the stick commands pitch rate (12°/s at full stick) with attitude hold when
  released; the ground law limits the commanded attitude to 12°. The law blends
  continuously into the up-and-away law while the gear retracts.
- **Roll–pitch coupling limit.** The roll-rate ceiling falls continuously with pitch
  rate so that the inertial yaw moment (I_xx − I_yy)·p·q stays within 60 % of the
  rudder's authority, leaving margin for sideslip control.
- **Actuators.** First-order lag (35 ms) with a hard rate limit (4 full-deflection
  units/s).

**Ground contact [E].** Pitch on the ground is a physical rotation about the main-gear
contact, derived from the model's own gear geometry: main gear 0.8 m aft of and
2.25 m below the CG, nose gear 4.3 m ahead. The nose lifts when the aerodynamic
pitching moment overcomes the weight's moment about the main gear; the tail-strike
attitude (~14.5°) is the geometric angle from the main-wheel contact to the nozzle
underside. Lift-off happens when the net vertical force turns upward.

## 6. What is deliberately **not** modelled

- Stealth, radar cross-section, sensors, electronic warfare, mission systems.
- Real control-law structure, gains, or limiter logic.
- Real aerodynamic tables, real inertia tensor, real CG envelope.
- Store carriage, asymmetric loading, weapons.

## 7. Real-world region: Bodrum, Muğla, Türkiye (v3.8.0, extended in v3.9.0)

Everything below is open data that may be redistributed with attribution. The files are baked by
`tools/geodata/bake.py` into `geo/bodrum/` and served from the same origin as the app (no API key,
no third-party tile service, no usage quota). The in-app attribution is in **Settings** and in the
hangar.

### Data sets

| Data | Source | Licence / required attribution | Use |
|---|---|---|---|
| Elevation | AWS Open Data **Terrain Tiles** (Mapzen/Tilezen, Terrarium encoding); here EU-DEM (Copernicus, ~25 m), SRTM, ETOPO1 | Free; "Produced using Copernicus data and information funded by the European Union - EU-DEM layers"; SRTM: U.S. Geological Survey; ETOPO1: NOAA | 30 m (z12) core, 195 m (z9) outer ring |
| Imagery | **Copernicus Sentinel-2 L2A** surface reflectance, bands B04/B03/B02 (10 m), AWS Open Data `sentinel-cogs` | Copernicus free, full and open licence; "Contains modified Copernicus Sentinel data 2024" | Albedo texture, z13 (15 m) core, z10 (120 m) outer ring |
| Water mask | Sentinel-2 B03/B08 (NDWI ≥ 0.1) on land; **OSM coastline** at sea (v3.9) | as above / ODbL | Physics `water` surface, sea shading |
| Buildings, roads, aeroways, coastline | **Overture Maps Foundation** release 2026-10-21.0 (AWS Open Data, anonymous S3): OpenStreetMap + Microsoft ML Building Footprints | ODbL — "© OpenStreetMap contributors"; Microsoft Building Footprints (ODbL); Overture Maps Foundation | 3D buildings, roads, LTFE taxiways/aprons/stopways/buildings, land polygons (coastline) |
| Land cover | **ESA WorldCover** 10 m 2021 v200 | CC BY 4.0 — "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium" | Tree / shrub / grass fractions for vegetation placement |
| Aerodrome reference point, runway lengths/widths/threshold elevations | **OurAirports** `airports.csv`, `runways.csv` | Public domain | LTFE |
| Geoid undulation | EGM96 (npm `egm96-universal` 1.1.1, MIT) | — | Ellipsoidal height = MSL + N |
| Magnetic declination | NOAA **WMM-2025** (npm `geomagnetism` 0.2.0, Apache-2.0) | — | Magnetic heading on the HUD |

Scenes: `S2A_35SNB/35SNA/35SMA/35SMB/35SMC/35SNC_20241003`, `S2B_35SPA/35SPB/35SPC/35SNA_20241005`
(cloud cover ≤ 0.01 % on the core tiles). The simulator's sun is set to the acquisition geometry of
the primary scene (azimuth 162.2°, elevation 46.8°, 2024-10-03 09:10 UTC), so real-time lighting
and shadows agree with the shadows that are part of the imagery.

### Processing (all reproducible with `tools/geodata/bake.py`)

| Step | Tag | Detail |
|---|---|---|
| Reflectance scale | **[V]/[E]** | ρ = DN × 10⁻⁴. The STAC metadata lists an additional −0.1 offset, but the 1st percentile of blue DN is 1, which the offset would turn into impossible negative reflectance; these COGs are already harmonised. |
| Texture encoding | **[E]** | Stored as sRGB(ρ × 1.6) (WebP, q 74–78), the shader multiplies by 1/1.6: the texture is physical albedo, consistent with the PBR lighting. The stock "TCI" product clips at ρ ≈ 0.2 and saturates concrete and white houses, so it is not used. |
| Sea harmonisation | **[E]** | Sen2Cor's atmospheric correction over water differs between scenes (deep-water blue ρ from 0.0004 to 0.02 here). Each scene's water (selected by distance > 500 m from the DEM coastline, not by reflectance) is offset additively to the primary scene's deep-water median (0.0006, 0.0035, 0.0110), fading to the original within 60 m of the coast. |
| Water mask | **[E]** | v3.9: **sea = outside the OSM land polygons** (Overture `base/land`, subtype `land`, rasterised with 4×4 supersampling per DEM cell), except where the DEM is ≥ 15 m (a coastline offset at a cliff stays land: 7 213 cells). **Inland water** (lakes, reservoirs) = NDWI ≥ 0.1 on B03/B08, majority per cell, on OSM land. Before v3.9 NDWI alone decided: sun glint on the 2024-10-03 scenes pushed NDWI below 0.1 over most of the Gulf of Gökova, which was baked as 0.5 m land (≈ 2.4 M z12 cells). The scene classification (SCL class 6) is not used: it labels LTFE's dark runway asphalt as water. NDWI false positives inside the aerodrome are cleared. |
| Sea no-data | **[E]** | Terrarium z12 has no bathymetry (the sea is exactly 0 m). Where the z9 grid has seabed or there is no Sentinel-2 coverage, the z12 cell takes the bilinear z9 value. This also restores the relief of the part of Kalymnos (≈ 37.03 N 26.98 E) whose z12 Terrarium tile is empty. |
| DEM spikes | **[E]** | Terrarium z9 contains isolated bad cells (4952 m on Leros, real summit ≈ 320 m; 3546 m near Arki; 1202 m on Symi; two cells of 779/528 m among 6–60 m terrain at 36.92 N 28.14 E). A cell > 400 m above the median of its 5×5 neighbourhood is replaced by that median (iterated): 12 cells. z12 has no such spikes (largest excess over the 5×5 median: 39 m, real terrain). |
| Imagery registration | **[E]** measured | 2D correlation of rasterised OSM features against Sentinel-2 reflectance at three sites: the imagery is shifted +6 m E, +12 m N onto OSM before mosaicking (DEM water mask uses the same transform). |
| DEM quantisation | **[E]** | Terrarium tiles re-quantised to 0.25 m (still decodable by any Terrarium decoder; half the size). Blue bit 0 = water flag. Sea clamped to 0 m MSL (the water surface). |
| Vertical datum | **[V]** | DEM and OurAirports elevations are orthometric (≈ MSL, EGM96 geoid). Physics `y = h_MSL − 4` (`WATER_LEVEL`), so the HUD's MSL altitude is unchanged. |

### Milas–Bodrum Airport (LTFE)

| Quantity | Value | Tag | Source / derivation |
|---|---|---|---|
| Runways | 10L/28R, 10R/28L (parallel) | **[V]** | OurAirports `runways.csv` (records 239233, 336567). The official Turkish AIP (DHMİ) was not reachable from the build environment. |
| Length × width | 3000 × 45 m (10L/28R), **2496 × 45 m (10R/28L)** | **[V]/[E]** | 10L/28R: OurAirports 9843 ft, OSM ends 3000.6 m apart. 10R/28L: v3.8 used OurAirports' 9646 ft (2940 m), but the OSM runway way (ends 2495.5 m apart) and OurAirports' own 10R/28L coordinates agree on ≈ 2496 m; the imagery shows the pavement ending there. v3.9 uses the OSM ends. |
| Axis | 106.6° true (106.2° UTM grid) | **[E]** measured | Best-fit axis of the pavement in the 10 m Sentinel-2 bands (sharpest cross-track profile); identical to the bearing between OurAirports' 10L and 28R coordinates (106.21°). OurAirports' text field "104°T" is inconsistent with its own coordinates and is not used. |
| Centrelines | 10L/28R 185 m north of 10R/28L | **[E]** measured | Cross-track reflectance profile (10 m pixels, ±5 m). |
| Thresholds / ends | OSM runway ways (v3.9) | **[V]** OSM | Stopway pads from OSM `aeroway=stopway` (10L 60 m, 28R 62 m, 10R 61 m). The v3.8 statement that OurAirports' 28L coordinate is "500 m short" was wrong: the runway is 2496 m long. |
| Threshold elevations | 10L 9 ft, 28R 21 ft, 10R/28L 14 ft | **[V]** | OurAirports; the DEM independently gives 2.9 m and 5.6 m at 10L/28R (±1 m). |
| Designators | 10L/28R, 10R/28L | **[V]** | Published; consistent with 106.6° true − 5.41° E (WMM-2025) = 101.2° magnetic. |
| Lighting | edge, threshold/end lights only | **[V]**/omitted | Runways are lit (OurAirports). The approach-lighting system, PAPI (side/angles), taxiway lights, signs and the control tower position could not be verified and are **not** built. |
| Taxiways, aprons, stopways | OSM `aeroway=*` geometry | **[V]** OSM | Centrelines and apron polygons from OSM. Taxiway **width 23 m is approximate** (ICAO code E practice; OSM has no width tag here). Yellow centreline 0.3 m. |
| Runway-holding positions | 90 m from the nearest runway centreline segment | **[E]** approximate | Pattern A lines where an OSM taxiway crosses 90 m (typical ICAO distance for code 4 instrument runways). The real positions were **not** surveyed. |
| Aerodrome buildings | 129 OSM footprints (terminals, hangars, others) | **[V]** footprint / **[E]** height | Heights are approximate unless OSM tags them: terminals 16 m, hangars 14 m, industrial 8 m, others by area (4.5–10 m). Collision uses the footprint polygon. |

### Buildings, roads and vegetation (v3.9)

| Item | Tag | Detail |
|---|---|---|
| Building footprints | **[V]** | 306 068 footprints in the core box (OSM 26 193; the rest Microsoft ML footprints via Overture). Excluded: inside the OSM aerodrome polygon, underground, < 12 m² or > 60 000 m². Stored as oriented boxes (`tools/geodata/vectors.py`), so complex footprints are simplified. |
| Building heights | **[E]** mostly approximate | OSM `height` (41 buildings), else `building:levels` × 3.0 m + 1.0 m (653), else an **approximation** from footprint area and type (Aegean 1–2 storey housing, 2–4 storey blocks; sheds 3 m, greenhouses 4 m, industrial 7–9 m, mosques 9 m): **99.8 % of heights are approximate.** Roof shape: pitched (hipped) or flat by type/hash, not from data. No landmark is modelled individually. |
| Roads | **[V]** geometry / **[E]** width | OSM road classes motorway … track; tunnels and footways skipped; widths by class (22 m motorway … 3.5 m track) are approximations. Draped on the terrain with 20 m resampling; bridges linearised. |
| Vegetation | **[E]** | ESA WorldCover fractions per ≈ 30 m cell: trees ≤ 5 (× quality factor) and shrubs ≤ 4 per cell at full cover. This is a **sparse visual representation**, not a tree inventory; species and heights are not from data (generic pine and shrub models). |

## 8. Instruments (v3.9.0)

| Indication | Definition in the simulator | Tag |
|---|---|---|
| IAS | **Calibrated airspeed** from pitot impact pressure: subsonic isentropic `qc = p((1 + 0.2M²)^3.5 − 1)`, supersonic Rayleigh pitot `qc = p(166.92 M⁷ / (7M² − 1)^2.5 − 1)`, then `CAS = a0 √(5((qc/p0 + 1)^(2/7) − 1))`. No position/instrument error. Before v3.9 the IAS shown was EAS (`V√σ`), which reads 16 kt low at FL300 M0.80 (288 vs 304 kt). | **[V]** standard relations |
| EAS, TAS, Mach | `V√σ`, airspeed, `V/a` (ISA) | **[V]** |
| GS, track | Horizontal ground-relative velocity (before v3.9: the 3D speed, which over-read in climbs and dives) | **[V]** |
| Altitude MSL, RA | MSL above the sea surface datum; radar altitude from the main-gear bottom to the terrain/sea below (buildings are not included) | **[V]**/**[E]** |
| Heading | Grid → true (meridian convergence) → magnetic (WMM-2025) on the HUD in the real-world region | **[V]** |
| G, AoA | Body-axis load factor and angle of attack from the flight model | model output |

Tests: `tools/flighttest/instruments.mjs` (CAS at sea level = TAS; M1.0 at the tropopause = 341.7 KCAS by hand calculation; continuity at M = 1; GS = TAS·cos γ in a climb; 30 kt headwind; RA on a plateau).

## 9. Time of day (v3.9.0)

Sun position from the Astronomical Almanac low-precision formulas (`js/sun.js`, ≈ 0.01° 1950–2050, no refraction) at the region reference point on the imagery date (2024-10-03), local time UTC+3. Check: at the imagery time it gives azimuth 162.19°, elevation 47.04° against the Sentinel-2 metadata 162.2° / 46.83° (the metadata refers to the scene centre). Presets: 12:10 (imagery time, default), 08:30, 16:30, 18:25 (sun 4° high). Sky and light colours warm with low sun by an artistic blend, not a scattering model. Limitation: the imagery keeps the shadows of its own acquisition time; at other times only the real-time relief lighting follows the new sun. No night. Not available in the fictional training world (its building shadows are baked for a fixed sun).

---

*All figures above are from open publications. Where a number could not be found in
a public source it is marked **[E]** or **[T]** and the reasoning is given, rather
than being presented as fact.*
