import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import * as sources from '../video-sources.js';

const source = await readFile(new URL('../video-player.js', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'jsx', format: 'cjs' });
const redditStream = 'https://v.redd.it/example/HLSPlaylist.m3u8?a=1&b=2';

// Execute the real component's effect with controlled browser capabilities.
// Chrome/WebView can report native HLS support even when Reddit playback fails.
async function player({ src = redditStream, mse = true, nativeHls = 'maybe', resolver = sources.resolveVideo } = {}) {
  const states = [], instances = [], effects = [], listeners = new Map(), timers = new Set();
  let paused = false, loaded = false;
  const video = {
    src: '',
    canPlayType: () => nativeHls,
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: name => listeners.delete(name),
    pause: () => { paused = true; },
    load: () => { loaded = true; },
    removeAttribute: name => { if (name === 'src') video.src = ''; },
  };
  class Hls {
    static isSupported() { return mse; }
    static Events = { ERROR: 'hlsError' };
    constructor() { instances.push(this); }
    on(name, handler) { this[name] = handler; }
    loadSource(url) { this.source = url; }
    attachMedia(element) { this.media = element; }
    destroy() { this.destroyed = true; }
  }
  const React = {
    createElement: () => null,
    useRef: () => ({ current: video }),
    useState: initial => {
      const state = { value: initial };
      states.push(state);
      return [initial, value => { state.value = value; }];
    },
    useEffect: effect => effects.push(effect),
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, AbortController,
    setTimeout: callback => { timers.add(callback); return callback; },
    clearTimeout: callback => timers.delete(callback),
    require: name => {
      if (name === 'react') return React;
      if (name === 'hls.js') return Hls;
      if (name === './video-sources.js') return { ...sources, resolveVideo: resolver };
      throw new Error('Unexpected import: ' + name);
    },
  });
  module.exports.default({ src });
  const cleanup = effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  return { video, states, instances, listeners, timers, cleanup, stopped: () => paused && loaded };
}

test('v.redd.it uses HLS.js even when WebView advertises native HLS support', async () => {
  for (const nativeHls of ['maybe', 'probably', '']) {
    const run = await player({ nativeHls });
    assert.equal(run.instances.length, 1);
    assert.equal(run.instances[0].source, redditStream);
    assert.equal(run.instances[0].media, run.video);
    assert.equal(run.video.src, '', 'Do not hand the Reddit playlist to native playback');
    run.listeners.get('canplay')();
    assert.equal(run.states[1].value, false);
    assert.equal(run.timers.size, 0);
    run.cleanup();
    assert.equal(run.instances[0].destroyed, true);
    assert.equal(run.listeners.size, 0);
    assert.equal(run.stopped(), true);
  }
});

test('native HLS remains available when MediaSource playback is unavailable', async () => {
  const run = await player({ mse: false, nativeHls: 'maybe' });
  assert.equal(run.instances.length, 0);
  assert.equal(run.video.src, redditStream);
  run.cleanup();
});

test('MP4 and WebM retain direct playback', async () => {
  for (const extension of ['mp4', 'webm']) {
    const src = `https://example.org/clip.${extension}`;
    const run = await player({ src });
    assert.equal(run.instances.length, 0);
    assert.equal(run.video.src, src);
    run.cleanup();
  }
});

test('unsupported HLS stops loading and reports a playable error state', async () => {
  const run = await player({ mse: false, nativeHls: '' });
  assert.equal(run.instances.length, 0);
  assert.equal(run.video.src, '');
  assert.match(run.states[0].value, /could not be played/);
  assert.equal(run.states[1].value, false);
  assert.equal(run.timers.size, 0);
  run.cleanup();
});

test('only fatal HLS errors stop the player', async () => {
  const run = await player({ nativeHls: '' });
  run.instances[0].hlsError(null, { fatal: false });
  assert.equal(run.states[0].value, '');
  run.instances[0].hlsError(null, { fatal: true });
  assert.match(run.states[0].value, /could not be played/);
  assert.equal(run.instances[0].destroyed, true);
  run.cleanup();
});

test('closing during resolution cannot start a player afterwards', async () => {
  let finish, signal;
  const run = await player({ resolver: (_src, options) => {
    signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  } });
  run.cleanup();
  assert.equal(signal.aborted, true);
  finish({ url: redditStream, format: 'hls' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.instances.length, 0);
  assert.equal(run.video.src, '');
});
