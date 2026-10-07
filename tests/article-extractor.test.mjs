import test from 'node:test';
import assert from 'node:assert/strict';
import { extractArticle } from '../article-extractor.js';

test('Txtify uses the current Article Extractor endpoint and preserves the source URL', async () => {
  const source = 'https://example.org/article?one=1&two=2';
  const article = { title: 'Example', content: '<p>Extracted content</p>' };
  const result = await extractArticle(source, ' test-key ', async (url, options) => {
    const endpoint = new URL(url);
    assert.equal(endpoint.origin, 'https://article-extractor2.p.rapidapi.com');
    assert.equal(endpoint.pathname, '/article/parse');
    assert.equal(endpoint.searchParams.get('url'), source);
    assert.equal(options.headers['x-rapidapi-key'], 'test-key');
    assert.equal(endpoint.searchParams.has('key'), false);
    return Response.json({ error: 0, data: article });
  });
  assert.deepEqual(result, article);
});
test('Txtify distinguishes access, quota and extraction errors', async () => {
  for (const [status, message] of [[403, /subscription/], [429, /request limit/], [502, /HTTP 502/]]) {
    await assert.rejects(extractArticle('https://example.org', 'key', async () => Response.json({}, { status })), message);
  }
  await assert.rejects(extractArticle('https://example.org', 'key', async () => Response.json({ error: 1, message: 'Page unavailable' })), /Page unavailable/);
  await assert.rejects(extractArticle('https://example.org', 'key', async () => Response.json({ error: 0, data: {} })), /No readable article/);
});
