// Keep a surviving parent card steady while replies above it animate in/out.
export function preserveCommentPosition(element, top, onFinish = () => {}) {
    const doc = element.ownerDocument;
    const win = doc.defaultView;
    const root = doc.documentElement;
    const previousAnchoring = root.style.overflowAnchor;
    root.style.overflowAnchor = 'none';
    const deadline = win.performance.now() + 1500; // Reply reveals take at most 1200ms.
    let frame;
    let finished = false;
    const stop = () => {
        if (finished) return;
        finished = true;
        win.cancelAnimationFrame(frame);
        root.style.overflowAnchor = previousAnchoring;
        for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) win.removeEventListener(event, onInput);
        onFinish();
    };
    const onInput = event => {
        // Keep tracking through a footer press: the next toggle/jump replaces
        // the anchor in its click handler. Cancelling on pointerdown leaves a
        // frame in which a large animation can move the current comment away.
        if (event?.type !== 'wheel' && event?.target?.closest?.('.app-footer')) return;
        stop();
    };
    const restore = () => {
        if (!element.isConnected) return stop();
        const delta = element.getBoundingClientRect().top - top;
        if (Math.abs(delta) > 0.5) win.scrollTo({ top: Math.max(0, win.scrollY + delta), behavior: 'instant' });
        if (win.performance.now() < deadline) frame = win.requestAnimationFrame(restore);
        else stop();
    };
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) win.addEventListener(event, onInput, { passive: true });
    frame = win.requestAnimationFrame(restore);
    return stop;
}

export function getCommentAnchor(parents, clearance, viewportHeight) {
    const parent = parents.find(element => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > clearance && rect.top < viewportHeight;
    });
    if (!parent) return null;
    const element = parent.firstElementChild;
    // If the user is inside a reply that will disappear, keep its parent just
    // below the header instead of leaving the viewport inside hidden replies.
    return { element, top: Math.max(clearance, element.getBoundingClientRect().top) };
}
