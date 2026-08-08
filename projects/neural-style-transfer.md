---
title: Neural Style Transfer from Scratch
summary: Implemented the original Gatys et al. style transfer algorithm in PyTorch, without any pretrained pipeline libraries.
date: 2026-06-12
status: completed
tags: pytorch, computer-vision, deep-learning
link: https://github.com/naman-meena/neural-style-transfer
---

## What it does

Takes a content image and a style image, then optimizes a third image so its deep-feature
statistics match the style image while keeping the content image's structure.

## Approach

- Used a pretrained VGG-19 as a fixed feature extractor (no fine-tuning).
- Content loss from a mid-level conv layer, style loss from Gram matrices across five layers.
- Optimized the *pixels* directly with L-BFGS rather than training a network — closer to the
  original paper than the fast feed-forward variants.

```python
loss = content_weight * content_loss + style_weight * style_loss
optimizer.step(closure)
```

## Results

Converges in ~300 steps on a single GPU. The biggest quality lever turned out to be the
content/style weight ratio, not the layer choice.

## What I'd do differently

Add a Laplacian pyramid to stabilize high-frequency artifacts at large output resolutions.
