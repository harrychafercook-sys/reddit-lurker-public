import test from 'node:test';
import assert from 'node:assert/strict';
import { getCommentAnchor, preserveCommentPosition } from '../comment-scroll.js';

test('collapse anchors the visible parent, excluding threads entirely above the header', () => {
    const parent = (top, bottom) => ({
        getBoundingClientRect: () => ({ top, bottom }),
        firstElementChild: { getBoundingClientRect: () => ({ top }) },
    });
    const parents = [parent(-400, 100), parent(150, 750), parent(755, 1000)];
    const anchor = getCommentAnchor(parents, 140, 800);
    assert.equal(anchor.element, parents[1].firstElementChild);
    assert.equal(anchor.top, 150);
    const insideReplies = getCommentAnchor([parent(-500, 750)], 140, 800);
    assert.equal(insideReplies.top, 140);
    assert.equal(getCommentAnchor([parent(-500, 100)], 140, 800), null);
});

function fixture() {
    let now = 0, frame, contentY = 850, calls = 0, finished = 0;
    const events = new Map();
    const root = { style: { overflowAnchor: '' } };
    const win = {
        scrollY: 700,
        performance: { now: () => now },
        requestAnimationFrame(callback) { frame = callback; return 1; },
        cancelAnimationFrame() { frame = null; },
        addEventListener(event, callback) { events.set(event, callback); },
        removeEventListener(event) { events.delete(event); },
        scrollTo({ top, behavior }) { assert.equal(behavior, 'instant'); this.scrollY = top; calls++; },
    };
    const element = { isConnected: true, ownerDocument: { documentElement: root, defaultView: win },
        getBoundingClientRect: () => ({ top: contentY - win.scrollY }) };
    const stop = preserveCommentPosition(element, 150, () => finished++);
    return { element, win, events, root, stop,
        move(y) { contentY = y; },
        tick(time) { now = time; const callback = frame; frame = null; callback?.(); },
        get calls() { return calls; }, get finished() { return finished; },
    };
}

test('collapse and expand animations preserve the same screen position throughout height changes', () => {
    const f = fixture();
    assert.equal(f.root.style.overflowAnchor, 'none');
    for (const [time, y] of [[16, 790], [180, 620], [360, 420], [550, 850], [1200, 2000]]) {
        f.move(y);
        f.tick(time);
        assert.equal(f.element.getBoundingClientRect().top, 150);
    }
    f.tick(1500);
    assert.equal(f.finished, 1);
    assert.equal(f.root.style.overflowAnchor, '');
    assert.equal(f.events.size, 0);
});

test('user scrolling, repeated toggles and leaving the thread cancel the anchor cleanly', () => {
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
        const f = fixture();
        f.events.get(event)();
        f.move(2000);
        f.tick(16);
        f.stop();
        assert.equal(f.calls, 0);
        assert.equal(f.finished, 1);
        assert.equal(f.events.size, 0);
    }
    const f = fixture();
    f.element.isConnected = false;
    f.tick(16);
    assert.equal(f.finished, 1);
});

test('pressing the footer keeps tracking until the next toggle replaces the anchor', () => {
    const f = fixture();
    f.events.get('pointerdown')({ type: 'pointerdown', target: { closest: () => ({}) } });
    f.move(620);
    f.tick(100);
    assert.equal(f.element.getBoundingClientRect().top, 150);
    assert.equal(f.finished, 0);
    f.stop();
    assert.equal(f.finished, 1);
});
