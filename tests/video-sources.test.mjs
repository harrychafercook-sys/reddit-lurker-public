import test from 'node:test';
import assert from 'node:assert/strict';
import { getVideoLink, getThreadContent, resolveVideo } from '../video-sources.js';

test('recognizes current r/soccer hosts and their canonical URLs', () => {
  for (const [url, provider, clipId] of [
    ['https://streamff.pro/v/0c9ead67', 'streamff', '0c9ead67'],
    ['https://www.streamff.com/v/0c9ead67/', 'streamff', '0c9ead67'],
    ['https://streamin.link/v/d5e74811', 'streamin', 'd5e74811'],
    ['https://streamin.me/v/d5e74811', 'streamin', 'd5e74811'],
    ['https://streama.in/DuovQjIdZgY7cmN/watch', 'streamain', 'DuovQjIdZgY7cmN'],
    ['https://streamain.com/en/DuovQjIdZgY7cmN/watch', 'streamain', 'DuovQjIdZgY7cmN'],
    ['https://streamain.com/embed/DuovQjIdZgY7cmN', 'streamain', 'DuovQjIdZgY7cmN'],
  ]) {
    assert.deepEqual(getVideoLink(url), { type: 'video', url, sourceUrl: url, provider, clipId });
  }
});

test('direct MP4/WebM/HLS links preserve signatures and bypass resolution', async () => {
  for (const [extension, format] of [['mp4', 'mp4'], ['webm', 'webm'], ['m3u8', 'hls']]) {
    const url = `https://example.org/clip.${extension}?signature=a%2Bb&expires=123`;
    assert.deepEqual(await resolveVideo(url, { fetcher: () => assert.fail('No request needed') }), { type: 'video', url, format });
  }
});

test('Redgifs watch and embed links resolve as videos, including cached thumbnails', async () => {
  for (const url of ['https://www.redgifs.com/watch/ExampleClip?utm_source=reddit', 'https://redgifs.com/ifr/ExampleClip/']) {
    const video = getVideoLink(url);
    assert.equal(video.provider, 'redgifs');
    assert.equal(video.clipId, 'exampleclip');
    assert.equal(getThreadContent({ url, content: [{ type: 'image', url: 'https://example.org/still.jpg' }] })[0].type, 'video');
    const result = await resolveVideo(url, { fetcher: async request => {
      assert.equal(request, './api/resolve-video.php?provider=redgifs&id=exampleclip');
      return Response.json({ url: 'https://media.redgifs.com/ExampleClip.mp4' });
    } });
    assert.equal(result.format, 'mp4');
    assert.equal(result.sourceUrl, url);
  }
  for (const url of ['https://redgifs.com/users/example', 'https://redgifs.com/watch/', 'https://redgifs.com.evil.test/watch/example', 'https://redgifs.com/watch/example/extra']) {
    assert.equal(getVideoLink(url), null);
  }
});

test('unrelated pages, spoofed hosts and non-web URLs remain ordinary links', () => {
  for (const url of [null, '', 'javascript:alert(1)', 'file:///movie.mp4', 'https://streamff.pro.evil.test/v/abc', 'https://streamff.pro/account', 'https://user@streamff.pro/v/abc', 'https://streamff.pro:9000/v/abc', 'https://example.org/?movie=clip.mp4']) {
    assert.equal(getVideoLink(url), null);
  }
});

test('cached posts with an external clip open video instead of a thumbnail', () => {
  const thread = { url: 'https://streamin.link/v/d5e74811', content: [{ type: 'image', url: 'https://example.org/thumb.jpg' }] };
  assert.equal(getThreadContent(thread)[0].provider, 'streamin');
  assert.deepEqual(getThreadContent({ url: 'https://example.org/article', content: thread.content }), thread.content);
});

test('resolves metadata on the same host with cancellation and no credentials or persistent cache', async () => {
  const controller = new AbortController();
  const sourceUrl = 'https://streamff.pro/v/0c9ead67';
  const result = await resolveVideo(sourceUrl, { signal: controller.signal, fetcher: async (url, options) => {
    assert.equal(url, './api/resolve-video.php?provider=streamff&id=0c9ead67');
    assert.equal(options.signal, controller.signal);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    return Response.json({ url: 'https://cdn.hostedhost.top/0c9ead67.mp4' });
  } });
  assert.deepEqual(result, { type: 'video', url: 'https://cdn.hostedhost.top/0c9ead67.mp4', format: 'mp4', sourceUrl });
  controller.abort();
  await assert.rejects(resolveVideo(sourceUrl, { signal: controller.signal, fetcher: () => assert.fail('Aborted request') }), { name: 'AbortError' });
});

test('missing, malformed and unavailable clips report errors instead of loading HTML as video', async () => {
  const url = 'https://streamff.pro/v/0c9ead67';
  for (const response of [Response.json({}, { status: 502 }), new Response('<html>'), Response.json(null), Response.json({ url: ['https://example.org/video.mp4'] }), Response.json({ url: 'https://streamff.pro/v/0c9ead67' }), Response.json({ url: 'javascript:alert(1)' })]) {
    await assert.rejects(resolveVideo(url, { fetcher: async () => response }));
  }
});
