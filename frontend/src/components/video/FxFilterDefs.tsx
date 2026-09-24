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
    </defs>
  </svg>
);
