import test from 'node:test';
import assert from 'node:assert/strict';
import { getNavScrollChange } from '../nav-scroll.js';

test('small upward movements leave the bars hidden until 48px of deliberate travel', () => {
    let distance = 0;
    for (let y = 500; y > 460; y -= 8) {
        const next = getNavScrollChange(y, y - 8, distance);
        assert.equal(next.visible, null);
        distance = next.distance;
    }
    assert.deepEqual(getNavScrollChange(460, 452, distance), { distance: 0, visible: true });
});

test('alternating scroll jitter does not accumulate into a reveal', () => {
    let distance = 0;
    for (let i = 0; i < 100; i++) {
        const next = getNavScrollChange(i % 2 ? 499 : 500, i % 2 ? 500 : 499, distance);
        assert.equal(next.visible, null);
        distance = next.distance;
    }
    assert.equal(getNavScrollChange(500, 490, 20).distance, -10);
});

test('scrolling down hides the bars after a smaller 24px threshold', () => {
    assert.equal(getNavScrollChange(500, 510).visible, null);
    assert.deepEqual(getNavScrollChange(510, 524, 10), { distance: 0, visible: false });
});

test('the top of the page always exposes navigation and stationary events do not toggle it', () => {
    assert.deepEqual(getNavScrollChange(104, 99, 20), { distance: 0, visible: true });
    assert.deepEqual(getNavScrollChange(0, -10, 0), { distance: 0, visible: true });
    assert.deepEqual(getNavScrollChange(500, 500, -30), { distance: -30, visible: null });
});
