import { MAX_EXPORT_BYTES } from './video-export.js';

let channel = null;
let channelVersion = 0;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];
export const NATIVE_APP_DOWNLOAD = 'https://english-grammar-homework.com/rlurker-downloads/Reddit-Lurker-7.6.3.apk';
let transferring = false;
let sequence = 0;
const pending = new Map();
function disconnect() {
    channel?.close();
    channel = null;
    channelVersion = 0;
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('The Android connection was closed.')); }
    pending.clear();
}
if (typeof window !== 'undefined') {
    window.addEventListener('message', event => {
        // Android supplies a port to the main frame, addressed to this exact origin.
        if (!['reddit-lurker-media-v1', 'reddit-lurker-media-v2'].includes(event.data) || !event.ports?.[0] || event.source !== null) return;
        disconnect();
        channelVersion = event.data === 'reddit-lurker-media-v2' ? 2 : 1;
        channel = event.ports[0];
        channel.onmessage = event => {
            let reply;
            try { reply = JSON.parse(event.data); } catch { return; }
            const waiter = pending.get(reply.id);
            if (!waiter) return;
            clearTimeout(waiter.timer);
            pending.delete(reply.id);
            if (reply.error) waiter.reject(new Error(reply.error)); else waiter.resolve(reply);
        };
        channel.start();
    });
    window.addEventListener('pagehide', disconnect);
}
export const hasNativeMedia = (mime = 'video/mp4') => !!channel &&
    (mime === 'video/mp4' || (channelVersion >= 2 && IMAGE_TYPES.includes(mime)));

function request(command) {
    if (!channel) return Promise.reject(new Error('Update the Android APK to enable file sharing and downloads.'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Android did not finish the file transfer.')); }, 30000);
        pending.set(id, { resolve, reject, timer });
        try { channel.postMessage(JSON.stringify({ ...command, id })); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
}

export const checkAndroidUpdates = () => request({ op: 'check-update' });

export async function transferToAndroid(file, action, { signal, onProgress = () => {} } = {}, send = request) {
    if (!['share', 'download'].includes(action) || !['video/mp4', ...IMAGE_TYPES].includes(file.type) || !file.size || file.size > MAX_EXPORT_BYTES) throw new Error('Unsupported file export.');
    signal?.throwIfAborted();
    if (transferring) throw new Error('Another file is still being sent. Please try again in a moment.');
    transferring = true;
    const session = crypto.randomUUID();
    let complete = false;
    try {
        await send({ op: 'begin', session, name: file.name, mime: file.type, size: file.size, action });
        // Acknowledgements apply backpressure; only one small chunk is in flight.
        for (let offset = 0; offset < file.size; offset += 49152) {
            signal?.throwIfAborted();
            const bytes = new Uint8Array(await file.slice(offset, offset + 49152).arrayBuffer());
            let binary = '';
            for (const byte of bytes) binary += String.fromCharCode(byte);
            await send({ op: 'chunk', session, offset, data: btoa(binary) });
            onProgress(Math.round(Math.min(file.size, offset + bytes.length) / file.size * 100));
        }
        signal?.throwIfAborted();
        await send({ op: 'finish', session });
        complete = true;
    } finally {
        if (!complete) await send({ op: 'cancel', session }).catch(() => {});
        transferring = false;
    }
}
