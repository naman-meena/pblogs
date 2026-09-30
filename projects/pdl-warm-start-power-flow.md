---
title: Label-Free Warm-Start Learning for Newton-Raphson Power Flow
summary: A self supervised graph attention model that gives Newton-Raphson power flow a better starting point, with no converged solutions needed for training. Accepted at NPSC 2026.
date: 2026-08-09
status: completed
tags: power-systems, graph-attention-networks, self-supervised-learning, primal-dual, research, npsc-2026
link: https://github.com/naman-meena/PDL
---

> **Update:** this work was submitted to the National Power Systems Conference (NPSC 2026)
> and has been accepted.

## What this project is about

Every study a grid operator runs, from a contingency screen to a market clearing check,
starts by answering one question: given the power drawn at each bus, what is the voltage
magnitude and angle everywhere in the network? Those relations are nonlinear, so the answer
comes from an iterative solver, and in practice that solver is Newton-Raphson.

Newton-Raphson is only as reliable as the point you hand it. The textbook choice, called the
flat start, assumes every bus sits at 1.0 per unit with zero angle. On a meshed network at
nominal load that assumption is close enough and the iteration settles in a handful of steps.
Push the loading up and it stops working. The solver wanders off or oscillates, and it does
so precisely on the heavily stressed operating points that security assessment cares about,
because those are the points where the grid is closest to its limits.

A learned initializer is an appealing fix, and several groups have built one, from
convolutional hot starts to deep initializers paired with homotopy continuation. Almost all
of them are trained by supervision, which means the training set has to be a library of
already converged Newton-Raphson solutions. That is where the idea folds in on itself. To
teach a model to rescue the cases the solver cannot handle, you first need the solver to
handle them. The label you need is the answer you were trying to reach.

This project removes that dependency. We train the initializer against the physics rather
than against solutions, so the training signal comes from the AC power-balance equations and
the bus-admittance matrix instead of from a labelled dataset. Newton-Raphson is still the
final solver, so the accuracy and feasibility of every reported operating point is the
solver's, not the network's. All the model does is choose where the iteration begins.

## What the problem actually is

Write the state of the grid as `x = [Pg, Qg, V, theta]`, meaning generator active and
reactive injections, voltage magnitudes and voltage angles at every bus. Newton-Raphson is
handed a complete state, usually read straight from the case file, and then holds fixed
whatever the bus types dictate: active injections at non-slack generators, voltage magnitude
at PV and slack buses, and the slack angle. Everything else is updated until the nodal power
mismatch drops below tolerance.

The warm-start problem is to replace that initial state with something better. Given only the
bus demands and the topology, we want a mapping

```
x_initial = g_w(Pd, Qd ; Ybus)
```

whose output lets Newton-Raphson converge inside an iteration budget. In our setup the
initializer seeds three of the four blocks, namely the voltage magnitudes, the voltage angles
and the generator active powers. Generator reactive power is deliberately left out, since
Newton-Raphson reconstructs it during the solve and feeding it a predicted value adds no
information.

Two things make this hard. Supervision is unavailable for the reasons above, and a generic
attention model has no idea that a power grid is a physical object. Ordinary self attention
happily mixes information between two buses that share no branch at all, and even a masked
version treats a heavy transmission corridor and a weak radial tap as equally important
neighbours. Both issues had to be addressed for the initializer to be useful.

## What we did

The design has three parts working together.

**Learning from residuals instead of labels.** A primal graph attention network maps the
per-bus demands to a full state estimate. That estimate is pushed through a differentiable
physics layer, which reassembles the complex bus voltages, evaluates the implied complex
injections from the admittance matrix, and returns the active and reactive power-balance
residuals. Those residuals are the training signal. Nothing in the loss requires knowing what
the correct answer looks like.

**Casting the training as an augmented Lagrangian, solved primal-dual.** Driving the residual
down with a plain quadratic penalty works badly, because a penalty large enough to matter
also makes the gradients unusable. Instead we treat power balance as a constraint and write
the augmented Lagrangian, which combines a multiplier term with a quadratic penalty. A second
graph attention network, the dual network, predicts the per-bus Lagrange multipliers, trained
by mean squared error against dual-ascent targets. Those targets come from a frozen copy of
the dual network shifted by the current residual, which stops the dual update from chasing
its own output. The two networks are then trained in an alternating loop. Only the primal
network is needed at inference time.

