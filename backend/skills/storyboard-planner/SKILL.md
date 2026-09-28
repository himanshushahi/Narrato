---
name: storyboard-planner
description: "Storyboard planning: break narration into timed visual beats with explicit layouts. No prescribed looks; plan freely."
version: "3.0"
when_to_use: "Used during Stage 1 visual planning to plan timed beats before generating AST code."
---

# Storyboard Planner (planning, not direction)

> **Role**: Planning engineer.
> **Mission**: Break narration into timed beats with explicit spatial layouts. Every creative decision is yours — this file defines the plan structure and the functional constraints. Layer capabilities: `declarative-ast`.

---

## 1. Plan Structure

For each scene, output a storyboard plan describing:
1. **Beat Count & Exact Durations**: sub-visual durations summing exactly to the total scene duration (2 decimals).
2. **Spatial Layout per beat**: explicit composition intent per beat (types + geometry + motion), e.g. *Beat 1: bar chart left, fiber inset right, headline lower-third; Beat 2: memo card center, typewriter quote; Beat 3: rolling metric fullscreen*.
3. **Motion per beat**: entrances, drift, text treatment — any the animator supports (Part 2 of `declarative-ast`).

Primitive vocabulary (enums, not mandates): `Chart Shape Text Image Video Map HTML Lottie Particles Counter Background`; `animation_mode: words_stagger|marker_highlight|typewriter|static`; `camera_shake: handheld|shockwave|glitch`; `motion_blur`; `emphasis`.

## 2. Functional Constraints (rendering truth)

- Beat durations sum exactly to the scene total.
- No static chapter title cards inside cuts (root overlays render chapters continuously).
- Keep primary content above subtitle safe areas (18% landscape / 28% portrait).
- One structural workflow: plan beats before authoring (one line per beat — intent + transition + media query). Unplanned sections repeat by accident.

## 3. Pre-Flight Checklist (render-breakers only)

- [ ] Durations sum exactly to total scene duration
- [ ] No chapter title cards embedded in cuts
- [ ] Layouts are explicit per beat (types + boxes + motion stated)
- [ ] Media beats name their `query` + `source`
