import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { getVideoLink, resolveVideo } from './video-sources.js';

export default function VideoPlayer({ src, sourceUrl = src, ...props }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const originalLink = getVideoLink(sourceUrl)?.url;

  useEffect(() => {
    const video = videoRef.current;
    const controller = new AbortController();
    let hls;
    setError('');
    setLoading(true);
    const fail = message => {
      if (controller.signal.aborted) return;
      clearTimeout(timeout);
      setError(message);
      setLoading(false);
    };
    const timeout = setTimeout(() => {
      fail('The video took too long to load. Try again or open the original link.');
      controller.abort();
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
    }, 20000);
    const ready = () => { clearTimeout(timeout); setLoading(false); };
    const playbackError = () => fail('This clip could not be played. It may have expired or the host may block playback here.');
    video.addEventListener('canplay', ready);
    video.addEventListener('error', playbackError);
    resolveVideo(src, { signal: controller.signal }).then(item => {
      if (controller.signal.aborted) return;
      // Chrome/WebView can advertise native HLS but fail on Reddit playlists.
      // Prefer the same HLS.js path used before external clip playback was added.
      if (item.format === 'hls' && Hls.isSupported()) {
        hls = new Hls();
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) { playbackError(); hls.destroy(); }
        });
        hls.loadSource(item.url);
        hls.attachMedia(video);
      } else if (item.format !== 'hls' || video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = item.url;
      } else {
        playbackError();
      }
    }).catch(reason => fail(reason.message));
    return () => {
      controller.abort();
      clearTimeout(timeout);
      video.removeEventListener('canplay', ready);
      video.removeEventListener('error', playbackError);
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [src, attempt]);

  return <div className="video-player">
    <video ref={videoRef} playsInline {...props} />
    {loading && <p className="video-status" role="status">Loading video…</p>}
    {error && <div className="video-status" role="alert">
      <p>{error}</p>
      <button type="button" onClick={event => { event.stopPropagation(); setAttempt(value => value + 1); }}>Try again</button>
      {originalLink && <a href={originalLink} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}>Open original link</a>}
    </div>}
  </div>;
}
