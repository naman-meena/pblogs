---
title: Label-Free Warm-Start Learning for Newton-Raphson Power Flow
summary: A self supervised graph attention model that gives Newton-Raphson power flow a better starting point, with no converged solutions needed for training.
date: 2026-08-09
status: completed
tags: power-systems, graph-attention-networks, self-supervised-learning, primal-dual, research
link: https://github.com/naman-meena/PDL
---

## What this project is

Power grids are solved with the Newton-Raphson (NR) method, and NR only works well if you
start it close to the answer. The usual starting guess — flat voltages, zero angles — is fine
for a grid running normally, but it falls apart under heavy loading, which is exactly when
grid operators most need the solver to work.

The obvious fix is to train a neural network to predict a better starting point. The problem
is that training such a network normally needs a dataset of already-solved cases — but the
hardest cases, the stressed ones we actually care about, are the ones NR struggles to solve
in the first place. You end up needing the answer to train something that finds the answer.

We built a way around that. Instead of learning from solved examples, our model learns
directly from the power-balance equations themselves. A graph attention network predicts
the bus voltages and generator outputs, and we score how good that guess is by plugging it
back into the physics and measuring the mismatch — no labels required. A second network
learns the Lagrange multipliers alongside it, and the two are trained together in a
primal-dual loop until the mismatch shrinks. NR is still what finally solves the system; our
network only gives it a much better place to start from.

One detail we cared about: the attention layer isn't allowed to look at the whole grid
freely. We restrict it to follow the actual wiring of the network (the admittance matrix),
and we weight attention higher along strongly coupled lines. So the model's guesses are
shaped by the electrical structure of the grid, not just pattern-matching.

## The architecture

![Primal-dual learning pipeline: a GAT encoder feeds task-specific heads that predict generator power and bus voltages, a second GAT encoder predicts the Lagrange multipliers, and the two are trained in an alternating primal-dual loop driven by power-balance residuals.](../../images/pdl-warm-start-power-flow/archi_tikz.png){wide}
The full pipeline. The primal network (blue) takes the load at every bus plus the grid
topology and predicts *Pg*, *Qg*, *|V|* and *θ*. Those predictions go straight into the
power-balance equations, and the residuals *r* — not any ground-truth label — are what the
loss is built from. The dual network (green) predicts the Lagrange multipliers *λ*, trained
against dual-ascent targets *λ + ρr*. The two alternate, with the penalty weight *ρ* rising
each outer iteration. At inference only the primal network runs.

## Does it actually help?

We tested this on four standard benchmark grids — 39, 118, 300, and 1354 buses — under
stressed loading conditions where the flat start regularly fails.

![Convergence rate on four benchmark grids, comparing NR flat start, DCPF warm start, NN warm start and PDL warm start. PDL reaches 86, 100, 77 and 94 percent respectively.](../../images/pdl-warm-start-power-flow/chart_cross_case_convergence_pct_all.png)
Convergence rate across the four benchmarks. The flat start, a DC power flow warm start and
a supervised neural warm start all land in roughly the same place — the DC and NN starts
barely move the needle, and on the 300-bus case the supervised network is actually worse
than doing nothing. The primal-dual warm start is the only one that changes the picture:
37% → 86%, 84% → 100%, 9% → 77% and 74% → 94%.

![Stacked bar chart of the 39-bus system: NR flat converges on 732 of 2000 test points, PDL-Warm on 1715, rescuing 983 cases.](../../images/pdl-warm-start-power-flow/chart_rescue_bar_39.png)
The same result on the 39-bus system counted case by case. Of the 1268 test points the flat
start could not solve, the warm start rescues 983 of them — 77.5%.

![Average NR iteration counts per benchmark: flat start 5.28, 4.98, 5.29, 5.95 versus PDL warm start 3.99, 4.78, 4.58, 4.56.](../../images/pdl-warm-start-power-flow/chart_cross_case_avg_iterations_all.png)
It also helps on the cases the flat start already handles. Averaged over the converged runs,
NR needs fewer iterations from the learned start on every benchmark — the gap is widest on
the largest grid, 5.95 down to 4.56 on PEGASE 1354.

![Total execution time on the 1354-bus system: NR flat 57.3 s, DCPF-Warm 76.8 s, NN-Warm 96.0 s, PDL-Warm 45.8 s.](../../images/pdl-warm-start-power-flow/chart_method_times_1354.png)
Those saved iterations more than pay for the forward pass. On PEGASE 1354 the warm start is
the fastest method end to end, including the cost of running the network — while the DC and
supervised warm starts both cost *more* wall-clock time than just starting flat.

![Convergence rate on the 1354-bus system under four stress regimes: light, nominal, heavy loading, and reactive overload.](../../images/pdl-warm-start-power-flow/chart_strategy_1354.png)
Broken down by the kind of stress, on PEGASE 1354. Under light and nominal loading there is
nothing to fix and the two methods tie. The gap opens exactly where it should: under heavy
loading (1.0–1.3×) the flat start collapses to 17% while the warm start holds 88%.

![Convergence rate versus load stress multiplier from 0.6 to 1.2 on the 300-bus system.](../../images/pdl-warm-start-power-flow/chart_stress_sweep_300.png)
Sweeping the load multiplier on IEEE 300 shows how narrow the flat start's usable band is —
it only works near 0.9× and fails everywhere else. The warm start stays at or near 100% from
0.6× through 1.0×. Past 1.1× both fail; that is the point where the operating point itself
stops existing, and no starting guess can help.

## Team

This was a joint project with my teammate Swastic Keshari, done under the mentorship of
Prof. Parikshit Pareek in the Department of Electrical Engineering, IIT Roorkee.

## Paper and code

*(paper PDF — to be added)*

Code and data: [github.com/naman-meena/PDL](https://github.com/naman-meena/PDL)
