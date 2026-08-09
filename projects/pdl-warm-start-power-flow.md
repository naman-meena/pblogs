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

## Does it actually help?

We tested this on four standard benchmark grids — 39, 118, 300, and 1354 buses — under
stressed loading conditions where the flat start regularly fails. Convergence rate went from
37% to 86% on the 39-bus system, 84% to 100% on the 118-bus system, 9% to 77% on the
300-bus system, and 74% to 94% on the 1354-bus system. It also converges in fewer
iterations on the cases the flat start already handles, and it holds up across different
kinds of stress — heavy loading, reactive power overloads, and a sweep across load levels.

## Team

This was a joint project with my teammate Swastic Keshari, done under the mentorship of
Prof. Parikshit Pareek in the Department of Electrical Engineering, IIT Roorkee.

## Paper and code

*(paper PDF and diagrams — to be added)*

Code and data: [github.com/naman-meena/PDL](https://github.com/naman-meena/PDL)
