import { Input, UrlSource, HLS_FORMATS, Output, Mp4OutputFormat, BufferTarget, Conversion, desc } from 'mediabunny';

export const MAX_EXPORT_BYTES = 96 * 1024 * 1024;
const MAX_NETWORK_BYTES = 160 * 1024 * 1024;

export function videoSourceUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'v.redd.it' || url.port || url.username || url.password ||
        !/^\/[a-z0-9]+\/[^/]+\.m3u8$/i.test(url.pathname)) {
        throw new Error('This video does not have a supported Reddit playback stream.');
    }
    return url;
}

// Read the same HLS presentation as playback, including its paired audio track.
// No proxy, server conversion, persistent media cache or silent fallback URL.
export async function prepareVideo(item, { signal, onProgress = () => {}, fetcher = globalThis.fetch } = {}) {
    const url = videoSourceUrl(item.url);
    signal?.throwIfAborted();
    let input, conversion, transferred = 0, outputBytes = 0, timedOut = false;
    const abort = () => { input?.dispose(); conversion?.cancel().catch(() => {}); };
    const timeout = setTimeout(() => { timedOut = true; abort(); }, 180000);
    signal?.addEventListener('abort', abort, { once: true });
    try {
        const source = new UrlSource(url, {
            maxCacheSize: 4 * 1024 * 1024,
            parallelism: 2,
            getRetryDelay: attempts => attempts < 2 ? .5 : null,
            fetchFn: async (resource, options) => {
                const target = new URL(typeof resource === 'string' ? resource : resource.url || resource.href);
                if (target.origin !== url.origin || !target.pathname.startsWith('/' + url.pathname.split('/')[1] + '/')) {
                    throw new Error('The video playlist contains an unsupported media location.');
                }
                const response = await fetcher(resource, { ...options, cache: 'no-store', credentials: 'omit', redirect: 'error' });
                if (!response.ok) throw new Error('Video download failed (HTTP ' + response.status + ').');
                if (!response.body) throw new Error('The video server returned an empty response.');
                return new Response(response.body.pipeThrough(new TransformStream({
                    transform(chunk, controller) {
                        transferred += chunk.byteLength;
                        if (transferred > MAX_NETWORK_BYTES) throw new Error('This video is too large to export on this device.');
                        controller.enqueue(chunk);
                    },
                })), { status: response.status, headers: response.headers });
            },
            handleUnhandledError: () => {},
        });
        input = new Input({ source, formats: HLS_FORMATS });
        const candidates = await input.getVideoTracks({
            filter: async track => !(await track.hasOnlyKeyPackets()),
            sortBy: async track => [desc(Math.min(await track.getDisplayHeight(), await track.getDisplayWidth()) <= 720 ? 1 : 0), desc(await track.getDisplayWidth())],
        });
        const video = candidates[0];
        if (!video) throw new Error('No video track was found.');
        if (await video.isLive()) throw new Error('Live streams cannot be exported until they have finished.');
        const audio = await video.getPrimaryPairableAudioTrack();
        if (!audio && item.hasAudio === true) throw new Error('The original audio track could not be found. No silent copy was created.');
        const duration = await video.computeDuration();
        if (duration - await video.getFirstTimestamp() > 1800) throw new Error('Please choose a video shorter than 30 minutes.');
        const target = new BufferTarget();
        target.on('write', ({ end }) => {
            outputBytes = Math.max(outputBytes, end);
            if (outputBytes > MAX_EXPORT_BYTES) throw new Error('This video is too large to export on this device.');
        });
        const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
        conversion = await Conversion.init({ input, output, tracks: 'all', showWarnings: false,
            video: track => ({ discard: track !== video }),
            audio: track => ({ discard: track !== audio }),
        });
        if (!conversion.isValid || !conversion.utilizedTracks.includes(video) || (audio && !conversion.utilizedTracks.includes(audio))) {
            throw new Error('This video and its audio cannot be combined on this device.');
        }
        conversion.onProgress = value => onProgress(Math.min(99, Math.round(value * 100)));
        signal?.throwIfAborted();
        await conversion.execute();
        signal?.throwIfAborted();
        if (!target.buffer?.byteLength || target.buffer.byteLength > MAX_EXPORT_BYTES) throw new Error('The video export could not be completed.');
        onProgress(100);
        return { file: new File([target.buffer], 'reddit-' + url.pathname.split('/')[1] + '.mp4', { type: 'video/mp4' }), hasAudio: !!audio };
    } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (timedOut) throw new Error('Video preparation timed out. Please try again on a faster connection.');
        throw error;
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        input?.dispose();
        if (conversion && conversion.state !== 'done') await conversion.cancel().catch(() => {});
    }
}
