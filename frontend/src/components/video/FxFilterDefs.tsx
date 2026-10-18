import React from 'react';

/**
 * Static SVG filter definitions for the 2026 FX pack.
 *
 * Rendered ONCE per composition (see ASTRenderer). Layer `filters` arrays can
 * reference these by id — e.g. `"filters": ["url(#fx-thermal)"]` — exactly
 * like a CSS filter function. SVG filters are export-safe: headless Chromium
 * rasterizes them identically in preview and `remotion render`.
 *
 * IDs are fixed on purpose (defs are static presets, never per-instance).
 */
export const FxFilterDefs: React.FC = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
    <defs>
      {/* Embossed relief — feConvolveMatrix edge kernel, alpha preserved */}
      <filter id="fx-emboss" x="-20%" y="-20%" width="140%" height="140%">
        <feConvolveMatrix
          order="3"
          kernelMatrix="-2 -1 0 -1 1 1 0 1 2"
          preserveAlpha="true"
        />
      </filter>

      {/* Sharpen — restores bite on soft stock footage */}
      <filter id="fx-sharpen" x="-20%" y="-20%" width="140%" height="140%">
        <feConvolveMatrix
          order="3"
          kernelMatrix="0 -1 0 -1 5 -1 0 -1 0"
          preserveAlpha="true"
        />
      </filter>

      {/* Posterize — 4-level comic/print quantization per channel */}
      <filter id="fx-posterize" x="-20%" y="-20%" width="140%" height="140%">
        <feComponentTransfer>
          <feFuncR type="discrete" tableValues="0 0.33 0.66 1" />
          <feFuncG type="discrete" tableValues="0 0.33 0.66 1" />
          <feFuncB type="discrete" tableValues="0 0.33 0.66 1" />
        </feComponentTransfer>
      </filter>

      {/* Midnight duotone — desaturate then map luma navy → cyan */}
      <filter id="fx-duotone-midnight" x="-20%" y="-20%" width="140%" height="140%">
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncR type="table" tableValues="0.03 0.40" />
          <feFuncG type="table" tableValues="0.06 0.85" />
          <feFuncB type="table" tableValues="0.16 1.0" />
        </feComponentTransfer>
      </filter>

      {/* Inferno duotone — desaturate then map luma black → hot orange */}
      <filter id="fx-duotone-inferno" x="-20%" y="-20%" width="140%" height="140%">
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncR type="table" tableValues="0.0 1.0" />
          <feFuncG type="table" tableValues="0.0 0.55" />
          <feFuncB type="table" tableValues="0.0 0.08" />
        </feComponentTransfer>
      </filter>

      {/* Thermal vision — desaturate then quantize luma into
          black → red → yellow → white heat bands */}
      <filter id="fx-thermal" x="-20%" y="-20%" width="140%" height="140%">
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncR type="discrete" tableValues="0 1 1 1" />
          <feFuncG type="discrete" tableValues="0 0 1 1" />
          <feFuncB type="discrete" tableValues="0 0 0 1" />
        </feComponentTransfer>
      </filter>

      {/* ── Phase 3: Broadcast LUT Color Grading Shaders ────────────────── */}

      {/* LUT: Cyberpunk — crushed blacks, cyan shadow tint, magenta highlights */}
      <filter id="fx-lut-cyberpunk" x="-20%" y="-20%" width="140%" height="140%">
        <feColorMatrix
          type="matrix"
          values="
            1.20 -0.05 -0.05 0 -0.08
           -0.10  1.15  0.10 0 -0.05
            0.15  0.10  1.30 0  0.02
            0     0     0    1  0"
        />
        <feComponentTransfer>
          <feFuncR type="table" tableValues="0.0 0.05 0.35 0.75 1.05" />
          <feFuncG type="table" tableValues="0.0 0.15 0.45 0.75 0.92" />
          <feFuncB type="table" tableValues="0.04 0.25 0.60 0.88 1.0" />
        </feComponentTransfer>
      </filter>
      <filter id="lut-cyberpunk" x="-20%" y="-20%" width="140%" height="140%">
        <feColorMatrix
          type="matrix"
          values="
            1.20 -0.05 -0.05 0 -0.08
           -0.10  1.15  0.10 0 -0.05
            0.15  0.10  1.30 0  0.02
            0     0     0    1  0"
        />
        <feComponentTransfer>
          <feFuncR type="table" tableValues="0.0 0.05 0.35 0.75 1.05" />
          <feFuncG type="table" tableValues="0.0 0.15 0.45 0.75 0.92" />
          <feFuncB type="table" tableValues="0.04 0.25 0.60 0.88 1.0" />
        </feComponentTransfer>
      </filter>

      {/* LUT: Vox Editorial — desaturated warm sepia tone with heavy grain */}
      <filter id="fx-lut-vox-editorial" x="-20%" y="-20%" width="140%" height="140%">
        <feColorMatrix
          type="matrix"
          values="
            0.45 0.40 0.15 0 0.04
            0.35 0.45 0.12 0 0.02
            0.25 0.30 0.25 0 -0.02
            0    0    0    1 0"
          result="colorGrade"
        />
        <feComponentTransfer in="colorGrade" result="contrastWarm">
          <feFuncR type="table" tableValues="0.05 0.25 0.60 0.95" />
          <feFuncG type="table" tableValues="0.04 0.20 0.52 0.86" />
          <feFuncB type="table" tableValues="0.02 0.14 0.40 0.72" />
        </feComponentTransfer>
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" result="rawNoise" />
        <feColorMatrix
          in="rawNoise"
          type="matrix"
          values="
            0.33 0.33 0.33 0 0.35
            0.33 0.33 0.33 0 0.35
            0.33 0.33 0.33 0 0.35
            0    0    0    0 1"
          result="neutralGrain"
        />
        <feBlend mode="overlay" in="contrastWarm" in2="neutralGrain" />
      </filter>
      <filter id="lut-vox-editorial" x="-20%" y="-20%" width="140%" height="140%">
        <feColorMatrix
          type="matrix"
          values="
            0.45 0.40 0.15 0 0.04
            0.35 0.45 0.12 0 0.02
            0.25 0.30 0.25 0 -0.02
            0    0    0    1 0"
          result="colorGrade"
        />
        <feComponentTransfer in="colorGrade" result="contrastWarm">
          <feFuncR type="table" tableValues="0.05 0.25 0.60 0.95" />
          <feFuncG type="table" tableValues="0.04 0.20 0.52 0.86" />
          <feFuncB type="table" tableValues="0.02 0.14 0.40 0.72" />
        </feComponentTransfer>
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" result="rawNoise" />
        <feColorMatrix
          in="rawNoise"
          type="matrix"
          values="
            0.33 0.33 0.33 0 0.35
            0.33 0.33 0.33 0 0.35
            0.33 0.33 0.33 0 0.35
            0    0    0    0 1"
          result="neutralGrain"
        />
        <feBlend mode="overlay" in="contrastWarm" in2="neutralGrain" />
      </filter>

      {/* LUT: Dark Cinematic — 80% desaturation, high contrast, teal-orange split */}
      <filter id="fx-lut-dark-cinematic" x="-20%" y="-20%" width="140%" height="140%">
        <feColorMatrix type="saturate" values="0.25" result="desat" />
        <feColorMatrix
          in="desat"
          type="matrix"
          values="
            1.25 -0.05 -0.10 0 -0.05
           -0.05  1.05  0.05 0 -0.03
           -0.10  0.10  1.30 0  0.02
            0     0     0    1  0"
          result="split"
        />
        <feComponentTransfer in="split">
          <feFuncR type="table" tableValues="0.0 0.08 0.40 0.85 1.05" />
          <feFuncG type="table" tableValues="0.0 0.12 0.42 0.78 0.95" />
          <feFuncB type="table" tableValues="0.02 0.20 0.48 0.70 0.82" />
        </feComponentTransfer>
      </filter>
      <filter id="lut-dark-cinematic" x="-20%" y="-20%" width="140%" height="140%">
        <feColorMatrix type="saturate" values="0.25" result="desat" />
        <feColorMatrix
          in="desat"
          type="matrix"
          values="
            1.25 -0.05 -0.10 0 -0.05
           -0.05  1.05  0.05 0 -0.03
           -0.10  0.10  1.30 0  0.02
            0     0     0    1  0"
          result="split"
        />
        <feComponentTransfer in="split">
          <feFuncR type="table" tableValues="0.0 0.08 0.40 0.85 1.05" />
          <feFuncG type="table" tableValues="0.0 0.12 0.42 0.78 0.95" />
          <feFuncB type="table" tableValues="0.02 0.20 0.48 0.70 0.82" />
        </feComponentTransfer>
      </filter>
    </defs>
  </svg>
);
