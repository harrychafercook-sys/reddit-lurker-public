import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareImage, MAX_IMAGE_BYTES } from '../image-export.js';
import { transferToAndroid } from '../native-media.js';

const samples = [
    ['png', 'image/png', Buffer.from([137,80,78,71,13,10,26,10])],
    ['jpg', 'image/jpeg', Buffer.from([255,216,255,224])],
    ['gif', 'image/gif', Buffer.from('GIF89a\x01\x00\x01\x00animated-frame-data')],
    ['webp', 'image/webp', Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8X')],
    ['avif', 'image/avif', Buffer.from('\x00\x00\x00\x20ftypavif')],
];

test('images retain their encoded bytes, true MIME and extension through Android sharing', async () => {
    for (const [extension, mime, bytes] of samples) {
        const { file } = await prepareImage({ url: 'https://i.redd.it/example.jpg?format=png' }, { fetcher: async (url, options) => {
            assert.equal(url, 'https://i.redd.it/example.jpg?format=png');
            assert.equal(options.credentials, 'omit');
            assert.equal(options.cache, 'no-store');
            assert.equal(options.referrerPolicy, 'no-referrer');
            // Neither the URL nor a bad Content-Type may relabel the image.
            return new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } });
        } });
        assert.equal(file.name, 'reddit-image.' + extension);
        assert.equal(file.type, mime);
        const chunks = [];
        const operations = [];
        await transferToAndroid(file, 'share', {}, async command => {
            operations.push(command.op);
            if (command.op === 'begin') { assert.equal(command.mime, mime); assert.equal(command.name, file.name); }
            if (command.op === 'chunk') chunks.push(Buffer.from(command.data, 'base64'));
        });
        assert.deepEqual(Buffer.concat(chunks), bytes);
        assert.deepEqual(operations, ['begin', 'chunk', 'finish']);
    }
});

test('same-host fallback preserves the entire signed image URL after CORS denial', async () => {
    const url = 'https://preview.redd.it/example.png?width=640&signature=a%2Bb';
    const requests = [];
    await prepareImage({ url }, { fetcher: async request => {
        requests.push(request);
        if (requests.length === 1) throw new TypeError('Failed to fetch');
        return new Response(samples[0][2]);
    } });
    assert.deepEqual(requests, [url, './api/fetch-image.php?' + new URLSearchParams({ url })]);
    let calls = 0;
    await assert.rejects(prepareImage({ url }, { fetcher: async () => { calls++; return new Response('', { status: 404 }); } }), /404/);
    assert.equal(calls, 1);
});

test('a direct image 403 retries through the same-host endpoint without the blocked third-party proxy', async () => {
    const requests = [];
    const { file } = await prepareImage({ url: 'https://i.redd.it/example.png' }, { fetcher: async url => {
        requests.push(url);
        return requests.length === 1 ? new Response('Forbidden', { status: 403 }) : new Response(samples[0][2]);
    } });
    assert.equal(file.type, 'image/png');
    assert.equal(requests.length, 2);
    assert.ok(requests[1].startsWith('./api/fetch-image.php?'));
    assert.ok(requests.every(url => !url.includes('corsproxy.io')));
});

test('the image fetcher reports upstream or size errors and does not treat JSON as an image', async () => {
    await assert.rejects(prepareImage({ url: 'https://i.redd.it/example.png' }, { fetcher: async url => {
        if (!url.startsWith('./api/')) throw new TypeError('CORS');
        return Response.json({ error: 'This image is too large to share (24 MB maximum).' }, { status: 413 });
    } }), /too large/);
});

test('HTML responses and oversized images cannot be passed to the share sheet', async () => {
    await assert.rejects(prepareImage({ url: 'https://i.redd.it/example.png' }, { fetcher: async () => new Response('<html>blocked</html>', { headers: { 'content-type': 'image/png' } }) }), /supported image/);
    let cancelled = false;
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
    await assert.rejects(prepareImage({ url: 'https://i.redd.it/large.png' }, { fetcher: async () => new Response(body) }), /too large/);
    assert.equal(cancelled, true);
    await assert.rejects(prepareImage({ url: 'https://i.redd.it/large.png' }, { fetcher: async () => new Response(samples[0][2], { headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) } }) }), /too large/);
});

test('closing image preparation cancels network work without starting the proxy', async () => {
    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(prepareImage({ url: 'https://i.redd.it/example.png' }, { signal: controller.signal, fetcher: async (_url, options) => {
        calls++;
        controller.abort();
        assert.equal(options.signal.aborted, true);
        throw new TypeError('Aborted fetch');
    } }), { name: 'AbortError' });
    assert.equal(calls, 1);
});

test('legacy Android supports video while the new channel also supports images', async () => {
    const listeners = new Map();
    const previous = globalThis.window;
    globalThis.window = { addEventListener: (name, handler) => listeners.set(name, handler) };
    try {
        const bridge = await import('../native-media.js?capability-test');
        const port = { start() {}, close() {} };
        const message = listeners.get('message');
        message({ data: 'reddit-lurker-media-v1', source: null, ports: [port] });
        assert.equal(bridge.hasNativeMedia('video/mp4'), true);
        assert.equal(bridge.hasNativeMedia('image/png'), false);
        message({ data: 'reddit-lurker-media-v2', source: {}, ports: [port] });
        assert.equal(bridge.hasNativeMedia('image/png'), false, 'Do not accept a port from another frame');
        message({ data: 'reddit-lurker-media-v2', source: null, ports: [port] });
        for (const [, mime] of samples) assert.equal(bridge.hasNativeMedia(mime), true);
        assert.equal(bridge.hasNativeMedia('text/html'), false);
        listeners.get('pagehide')();
        assert.equal(bridge.hasNativeMedia(), false);
    } finally {
        if (previous === undefined) delete globalThis.window;
        else globalThis.window = previous;
    }
});
