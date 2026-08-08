---
title: Real-time Log Anomaly Detector
summary: A streaming pipeline that flags unusual log patterns using an online isolation forest, with a lightweight dashboard.
date: 2026-07-30
status: ongoing
tags: ml, streaming, python, systems
link: https://github.com/naman-meena/log-anomaly
---

## Motivation

Most anomaly detectors on logs are batch jobs that run hourly. I wanted something that flags
an incident within seconds of it starting to appear in the stream.

## Current architecture

1. Logs are tailed and tokenized into structured events.
2. Events are embedded with a small hashing vectorizer (no GPU needed).
3. An online isolation forest scores each event against a rolling window.
4. Scores above a dynamic threshold are pushed to a small web dashboard over a websocket.

## Status

- [x] Ingestion + tokenization pipeline
- [x] Online isolation forest scoring
- [ ] Alerting integration (Slack webhook)
- [ ] Persisted baseline across restarts

## Notes

The dynamic threshold (rolling median + k * MAD) has worked better so far than a fixed
z-score cutoff, especially across log sources with very different noise floors.