**Making attention respect the electrical network.** The attention layer is constrained
twice. First the attention logits are hard-masked to the sparsity pattern of the admittance
matrix together with self loops, so a bus can only attend to its actual neighbours and to
itself. Second, to distinguish a strong coupling from a weak one, we add a normalized
admittance-magnitude matrix to the logits before the softmax, scaled by a learnable
per-head coefficient. The mask decides which buses exchange information, and the admittance
bias decides how loudly. A single global multi-head layer at the end lets information travel
across the whole grid once the local structure has been respected.

Training stability needed some care, since both networks start from scratch with no offline
targets. A bad primal estimate creates a large residual, the dual network answers with large
multipliers, and the primal gradients blow up. Two mechanisms hold this in check. The primal
network is pre-trained on its own with the multipliers set to zero, so the loss reduces to a
penalized sum of squared residuals and the network first learns coarse electrical behaviour
such as the shape of voltage drops and the spread of angles. We used 15 pre-training epochs
on the 39 and 118-bus systems and 10 on the 300 and 1354-bus systems. After that the penalty
weight follows an adaptive schedule: the worst residual in the system is tracked through its
infinity norm, and whenever it fails to fall by a set factor between checkpoints, the penalty
is multiplied up towards a ceiling. The schedule is a heuristic and certifies nothing about
the predicted state on its own, which is fine, because the tolerance that matters is enforced
by the Newton-Raphson solve that follows.

## The architecture

![Primal-dual learning pipeline: a GAT encoder feeds task-specific heads that predict generator power and bus voltages, a second GAT encoder predicts the Lagrange multipliers, and the two are trained in an alternating primal-dual loop driven by power-balance residuals.](../../images/pdl-warm-start-power-flow/archi_tikz.png){wide}
The complete pipeline. Reading down the left, the only inputs are the per-bus active and
reactive demand, a two-dimensional feature per node, plus the topology carried by the
admittance matrix and its adjacency pattern. Voltage magnitude is never an input; it is part
of the state being predicted. The primal branch, in blue, runs a GAT encoder and four
task-specific heads, one each for generator active power, generator reactive power, voltage
magnitude and voltage angle. Its predictions go directly into the augmented Lagrangian, built
from the power residuals and the multipliers, with no data-fitting term anywhere in it. The
dual branch, in green, runs its own encoder and two heads for the active and reactive
multipliers, and is fit to dual-ascent targets generated from the cached frozen copy and the
current residual. The two branches update in alternation inside an outer iteration that also
raises the penalty weight. At inference only the primal branch runs, which is why the cost of
warm starting stays small.

## The training loop

The whole procedure fits on one page. One call performs a round of primal updates against
frozen multipliers, then a round of dual updates against a frozen dual reference, then
refreshes the penalty weight. Below, `w` are the primal weights and `phi` the dual weights,
so `theta` keeps its usual meaning of voltage angle.

```
Algorithm 1   Self-supervised primal-dual training loop

Input : demand profiles (Pd, Qd); primal epochs K_p; dual epochs K_d;
        penalty weight rho
Output: updated PrimalGAT_w, updated DualGAT_phi, worst residual V_max

 1  for iter = 1 .. K_p:                          # primal phase
 2      for each minibatch (Pm, Qm):
 3          x      <- PrimalGAT_w(Pm, Qm)         # x = [Pg, Qg, V, theta]
 4          lam    <- DualGAT_phi(Pm, Qm)         # evaluated, no grad tracking
 5          r      <- PhysicsLayer(x, Ybus, Pm, Qm)     # r = [r_P ; r_Q]
 6          L_pri  <- E[ lam' r + (rho/2) * ||r||^2 ]
 7          update w by gradient descent on L_pri

 8  phi_old <- phi                                # freeze the dual reference
 9  lam_old <- DualGAT_phi_old(Pd, Qd)

10  for iter = 1 .. K_d:                          # dual phase
11      for each minibatch (Pm, Qm):
12          lam_target <- lam_old,m + rho * r(detach(x))
13          lam_phi    <- DualGAT_phi(Pm, Qm)
14          update phi by minimizing 0.5 * ||lam_phi - lam_target||^2

15  V_max <- max( ||r_P||_inf , ||r_Q||_inf )      # worst violation
16  if V_max > tau * V_max(previous check):        # residual has stalled
17      rho <- min( alpha * rho , rho_max )        # tighten the penalty

18  return L_pri, V_max
```

