import test from 'node:test';
import assert from 'node:assert/strict';
import { observeHeaderHeight, getHeaderClearance, getHeaderScrollTop } from '../header-layout.js';

test('page spacing follows the measured header when safe areas, zoom or wrapping change', () => {
    let update, disconnected = false;
    const previous = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
        constructor(callback) { update = callback; }
        observe(element, options) {
            assert.equal(element, header);
            assert.deepEqual(options, { box: 'border-box' }); // Safe-area padding can change by itself.
        }
        disconnect() { disconnected = true; }
    };
    const values = {};
    const header = { offsetHeight: 102, ownerDocument: { documentElement: {
        style: { setProperty: (key, value) => { values[key] = value; } },
    } } };
    try {
        const cleanup = observeHeaderHeight(header);
        assert.equal(values['--app-header-height'], '102px');
        header.offsetHeight = 146;
        update();
        assert.equal(values['--app-header-height'], '146px');
        cleanup();
        assert.equal(disconnected, true);
    } finally { globalThis.ResizeObserver = previous; }
});

test('comment jumps clear the complete active header including safe area and scaled gap', () => {
    const doc = {
        documentElement: {},
        querySelector(selector) {
            assert.equal(selector, '.app-header[data-active="true"]');
            return { offsetHeight: 128 }; // Includes safe-area padding, even when translated away.
        },
        defaultView: { scrollY: 700, getComputedStyle: () => ({ fontSize: '24px' }) },
    };
    const element = { ownerDocument: doc, getBoundingClientRect: () => ({ top: 250, bottom: 600 }) };
    assert.equal(getHeaderClearance(doc), 140);
    assert.equal(getHeaderScrollTop(element), 810);
    assert.equal(getHeaderScrollTop(element, 'bottom'), 1160);
    doc.defaultView.scrollY = 0;
    element.getBoundingClientRect = () => ({ top: 10 });
    assert.equal(getHeaderScrollTop(element), 0);
});
