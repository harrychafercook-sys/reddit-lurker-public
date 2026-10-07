import { Marked, Renderer } from 'marked';

const tableRenderer = {
  table(token) {
    return `<div class="markdown-table-scroll" role="region" aria-label="Scrollable table" tabindex="0">${Renderer.prototype.table.call(this, token)}</div>\n`;
  },
};
const textMarkdown = new Marked({ renderer: tableRenderer });

const imageMarkdown = new Marked({
  renderer: {
    ...tableRenderer,
    link(token) {
      // Only auto-embed bare URLs. Rewriting the Markdown source also rewrites
      // URLs inside existing ![gif](...) images, links, and code blocks.
      if (!token.autolink || !/^https?:\/\//i.test(token.href)) return false;
      let url;
      try { url = new URL(token.href); } catch { return false; }
      if (!/\.(?:png|jpe?g|gif|webp)$/i.test(url.pathname)) return false;
      return this.image({
        ...token,
        type: 'image',
        text: 'Embedded Image',
        tokens: [{ type: 'text', raw: 'Embedded Image', text: 'Embedded Image' }],
      });
    },
  },
});

// The caller must sanitize the resulting HTML before inserting it into the DOM.
export function parseMarkdown(content, { inline = false, embedImages = true } = {}) {
  const parser = embedImages ? imageMarkdown : textMarkdown;
  return inline ? parser.parseInline(content || '') : parser.parse(content || '');
}
