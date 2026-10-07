import { getVideoLink } from './video-sources.js';

export function getPostContent(post, decode = value => value.replaceAll('&amp;', '&')) {
  const destination = post.url_overridden_by_dest || post.url;
  const linkedVideo = destination && getVideoLink(decode(destination));
  if (!post.is_video && linkedVideo) return [linkedVideo];
  if (post.is_video) {
    const url = post.media?.reddit_video?.hls_url || post.secure_media?.reddit_video?.hls_url;
    return url ? [{ url: decode(url), type: 'video' }] : [];
  }
  if (post.is_gallery && post.media_metadata) {
    return Object.values(post.media_metadata).map(media => media.s?.gif || media.s?.u)
      .filter(Boolean).map(url => ({ url: decode(url), type: 'image' }));
  }
  // A Reddit preview may have a .gif path but format=png8, which is a still.
  // Prefer the original GIF or its animated variant for the full-size content.
  const directGif = /\.gif(?:[?#]|$)/i.test(destination || '') ? destination : null;
  const preview = post.preview?.images?.[0];
  const imageUrl = directGif || preview?.variants?.gif?.source?.url || preview?.source?.url ||
    (/\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(destination || '') ? destination : null);
  return imageUrl ? [{ url: decode(imageUrl), type: 'image' }] : [];
}
