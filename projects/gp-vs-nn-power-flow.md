---
title: Gaussian Processes vs Neural Networks for Power Flow Prediction
summary: Comparing Gaussian Process regression and neural networks for predicting bus voltages on the IEEE 33-bus system, and finding that a simple polynomial-kernel GP beats every neural net tried.
date: 2025-06-21
status: completed
tags: power-systems, machine-learning, gaussian-processes, neural-networks, ieee-33-bus
link: https://github.com/naman-meena/Comparative-Analysis-of-Gaussian_Process-and-Neural_Network-Models-for-Power-Flow
---

## What this project is

Power flow analysis is the calculation every grid operator relies on to know the voltage at
every bus in a network, given how much power is being drawn where. The standard way to solve
it is an iterative method like Newton-Raphson, which is accurate but has to be re-run from
scratch every time load conditions change. That gets expensive when you want fast, repeated,
or real-time estimates — for example when you're screening thousands of possible load
scenarios for a renewables-heavy grid.

This project asks a simpler question: instead of re-solving the power flow equations every
time, can we just learn a closed-form mapping from "power injected at each bus" to "voltage
at each bus" directly from data? And if so, which kind of model learns that mapping better —
a Gaussian Process or a neural network?

## Setup

I used the IEEE 33-bus distribution test system and generated 1000 load scenarios by randomly
varying active and reactive power at each bus by up to ±20%, solving each one with
`pandapower` to get the ground-truth voltages. That gave a dataset of input-output pairs
(power injections → bus voltages), split 80/20 into train and test sets.

On the Gaussian Process side, I tried three kernels — RBF, polynomial (degree 2 to 4), and
linear — and tuned each one with Optuna (learning rate, number of training iterations,
kernel-specific parameters). On the neural network side, I tried four small feed-forward
architectures: 2-layer and 3-layer versions, each with either ReLU or sigmoid activations,
all trained with Adam, dropout, and a fixed 500 epochs.

*(architecture diagram — to be added)*

## Results

Across all 32 load buses, the polynomial-kernel GP came out on top by a clear margin — its
worst-case RMSE across any bus was about 0.00101 p.u., noticeably tighter than the RBF and
linear kernels, and about 30% lower than the best neural network's worst-case error. It also
got there with far less training effort: instead of a fixed 500 epochs, the GP models
converged with Optuna searching over just 300–800 iterations.

Among the neural networks, the simplest one won: a 2-layer ReLU network beat the deeper
3-layer version and both sigmoid variants. More layers and a different activation function
didn't help — if anything they made things slightly worse.

*(RMSE-across-buses plots — to be added)*

*(GP kernel comparison chart — to be added)*

The pattern that stood out most: bigger and more complex wasn't better, for either model
family. A well-tuned polynomial kernel outperformed every neural net tried, and among the
neural nets, the plainest architecture won. For a moderately sized system like this, a
carefully tuned Gaussian Process turned out to be both more accurate and cheaper to train
than a neural network.

## Limitations

This was tested only on the IEEE 33-bus system with simulated data, so the same conclusion
might not carry over directly to larger networks or real field data — GPs in particular tend
to get expensive in memory and compute as the dataset grows, which is a known weak point of
the approach. Extending this to bigger networks, real measurements, and combined/adaptive
kernels would be the natural next step.

## Code and writeup

Full code, the report, and the generated dataset are on GitHub:
[github.com/naman-meena/Comparative-Analysis-of-Gaussian_Process-and-Neural_Network-Models-for-Power-Flow](https://github.com/naman-meena/Comparative-Analysis-of-Gaussian_Process-and-Neural_Network-Models-for-Power-Flow)

I also wrote up a short summary of this on
[LinkedIn](https://www.linkedin.com/posts/namanmeena_im-happy-to-share-this-comparative-analysis-ugcPost-7362473405201223682-ewZt/).
