export const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

export function imageFormat(bytes) {
    const starts = values => values.every((value, index) => bytes[index] === value);
    const text = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
    if (starts([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])) return { mime: 'image/png', extension: 'png' };
    if (starts([0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', extension: 'jpg' };
    if (['GIF87a', 'GIF89a'].includes(text(0, 6))) return { mime: 'image/gif', extension: 'gif' };
    if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
    if (text(4, 4) === 'ftyp' && ['avif', 'avis'].includes(text(8, 4))) return { mime: 'image/avif', extension: 'avif' };
    throw new Error('This file is not a supported image.');
}

export async function prepareImage(item, { signal, onProgress = () => {}, fetcher = globalThis.fetch } = {}) {
    const url = new URL(item.shareUrl || item.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('This image cannot be shared.');
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error('Image preparation timed out. Please try again.')), 30000);
    let reader;
    try {
        const options = { signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' };
        let response;
        try { response = await fetcher(url.href, options); }
        catch (error) {
            controller.signal.throwIfAborted();
            if (!(error instanceof TypeError)) throw error;
        }
        if (!response || response.status === 403) {
            await response?.body?.cancel().catch(() => {});
            controller.signal.throwIfAborted();
            // Reddit image CDNs often permit display but block browser fetch.
            // The same-host endpoint reads only allowlisted public image hosts.
            response = await fetcher('./api/fetch-image.php?' + new URLSearchParams({ url: url.href }), options);
            if (!response.ok) {
                let message;
                try { message = (await response.json()).error; } catch {}
                throw new Error(typeof message === 'string' ? message : 'The image could not be downloaded. Please try again.');
            }
        }
        if (!response.ok) throw new Error('Image download failed (HTTP ' + response.status + ').');
        if (!response.body) throw new Error('The image server returned an empty response.');
        reader = response.body.getReader();
        const expected = Number(response.headers.get('content-length'));
        if (expected > MAX_IMAGE_BYTES) throw new Error('This image is too large to share (24 MB maximum).');
        const chunks = [];
        let size = 0;
        while (true) {
            controller.signal.throwIfAborted();
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_IMAGE_BYTES) throw new Error('This image is too large to share (24 MB maximum).');
            chunks.push(value);
            if (expected > 0) onProgress(Math.min(99, Math.round(size / expected * 100)));
        }
        controller.signal.throwIfAborted();
        const blob = new Blob(chunks);
        const format = imageFormat(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
        // Preserve the original encoded bytes, including animated GIF/WebP frames.
        const file = new File([blob], 'reddit-image.' + format.extension, { type: format.mime });
        onProgress(100);
        return { file };
    } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        throw error;
    } finally {
        await reader?.cancel().catch(() => {});
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
    }
}