Lines 3 to 7 are where the label-free part lives: the state comes out of the network, the
residual comes out of the physics, and the loss is assembled from the two with no reference
solution involved anywhere. Line 4 evaluates the multipliers without gradients, so the dual
network acts as a fixed weighting during the primal phase. Line 8 is the frozen checkpoint
that keeps the dual regression from drifting. Lines 16 and 17 are the adaptive penalty rule,
which gradually shifts the balance from the multiplier term towards the quadratic one
whenever progress stalls.

## How we tested it

The evaluation runs on PGLIB-OPF cases at the API tier. That tier deliberately inflates
active demand, so the base operating points already sit near the loadability limit and
conventional solvers diverge on them routinely, which is exactly the regime we want to probe.
Four systems of increasing size were used: EPRI 39-bus, IEEE 118-bus, IEEE 300-bus and
PEGASE 1354-bus, trained on 10,000, 7,000, 4,000 and 3,500 generated load profiles and
evaluated on separate stressed test sets of 2,000, 1,600, 800 and 450 profiles.
Newton-Raphson was run to the solver's default mismatch tolerance of 1e-8 MVA within a budget
of 30 iterations, and network inference ran on an NVIDIA RTX 6000.

Three initializers were compared against ours. The flat start is the standard heuristic. The
DC power flow warm start comes from the linearized DC model. The supervised neural warm start
is a GAT of comparable size trained by mean squared error against precomputed states, which
is the circular approach our method is meant to avoid.

Two metrics are reported and they are not the same thing. The convergence rate is the
fraction of all stressed test points on which the solver converges within budget. The rescue
rate looks only at the points where the flat start fails, and asks what fraction of those the
warm start turns into a converged solve. Different numerators, different denominators.

## Results

![Stacked bar chart of the 39-bus system: NR flat converges on 732 of 2000 test points, PDL-Warm on 1715, rescuing 983 cases.](../../images/pdl-warm-start-power-flow/chart_rescue_bar_39.png)
The 39-bus result counted case by case. Out of 2,000 stressed test points the flat start
solves 732 and diverges on 1,268, a convergence rate of 36.6%. Worth noting is that the DC
warm start and the supervised warm start converge on the very same 732 points, which suggests
the outcome on this system is decided by the operating point itself rather than by the choice
among those three starts. The primal-dual warm start converges on 1,715 points, a rate of
85.8%, and of the 1,268 points the flat start could not solve it recovers 983. That is a
rescue rate of 77.5%.

![Convergence rate on four benchmark grids, comparing NR flat start, DCPF warm start, NN warm start and PDL warm start. PDL reaches 86, 100, 77 and 94 percent respectively.](../../images/pdl-warm-start-power-flow/chart_cross_case_convergence_pct_all.png)
The same comparison across all four systems. The pattern from the 39-bus case repeats. The
flat start and the DC warm start land on essentially the same number everywhere, and the
supervised warm start does not reliably improve on either. It is actually worse on IEEE 300,
converging on 5% of points where the flat start manages 9%, and on PEGASE 1354 it fails on
every point we tested, because its predicted angles land outside the basin from which
Newton-Raphson can recover. We report that as a limitation of this particular supervised
baseline rather than a verdict on supervised warm starting as an idea. The primal-dual start
is the only one that moves the numbers: 37% to 86% on EPRI 39, 84% to 100% on IEEE 118, 9% to
77% on IEEE 300, and 74% to 94% on PEGASE 1354.

