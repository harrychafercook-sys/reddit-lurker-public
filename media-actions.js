import React, { useEffect, useRef, useState } from 'react';
import { prepareVideo } from './video-export.js';
import { prepareImage } from './image-export.js';
import { hasNativeMedia, transferToAndroid, NATIVE_APP_DOWNLOAD } from './native-media.js';

export default function MediaActions({ item }) {
    const image = item.type === 'image';
    const noun = image ? 'image' : 'video';
    const label = image ? 'Image' : 'Video';
    const [state, setState] = useState('idle');
    const [progress, setProgress] = useState(0);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [intent, setIntent] = useState('share');
    const active = useRef(null);
    const alive = useRef(true);
    const downloadUrl = useRef(null);
    useEffect(() => () => {
        alive.current = false;
        active.current?.abort();
        if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    }, []);
    const prepare = async (event, action) => {
        event.stopPropagation();
        if (active.current) return;
        setIntent(action);
        setError('');
        if (result) { setState('ready'); return; }
        const controller = new AbortController();
        active.current = controller;
        setState('preparing');
        setProgress(0);
        try {
            const prepared = await (image ? prepareImage : prepareVideo)(item, { signal: controller.signal, onProgress: value => { if (alive.current) setProgress(value); } });
            if (alive.current && !controller.signal.aborted) { setResult(prepared); setState('ready'); }
        } catch (error) {
            if (alive.current && !controller.signal.aborted) { setError(error.message || 'Could not prepare this ' + noun + '.'); setState('error'); }
        } finally { if (active.current === controller) active.current = null; }
    };
    const close = event => {
        event.stopPropagation();
        active.current?.abort();
        active.current = null;
        setState('idle');
        setResult(null);
        setError('');
        if (downloadUrl.current) { URL.revokeObjectURL(downloadUrl.current); downloadUrl.current = null; }
    };
    const deliver = async (event, action) => {
        event.stopPropagation();
        if (!result || active.current) return;
        setError('');
        const controller = new AbortController();
        active.current = controller;
        try {
            if (hasNativeMedia(result.file.type)) {
                setState('sending');
                setProgress(0);
                await transferToAndroid(result.file, action, { signal: controller.signal, onProgress: value => { if (alive.current) setProgress(value); } });
            } else if (action === 'share') {
                // This second tap has a fresh user gesture, unlike a share call
                // made after a long network request or conversion.
                await navigator.share({ files: [result.file], title: 'Reddit ' + noun });
            } else {
                if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
                downloadUrl.current = URL.createObjectURL(result.file);
                const link = document.createElement('a');
                link.href = downloadUrl.current;
                link.download = result.file.name;
                document.body.appendChild(link);
                link.click();
                link.remove();
            }
            if (alive.current && !controller.signal.aborted) setState('ready');
        } catch (error) {
            if (alive.current && !controller.signal.aborted) {
                if (error.name !== 'AbortError') setError(error.message || 'Could not send the ' + noun + '.');
                setState('ready');
            }
        } finally { if (active.current === controller) active.current = null; }
    };
    const oldAndroid = (/; wv\b/.test(navigator.userAgent) || hasNativeMedia()) && !hasNativeMedia(image ? 'image/jpeg' : 'video/mp4');
    const canShare = !!result && (hasNativeMedia(result.file.type) || (!!navigator.share && !!navigator.canShare?.({ files: [result.file] })));
    const format = image ? result?.file.name.split('.').pop().toUpperCase() : 'MP4';
    return <>
        <button type="button" aria-label={image ? 'Download image' : 'Download video with audio'} className="media-action" onClick={event => prepare(event, 'download')}>↓</button>
        <button type="button" aria-label={image ? 'Share image' : 'Share video with audio'} className="media-action" onClick={event => prepare(event, 'share')}>
            <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.5 6.6-4M8.7 13.5l6.6 4"/></svg>
        </button>
        {state !== 'idle' && <section className="video-export-panel" aria-label={label + ' export'} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
            <h2>{state === 'ready' ? label + ' ready' : state === 'sending' ? 'Sending ' + noun + '…' : state === 'error' ? label + ' export failed' : 'Preparing ' + noun + '…'}</h2>
            {(state === 'preparing' || state === 'sending') && <><progress max="100" value={progress} /><p role="status">{progress}% · {state === 'sending' ? 'Saving the file' : image ? 'Loading the image' : 'Combining video and audio'}</p></>}
            {state === 'ready' && <>
                <p>{format} · {(result.file.size / 1048576).toFixed(1)} MB{!image && (' · ' + (result.hasAudio ? 'Audio included' : 'Original has no audio'))}</p>
                {oldAndroid ? <a className="export-primary" href={NATIVE_APP_DOWNLOAD} target="_blank" rel="noopener noreferrer">Update Android app to save or share {noun}s</a> : <div className="export-buttons">
                    {canShare && <button className={intent === 'share' ? 'export-primary' : ''} onClick={event => deliver(event, 'share')}>Share {noun}</button>}
                    <button className={intent === 'download' || !canShare ? 'export-primary' : ''} onClick={event => deliver(event, 'download')}>Download {format}</button>
                </div>}
                {!canShare && !oldAndroid && <p>Download the {noun}, then share it from your files.</p>}
            </>}
            {error && <p role="alert">{error}</p>}
            <button className="export-cancel" onClick={close}>{state === 'preparing' || state === 'sending' ? 'Cancel' : 'Close'}</button>
        </section>}
    </>;
}
