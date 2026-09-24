// Safe markdown rendering for the reader.
// - Raw HTML is DISABLED (markdown-it html:false), so content cannot inject scripts.
// - Relative links stay inside the site (rewritten to #/<site>/<path>).
// - External links open with rel="noopener noreferrer".
// - Image syntax renders as a plain link for now (image handling is a later brief).
import MarkdownIt from 'markdown-it';
import { normalizePath } from '../../src/core/envelope.js';

function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#');
}

export function makeRenderer(siteAddress: string) {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

  const encodeInSite = (path: string) => {
    try { return `#/${encodeURIComponent(siteAddress)}${normalizePath(path)}`; }
    catch { return '#'; }
  };

  // Rewrite link targets.
  const defaultLinkOpen =
    md.renderer.rules.link_open ?? ((tokens, idx, opts, _e, self) => self.renderToken(tokens, idx, opts));
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const token = tokens[idx]!;
    const hrefIdx = token.attrIndex('href');
    if (hrefIdx >= 0) {
      const href = token.attrs![hrefIdx]![1];
      if (href.startsWith('#')) {
        // in-page anchor: leave as-is
      } else if (isExternal(href)) {
        token.attrSet('rel', 'noopener noreferrer');
        token.attrSet('target', '_blank');
      } else {
        token.attrs![hrefIdx]![1] = encodeInSite(href);
      }
    }
    return defaultLinkOpen(tokens, idx, opts, env, self);
  };

  // Images -> plain link (no <img>).
  md.renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx]!;
    const srcIdx = token.attrIndex('src');
    const src = srcIdx >= 0 ? token.attrs![srcIdx]![1] : '';
    const alt = token.content || src;
    const href = isExternal(src) ? src : encodeInSite(src);
    const rel = isExternal(src) ? ' rel="noopener noreferrer" target="_blank"' : '';
    return `<a href="${md.utils.escapeHtml(href)}"${rel} class="qd-image-link">🖼 ${md.utils.escapeHtml(alt)}</a>`;
  };

  return (markdown: string): string => md.render(markdown);
}
