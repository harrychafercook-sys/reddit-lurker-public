import React, { useEffect, useRef, useState } from 'react';
import { fitImage, clampImage, pinchImage } from './image-transform.js';

export default function ZoomableImage({ src, onLoad }) {
    const stage = useRef(null);
    const image = useRef(null);
    const points = useRef(new Map());
    const gesture = useRef(null);
    const transform = useRef(fitImage());
    const lastTap = useRef(null);
    const tap = useRef(null);
    const [view, setView] = useState(fitImage);
    const [failed, setFailed] = useState(false);
    const commit = next => {
        const bounded = clampImage(next,
            { width: image.current?.offsetWidth || 0, height: image.current?.offsetHeight || 0 },
            { width: stage.current?.clientWidth || 0, height: stage.current?.clientHeight || 0 });
        transform.current = bounded;
        setView(bounded);
    };
    const midpoint = values => ({ x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 });
    const distance = values => Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
    const relative = point => {
        const rect = stage.current.getBoundingClientRect();
        return { x: point.x - rect.left - rect.width / 2, y: point.y - rect.top - rect.height / 2 };
    };
    const rebase = () => {
        const values = [...points.current.values()];
        gesture.current = values.length >= 2
            ? { start: transform.current, anchor: relative(midpoint(values)), distance: Math.max(1, distance(values)) }
            : values.length ? { start: transform.current, point: values[0] } : null;
    };
    const pointerDown = event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.stopPropagation();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer may already be released. */ }
        points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        tap.current = points.current.size === 1 ? { x: event.clientX, y: event.clientY, at: Date.now() } : null;
        if (points.current.size > 1) lastTap.current = null;
        rebase();
    };
    const pointerMove = event => {
        if (!points.current.has(event.pointerId)) return;
        event.stopPropagation();
        points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (tap.current && Math.hypot(event.clientX - tap.current.x, event.clientY - tap.current.y) > 8) tap.current = null;
        const values = [...points.current.values()];
        const start = gesture.current;
        if (values.length >= 2 && start?.distance) {
            commit(pinchImage(start.start, start.anchor, relative(midpoint(values)), distance(values) / start.distance));
        } else if (start?.point && transform.current.scale > 1) {
            commit({ ...start.start, x: start.start.x + values[0].x - start.point.x,
                y: start.start.y + values[0].y - start.point.y });
        }
    };
    const pointerUp = event => {
        if (!points.current.has(event.pointerId)) return;
        event.stopPropagation();
        if (event.type === 'pointerup' && tap.current && Date.now() - tap.current.at < 300) {
            const previous = lastTap.current;
            if (previous && Date.now() - previous.at < 350 && Math.hypot(previous.x - event.clientX, previous.y - event.clientY) < 30) {
                const anchor = relative({ x: event.clientX, y: event.clientY });
                commit(transform.current.scale > 1 ? fitImage() : pinchImage(fitImage(), anchor, anchor, 2));
                lastTap.current = null;
            } else lastTap.current = { x: event.clientX, y: event.clientY, at: Date.now() };
        }
        tap.current = null;
        points.current.delete(event.pointerId);
        rebase();
    };
    useEffect(() => {
        const observer = new ResizeObserver(() => { commit(fitImage()); points.current.clear(); gesture.current = null; });
        observer.observe(stage.current);
        return () => observer.disconnect();
    }, []);
    return (
        <div className="zoomable-image" ref={stage} aria-label="Image viewer" onPointerDown={pointerDown} onPointerMove={pointerMove}
            onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp} onClick={event => event.stopPropagation()}>
            {failed ? <p role="status" className="text-white">Image could not be loaded.</p> :
                <img ref={image} src={src} alt="Reddit post image" draggable={false} onLoad={() => { commit(fitImage()); onLoad(); }}
                    onError={() => { setFailed(true); onLoad(); }} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />}
            <div className="image-zoom-controls" onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
                <button type="button" aria-label="Zoom image out" disabled={view.scale <= 1 || failed} onClick={() => commit({ ...view, scale: view.scale - .5 })}>−</button>
                <button type="button" aria-label="Reset image zoom" onClick={() => commit(fitImage())}>{Math.round(view.scale * 100)}%</button>
                <button type="button" aria-label="Zoom image in" disabled={view.scale >= 5 || failed} onClick={() => commit({ ...view, scale: view.scale + .5 })}>+</button>
            </div>
        </div>
    );
}
