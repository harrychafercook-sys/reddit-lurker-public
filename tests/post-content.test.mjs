import test from 'node:test';
import assert from 'node:assert/strict';
import { getPostContent } from '../post-content.js';

test('r/gifs posts use the animated original instead of the still preview', () => {
  const url = 'https://i.redd.it/xkaw779z24nh1.gif';
  const preview = { images: [{ source: { url: 'https://preview.redd.it/xkaw779z24nh1.gif?format=png8' } }] };
  assert.deepEqual(getPostContent({ url_overridden_by_dest: url, preview }), [{ type: 'image', url }]);
});

test('external soccer clips take precedence over still thumbnails', () => {
  const content = getPostContent({ url_overridden_by_dest: 'https://streamff.pro/v/0c9ead67', preview: { images: [{ source: { url: 'https://example.org/thumb.jpg' } }] } });
  assert.equal(content[0].type, 'video');
  assert.equal(content[0].provider, 'streamff');
});

test('native Reddit HLS retains its complete signed URL and secure media fallback', () => {
  const url = 'https://v.redd.it/abc/HLSPlaylist.m3u8?one=1&amp;two=2';
  for (const field of ['media', 'secure_media']) {
    assert.deepEqual(getPostContent({ is_video: true, [field]: { reddit_video: { hls_url: url } } }), [{ type: 'video', url: url.replace('&amp;', '&') }]);
  }
});

test('Redgifs posts play the linked video instead of the still Reddit preview', () => {
  const content = getPostContent({ url_overridden_by_dest: 'https://www.redgifs.com/watch/ExampleClip', post_hint: 'rich:video', preview: { images: [{ source: { url: 'https://example.org/still.jpg' } }] } });
  assert.equal(content[0].type, 'video');
  assert.equal(content[0].provider, 'redgifs');
  assert.equal(content[0].clipId, 'exampleclip');
});

test('ordinary images, empty posts and animated gallery entries still work', () => {
  assert.deepEqual(getPostContent({ url: 'https://example.org/image.png?size=2' }), [{ type: 'image', url: 'https://example.org/image.png?size=2' }]);
  assert.deepEqual(getPostContent({}), []);
  assert.deepEqual(getPostContent({ is_gallery: true, media_metadata: { a: { s: { gif: 'https://example.org/a.gif', u: 'https://example.org/a.jpg' } } } }), [{ type: 'image', url: 'https://example.org/a.gif' }]);
});
