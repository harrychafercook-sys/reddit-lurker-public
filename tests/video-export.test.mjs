import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Input, BlobSource, MP4, EncodedPacketSink } from 'mediabunny';
import { prepareVideo, videoSourceUrl } from '../video-export.js';
import { transferToAndroid } from '../native-media.js';

const fixtureRoot = new URL('./fixtures/video/', import.meta.url);
export async function fixtureFetch(resource, options = {}) {
    const url = new URL(resource);
    const filename = url.pathname.split('/').pop();
    if (!/^[a-z0-9.-]+$/.test(filename)) return new Response('', { status: 404 });
    const data = await readFile(new URL(filename, fixtureRoot));
    const range = new Headers(options.headers).get('range')?.match(/^bytes=(\d+)-(\d*)$/);
    const headers = { 'content-type': filename.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4', 'accept-ranges': 'bytes' };
    if (range) {
        const start = Number(range[1]), end = Math.min(data.length - 1, range[2] ? Number(range[2]) : data.length - 1);
        if (start >= data.length) return new Response('', { status: 416 });
        headers['content-range'] = `bytes ${start}-${end}/${data.length}`;
        headers['content-length'] = String(end - start + 1);
        return new Response(data.subarray(start, end + 1), { status: 206, headers });
    }
    headers['content-length'] = String(data.length);
    return new Response(data, { headers });
}
const item = { url: 'https://v.redd.it/fixture/master.m3u8', hasAudio: true };

test('export joins real separate HLS video and AAC audio into a playable MP4 with preserved timing', async () => {
    const requests = [];
    const result = await prepareVideo(item, { fetcher: (url, options) => { requests.push(String(url)); return fixtureFetch(url, options); } });
    assert.equal(result.hasAudio, true);
    assert.equal(result.file.type, 'video/mp4');
    const input = new Input({ source: new BlobSource(result.file), formats: [MP4] });
    try {
        const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
        assert.ok(video && audio, 'The exported file must contain both tracks');
        assert.equal(await video.getCodec(), 'avc');
        assert.equal(await audio.getCodec(), 'aac');
        assert.ok(Math.abs(await video.computeDuration() - 2) < .05);
        assert.ok(Math.abs(await audio.computeDuration() - 2) < .05);
        assert.ok(Math.abs(await video.getFirstTimestamp() - await audio.getFirstTimestamp()) < .05);
        let audioBytes = 0;
        for await (const packet of new EncodedPacketSink(audio).packets()) audioBytes += packet.data.byteLength;
        assert.ok(audioBytes > 1000, 'An audio track label alone is not enough; actual sound samples must be present');
        assert.ok(requests.some(url => url.includes('audio')));
        assert.ok(!requests.some(url => url.includes('corsproxy') || url.includes('DASH_')));
    } finally { input.dispose(); }
});

test('missing audio fails instead of silently returning video-only media; silent originals remain valid', async () => {
    const silent = { url: 'https://v.redd.it/fixture/video.m3u8', hasAudio: true };
    await assert.rejects(prepareVideo(silent, { fetcher: fixtureFetch }), /No silent copy/);
    const result = await prepareVideo({ ...silent, hasAudio: false }, { fetcher: fixtureFetch });
    assert.equal(result.hasAudio, false);
});

test('failed audio fetches and cancelled requests do not yield a partial file', async () => {
    await assert.rejects(prepareVideo(item, { fetcher: (url, options) => String(url).includes('audio00') ? Promise.resolve(new Response('', { status: 404 })) : fixtureFetch(url, options) }), /404/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(prepareVideo(item, { signal: controller.signal, fetcher: fixtureFetch }), { name: 'AbortError' });
    assert.throws(() => videoSourceUrl('https://example.org/video.m3u8'), /supported Reddit/);
});

test('Android receives the exact MP4 bytes with ordered chunks and acknowledgements', async () => {
    const bytes = new Uint8Array(120000).map((_, index) => index % 251);
    const file = new File([bytes], 'reddit-test.mp4', { type: 'video/mp4' });
    const chunks = []; let offset = 0, begun = false, finished = false;
    await transferToAndroid(file, 'share', {}, async command => {
        if (command.op === 'begin') { begun = true; assert.equal(command.size, bytes.length); }
        if (command.op === 'chunk') {
            assert.ok(begun); assert.equal(command.offset, offset);
            const chunk = Buffer.from(command.data, 'base64');
            assert.ok(chunk.length <= 49152); offset += chunk.length; chunks.push(chunk);
        }
        if (command.op === 'finish') { assert.equal(offset, bytes.length); finished = true; }
    });
    assert.equal(finished, true);
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(bytes));
});

test('Android transfer cancellation removes an unfinished temporary file', async () => {
    const controller = new AbortController(); const operations = [];
    await assert.rejects(transferToAndroid(new File([new Uint8Array(60000)], 'video.mp4', { type: 'video/mp4' }), 'download', { signal: controller.signal }, async command => {
        operations.push(command.op); if (command.op === 'chunk') controller.abort();
    }), { name: 'AbortError' });
    assert.deepEqual(operations, ['begin', 'chunk', 'cancel']);
});
