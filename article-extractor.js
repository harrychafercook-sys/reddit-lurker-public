const API_HOST = 'article-extractor2.p.rapidapi.com';

export async function extractArticle(url, key, fetcher = globalThis.fetch) {
  if (!key?.trim()) throw new Error('Enter your RapidAPI key in More → Credentials.');
  let source;
  try { source = new URL(url); } catch { throw new Error('This post does not have a valid article link.'); }
  if (!['http:', 'https:'].includes(source.protocol)) throw new Error('This post does not have a web article link.');
  const endpoint = new URL('https://' + API_HOST + '/article/parse');
  endpoint.searchParams.set('url', source.href);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetcher(endpoint.href, { headers: {
      'x-rapidapi-host': API_HOST, 'x-rapidapi-key': key.trim(),
    }, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('RapidAPI rejected access. Check your key and Article Extractor subscription in More → Credentials.');
      if (response.status === 429) throw new Error('Article Extractor has reached its request limit. Please try again later.');
      throw new Error(data?.message || 'Article extraction failed (HTTP ' + response.status + ').');
    }
    if (Number(data?.error) !== 0 || !data?.data?.content) {
      throw new Error(data?.message && Number(data?.error) !== 0 ? data.message : 'No readable article was found at this link.');
    }
    return data.data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Article extraction timed out. Please try again.');
    throw error;
  } finally { clearTimeout(timeout); }
}
