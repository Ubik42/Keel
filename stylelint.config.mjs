/**
 * Style rules for the renderer (docs/进度.md PT). Font sizes, corner radii and
 * colors in component rules refer to tokens from workbench/ui/tokens.css, so
 * the font-size and radius settings and the themes reach every surface.
 * Token definitions (custom properties) may hold literal values.
 */
const tokenOrKeyword = (keywords) => [/^var\(/u, /^(calc|max|min|clamp)\(.*var\(/u, ...keywords];
const LITERAL_COLOR = [/#[0-9a-fA-F]{3,8}\b/u, /\brgba?\(\s*[0-9]/u, /\bhsla?\(\s*[0-9]/u];

export default {
  plugins: ['./config/stylelint/no-theme-overrides.mjs'],
  rules: {
    'declaration-property-value-allowed-list': {
      'font-size': tokenOrKeyword(['inherit', /^calc\(clamp\(/u]),
      '/^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/': tokenOrKeyword([
        '0',
        'inherit',
        /^[0-9.]+%$/u,
        /^(var\([^)]*\)|0)( (var\([^)]*\)|0)){1,3}$/u,
      ]),
    },
    'declaration-property-value-disallowed-list': {
      // Use the step token (--ui-font-size-11, --ui-radius-8) instead of scaling a pixel value in place.
      'font-size': [/calc\([0-9.]+px \* var\(--ui-font-scale/u],
      '/^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/': [/calc\([0-9.]+px \* var\(--ui-radius-scale/u],
      '/^(color|background|background-color|border|border-(top|right|bottom|left)|border-color|outline|outline-color|box-shadow|text-shadow|fill|stroke|scrollbar-color|caret-color|filter|text-decoration-color|accent-color)$/': LITERAL_COLOR,
    },
    'declaration-no-important': true,
    // Theme differences live in tokens; a component rule never targets one theme.
    'keel/no-theme-overrides': true,
  },
};
