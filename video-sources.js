const clipHosts = {
  'streamff.com': 'streamff', 'streamff.pro': 'streamff',
  'streamin.me': 'streamin', 'streamin.link': 'streamin',
  'streama.in': 'streamain', 'streamain.com': 'streamain',
  'redgifs.com': 'redgifs',
};

function mediaUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    return url;
  } catch { return null; }
}

export function getVideoLink(value) {
  const url = mediaUrl(value);
  if (!url) return null;
  const extension = url.pathname.match(/\.(mp4|webm|m3u8)$/i)?.[1].toLowerCase();
  if (extension) return { type: 'video', url: url.href, format: extension === 'm3u8' ? 'hls' : extension };
  const provider = clipHosts[url.hostname.replace(/^www\./, '')];
  if (!provider) return null;
  const match = provider === 'redgifs'
    ? url.pathname.match(/^\/(?:watch|ifr)\/([a-zA-Z0-9]{1,80})\/?$/)
    : provider === 'streamain'
    ? url.pathname.match(/^\/(?:[a-z]{2}\/)?([a-zA-Z0-9]{1,32})\/watch\/?$/) || url.pathname.match(/^\/embed\/([a-zA-Z0-9]{1,32})\/?$/)
    : url.pathname.match(/^\/v\/([a-zA-Z0-9]{1,32})\/?$/);
  if (!match) return null;
  return { type: 'video', url: url.href, sourceUrl: url.href, provider, clipId: provider === 'redgifs' ? match[1].toLowerCase() : match[1] };
}

// Also recognize links in posts saved before clip playback was added.
export function getThreadContent(thread) {
  const video = getVideoLink(thread.url);
  return video ? [video] : thread.content || [];
}

export async function resolveVideo(value, { signal, fetcher = globalThis.fetch } = {}) {
  const video = getVideoLink(value);
  if (!video) throw new Error('This link cannot be played here.');
  signal?.throwIfAborted();
  if (!video.provider) return video;
  const query = new URLSearchParams({ provider: video.provider, id: video.clipId });
  const response = await fetcher('./api/resolve-video.php?' + query, {
    signal, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('The clip is unavailable or its host could not be reached.');
  let data;
  try { data = await response.json(); } catch { throw new Error('This clip could not be loaded. Try opening the original link.'); }
  const resolved = typeof data?.url === 'string' ? getVideoLink(data.url) : null;
  if (!resolved?.format || !data.url.startsWith('https://')) throw new Error('The host did not provide a playable video.');
  return { ...resolved, sourceUrl: video.sourceUrl };
}
