// offsetHeight includes native/browser safe-area padding and ignores the
// translate animation used to hide the bars.
export function observeHeaderHeight(header) {
    const root = header.ownerDocument.documentElement;
    const update = () => root.style.setProperty('--app-header-height', `${header.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header, { box: 'border-box' });
    return () => observer.disconnect();
}

export function getHeaderClearance(doc = document) {
    const header = doc.querySelector('.app-header[data-active="true"]');
    const rem = parseFloat(doc.defaultView.getComputedStyle(doc.documentElement).fontSize);
    return (header?.offsetHeight || 0) + rem / 2;
}

export function getHeaderScrollTop(element, edge = 'top') {
    const doc = element.ownerDocument;
    return Math.max(0, element.getBoundingClientRect()[edge] + doc.defaultView.scrollY - getHeaderClearance(doc));
}