![Average NR iteration counts per benchmark: flat start 5.28, 4.98, 5.29, 5.95 versus PDL warm start 3.99, 4.78, 4.58, 4.56.](../../images/pdl-warm-start-power-flow/chart_cross_case_avg_iterations_all.png)
Rescuing divergent cases is one benefit, but the warm start also speeds up the cases the flat
start already handles. To keep the comparison honest, the averages here are taken only over
the test points where both methods converge, so both are measured on identical instances. The
learned start needs fewer iterations on all four systems: 3.99 against 5.28 on EPRI 39, a
24.4% reduction; 4.78 against 4.98 on IEEE 118, a 4.0% reduction; 4.58 against 5.29 on IEEE
300, which is 13.4%; and 4.56 against 5.95 on PEGASE 1354, which is 23.4%. The margin narrows
on the shared subsets of the larger systems for an understandable reason, namely that a shared
subset consists of the easy operating points, where there was less to gain in the first place.
For reference the supervised start needs 4.38 iterations on the 39-bus shared subset, so it
does help there, just by less.

![Total execution time on the 1354-bus system: NR flat 57.3 s, DCPF-Warm 76.8 s, NN-Warm 96.0 s, PDL-Warm 45.8 s.](../../images/pdl-warm-start-power-flow/chart_method_times_1354.png)
Any learned initializer adds a forward pass, so the fair accounting is inference latency plus
solver time over the whole test set. On PEGASE 1354 the primal-dual start finishes in 45.8 s
against 57.3 s for the flat start, a saving of 20.1%, and it is the fastest of the four
methods end to end. The overhead itself is negligible, roughly 0.03 s on the 39-bus test set
and 0.12 s on the 118-bus set. Two effects add up in its favour: fewer iterations on the
points that converge, and divergent runs converted into converged ones instead of grinding
through the full 30-iteration budget. That second effect is what explains the 96.0 s figure
for the supervised start, which converges on nothing here and therefore exhausts the budget on
every single run.

![Convergence rate on the 1354-bus system under four stress regimes: light, nominal, heavy loading, and reactive overload.](../../images/pdl-warm-start-power-flow/chart_strategy_1354.png)
Breaking PEGASE 1354 down by the kind of stress applied, across four regimes: light loading
scaling demand to 0.75 to 1.0 times nominal, nominal loading with random perturbations in
0.75 to 1.15, heavy loading at 1.0 to 1.3, and a reactive overload inflating load reactive
power to 1.2 to 2.0 times. Three of the four regimes are a tie, at 100% against 100%, 94%
against 94%, and 95% against 96%. The gap appears under heavy loading, where the flat start
collapses to 17% while the learned start holds 88%. That is the behaviour we wanted. The warm
start intervenes where the flat start is failing and costs nothing where it already works.

![Convergence rate versus load stress multiplier from 0.6 to 1.2 on the 300-bus system.](../../images/pdl-warm-start-power-flow/chart_stress_sweep_300.png)
Finally, a uniform load multiplier swept from 0.6 to 1.2 on IEEE 300, scaling the same
near-collapse API operating point with small per-bus noise at each level. This isolates a
single load level, unlike the mixed API test set used earlier which also contains lighter
down-scaled profiles, and that difference is why the flat-start rate here at a multiplier of
1.0 sits below its rate on the mixed set. The sweep shows how narrow the flat start's working
range is, essentially a band around 0.9. The learned start stays above 90% all the way from
0.6 through 1.0. Past 1.0 both fail, and that ceiling is worth stating plainly: the warm start
widens the range of load levels Newton-Raphson can cope with, but it cannot push the solver
beyond the region where a solution is still reachable.

## What is left open

Two limitations remain. The model is trained per system, and we have not studied whether it
transfers to a different topology, which is the obvious next question for anything meant to
run in an operational setting. And as the sweep shows, the warm start stops helping once the
loading passes the range we studied, since past that point Newton-Raphson fails from every
start we tried. Both are natural directions to continue in.

## Team

This was joint work with my teammate Swastic Keshari, under the mentorship of
Prof. Parikshit Pareek in the Department of Electrical Engineering, IIT Roorkee. It began as
a term paper for the Talent Enhancement Course (EET109) and grew from there. The work is
supported by the ANRF PM Early Career Research Grant and an IIT Roorkee Faculty Initiation
Grant.

## Paper and code

Accepted at the National Power Systems Conference (NPSC 2026), as *Label-Free Warm-Start
Learning for Newton-Raphson Power Flow*, by Swastic Keshari, Naman Meena and
Parikshit Pareek.

*(paper PDF link to be added)*

Code and data: [github.com/naman-meena/PDL](https://github.com/naman-meena/PDL)
