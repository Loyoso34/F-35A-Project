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
| CD0 (clean) | 0.0165 | **[E]** | Typical clean parasite drag for a stealth fighter with internal carriage; consistent with the published subsonic combat radius class. |
| Oswald efficiency e | 0.78 | **[E]** | Typical for a low-AR fighter planform. |
| Wave drag rise | starts M 0.92, peaks M 1.12 | **[E]** | Standard transonic drag-rise shape. Magnitude tuned so level-flight maximum is ≈ M 1.6 at altitude, matching the published maximum speed. |
| Max speed | Mach 1.6 | **[V]** | USAF F-35A fact sheet. Used as the *target* the drag model must reproduce, not as a hard limit in code. |
| Max load factor | 9 g | **[V]** | USAF F-35A fact sheet ("9 g" for the F-35A). Used as the FCS command limit. |
| Service ceiling | above 50 000 ft | **[V]** | USAF F-35A fact sheet. |
| Maximum AoA demonstrated | ≈ 50° | **[V]** | Publicly released F-35 high-AoA flight-test information and official F-35 demonstration material. Used as the design point for the FCS AoA limiter. |
| Lateral/directional derivatives | see `js/aerodata.js` | **[E]/[T]** | Conventional fighter values with AoA scheduling. C_nβ is reduced but **kept positive** at high AoA, reflecting the F-35's canted vertical tails, which retain directional stability where a conventional tail would not. |
| Roll damping C_lp (total) | −0.363 | **[E]** | Not a single typed constant. The wing's share is produced by a **strip model**: at roll rate *p* the down-going wing sees local Δα = +p·(0.32b)/V and the up-going wing −Δα, and each half-wing's CL is evaluated on the *same* lift curve. In the linear region this yields C_lp(wing) = −k·1.28·K_p = −0.28 with k = 0.068. A residual −0.080 covers fuselage and tail. |
| C_ldr (roll due to rudder) | −0.012 | **[E]** | The vertical tails act above the CG, so rudder deflection produces a small roll in the same direction as the yaw it commands. |
| Wave-drag magnitude C_Dwave | 0.047 | **[E]** | Solved from the thrust/drag equilibrium at the published maximum speed rather than guessed: at 36 000 ft and M 1.6, q̄·S ≈ 1.73 MN and installed AB thrust ≈ 110 kN, so CD0(supersonic) must be ≈ 0.062. The model reaches M 1.57 at 36 000–40 000 ft. |

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
| Spool time, idle → military | ≈ 4 s | **[T]** | No public F135 spool schedule exists. Chosen as typical for a large military turbofan. |
| Afterburner light-off | ≈ 0.7 s | **[T]** | Typical; no public figure. |

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

## 6. What is deliberately **not** modelled

- Stealth, radar cross-section, sensors, electronic warfare, mission systems.
- Real control-law structure, gains, or limiter logic.
- Real aerodynamic tables, real inertia tensor, real CG envelope.
- Store carriage, asymmetric loading, weapons.

---

*All figures above are from open publications. Where a number could not be found in
a public source it is marked **[E]** or **[T]** and the reasoning is given, rather
than being presented as fact.*
