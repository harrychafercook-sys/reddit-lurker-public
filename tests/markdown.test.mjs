import test from 'node:test';
import assert from 'node:assert/strict';
import { marked } from 'marked';
import { parseMarkdown } from '../markdown.js';

// Direct GIF shared in the comments of r/gifs/comments/1w5auco.
const redditGif = 'https://i.redd.it/xkaw779z24nh1.gif';
// This is also the form produced by the live/offline giphy|id conversion.
const giphyGif = 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif';

test('existing GIF image Markdown renders once without stray Markdown text', () => {
  for (const url of [redditGif, giphyGif]) {
    const html = parseMarkdown(`![gif](${url})`);
    assert.equal(html, `<p><img src="${url}" alt="gif"></p>\n`);
  }
});

test('bare image URLs still embed and leave surrounding punctuation outside the URL', () => {
  assert.equal(parseMarkdown(`Look (${redditGif}).`),
    `<p>Look (<img src="${redditGif}" alt="Embedded Image">).</p>\n`);
  assert.equal(parseMarkdown(`<${redditGif}>`),
    `<p><img src="${redditGif}" alt="Embedded Image"></p>\n`);
});

test('image query strings, titles, references, and linked images remain intact', () => {
  const url = 'https://preview.redd.it/example.gif?width=320&format=png8&s=abc';
  for (const source of [
    `![gif](${url} "Caption")`,
    `![gif][reaction]\n\n[reaction]: ${url}`,
    `[![gif](${redditGif})](https://example.org)`,
    `[View image](${redditGif})`,
  ]) {
    assert.equal(parseMarkdown(source), marked.parse(source));
  }
  assert.equal(parseMarkdown(url),
    '<p><img src="https://preview.redd.it/example.gif?width=320&amp;format=png8&amp;s=abc" alt="Embedded Image"></p>\n');
});

test('URLs inside code and raw HTML are not rewritten', () => {
  for (const source of [
    `\`${redditGif}\``,
    `\`\`\`\n![gif](${giphyGif})\n${redditGif}\n\`\`\``,
    `    ${redditGif}`,
    `<img src="${redditGif}" alt="original">`,
    `<a href="${redditGif}">View image</a>`,
  ]) {
    assert.equal(parseMarkdown(source), marked.parse(source));
  }
});

test('multiple GIFs mixed with text have no duplicate images or visible image syntax', () => {
  const html = parseMarkdown(`Before ![gif](${giphyGif}) after\n\n${redditGif}`);
  assert.equal(html,
    `<p>Before <img src="${giphyGif}" alt="gif"> after</p>\n` +
    `<p><img src="${redditGif}" alt="Embedded Image"></p>\n`);
});

test('all supported image extensions embed without matching non-image paths', () => {
  for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'GIF']) {
    assert.match(parseMarkdown(`https://example.org/photo.${extension}`), /<img /);
  }
  for (const url of [
    'https://example.org/video.gifv',
    'https://example.org/photo.gif/page',
    'https://example.org/?file=photo.gif',
    'https://example.org/page',
  ]) {
    assert.equal(parseMarkdown(url), marked.parse(url));
  }
});

test('inline rendering and disabled auto-embedding preserve their existing behavior', () => {
  assert.equal(parseMarkdown(`![gif](${redditGif})`, { inline: true }),
    `<img src="${redditGif}" alt="gif">`);
  assert.equal(parseMarkdown(redditGif, { inline: true }),
    `<img src="${redditGif}" alt="Embedded Image">`);
  assert.equal(parseMarkdown(redditGif, { embedImages: false }), marked.parse(redditGif));
  assert.equal(parseMarkdown(redditGif, { inline: true, embedImages: false }), marked.parseInline(redditGif));
  assert.equal(parseMarkdown(null), '');
});

test('Markdown tables render inline in their own accessible scroll region', () => {
  for (const source of [
    '| Club | Points |\n| :--- | ---: |\n| **Example FC** | 42 |',
    'Club | Points\n:--- | ---:\n**Example FC** | 42',
  ]) {
    for (const embedImages of [true, false]) {
      const html = parseMarkdown(`Before\n\n${source}\n\nAfter`, { embedImages });
      assert.match(html, /<p>Before<\/p>[\s\S]*<div class="markdown-table-scroll" role="region" aria-label="Scrollable table" tabindex="0"><table>/);
      assert.match(html, /<strong>Example FC<\/strong>/);
      assert.match(html, /<\/table>\s*<\/div>\s*<p>After<\/p>/);
      assert.equal((html.match(/markdown-table-scroll/g) || []).length, 1);
    }
  }
});

test('pipes in code are not tables and consecutive tables scroll independently', () => {
  const table = '| A | B |\n| --- | --- |\n| 1 | 2 |';
  const code = '```\n' + table + '\n```';
  assert.equal(parseMarkdown(code), marked.parse(code));
  assert.equal((parseMarkdown(`${table}\n\nBetween\n\n${table}`).match(/markdown-table-scroll/g) || []).length, 2);
});
