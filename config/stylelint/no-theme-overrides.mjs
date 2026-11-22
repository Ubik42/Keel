import stylelint from 'stylelint';

/**
 * keel/no-theme-overrides: a rule that targets one theme ([data-theme="…"])
 * may only define custom properties (tokens). Plain properties on components
 * belong in the theme-neutral rule and read a token. Theme blocks on the root
 * element itself (color-scheme, page color) are allowed.
 */
const ruleName = 'keel/no-theme-overrides';
const messages = stylelint.utils.ruleMessages(ruleName, {
  rejected: (selector, prop) => `"${prop}" in "${selector}" sets a theme-specific value on a component; define a token per theme instead`,
});
const ROOT_THEME = /^\s*(?::root|html)?(?:\[data-theme="[^"]+"\])?(?::not\([^)]*\))?\s*$/u;

const rule = (enabled) => (root, result) => {
  if (!enabled) return;
  root.walkRules((node) => {
    if (!node.selector.includes('[data-theme')) return;
    if (node.selectors.every((selector) => ROOT_THEME.test(selector))) return;
    node.each((child) => {
      if (child.type !== 'decl' || child.prop.startsWith('--')) return;
      stylelint.utils.report({ ruleName, result, node: child, message: messages.rejected(node.selector.replace(/\s+/gu, ' '), child.prop) });
    });
  });
};
rule.ruleName = ruleName;
rule.messages = messages;

export default stylelint.createPlugin(ruleName, rule);
