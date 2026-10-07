import React, { useLayoutEffect, useRef } from 'react';

export default function ReplyExpansion({ collapsed, revision, children }) {
    const containerRef = useRef(null);
    const heightRef = useRef(null);
    const animationRef = useRef(null);

    useLayoutEffect(() => {
        const container = containerRef.current;
        // A running animation supplies the current height for a smooth reversal.
        // Otherwise keep the last rendered height from before React added replies.
        const from = animationRef.current ? container.getBoundingClientRect().height : heightRef.current;
        animationRef.current?.cancel();
        animationRef.current = null;
        container.style.height = collapsed ? '0px' : 'auto';
        const to = container.getBoundingClientRect().height;
        heightRef.current = to;

        if (from === null || Math.abs(from - to) < 1 || !container.animate ||
            window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        // Keep short reveals familiar; give longer threads more time to unfold.
        const revealedHeight = to - from;
        const duration = revealedHeight > 0
            ? Math.min(1200, 520 + Math.max(0, revealedHeight - 600) * 0.16)
            : 360;
        const animation = container.animate([
            { height: `${from}px` }, { height: `${to}px` },
        ], { duration, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
        animationRef.current = animation;
        animation.onfinish = () => {
            if (animationRef.current !== animation) return;
            animationRef.current = null;
            // The underlying open height is auto, so media, resizing and nested
            // animations continue to lay out naturally after the transition.
            heightRef.current = container.getBoundingClientRect().height;
        };
    }, [collapsed, revision]);

    useLayoutEffect(() => {
        const container = containerRef.current;
        const observer = new ResizeObserver(() => {
            heightRef.current = container.getBoundingClientRect().height;
        });
        observer.observe(container);
        return () => {
            observer.disconnect();
            animationRef.current?.cancel();
        };
    }, []);

    return (
        <div ref={containerRef} className={`comment-replies ${collapsed ? 'collapsed' : ''}`}
            aria-hidden={collapsed ? true : undefined} inert={collapsed ? '' : undefined}>
            <div className="comment-replies-content">{children}</div>
        </div>
    );
}
