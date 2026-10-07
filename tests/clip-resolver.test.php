<?php
declare(strict_types=1);
define('CLIP_RESOLVER_LIBRARY_ONLY', true);
require __DIR__ . '/../api/resolve-video.php';

function same($actual, $expected): void {
    if ($actual !== $expected) throw new RuntimeException('Expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
}
function rejects(callable $action): void {
    try { $action(); } catch (Throwable $error) { return; }
    throw new RuntimeException('Expected rejection.');
}

same(clip_endpoint('streamff', '0c9ead67'), 'https://ffedge.streamff.com/share/0c9ead67');
same(clip_endpoint('streamin', 'd5e74811'), 'https://streamin.me/v/d5e74811');
same(clip_endpoint('streamain', 'DuovQjIdZgY7cmN'), 'https://streamain.com/embed/DuovQjIdZgY7cmN');
same(clip_endpoint('redgifs', 'ExampleClip'), 'https://api.redgifs.com/v2/gifs/exampleclip');
same(clip_endpoint('redgifs', str_repeat('a', 50)), 'https://api.redgifs.com/v2/gifs/' . str_repeat('a', 50));
rejects(fn() => clip_endpoint('redgifs', str_repeat('a', 81)));
foreach (['../private', 'a?url=http://localhost', '', str_repeat('x', 33), "abc\n"] as $id) rejects(fn() => clip_endpoint('streamff', $id));
rejects(fn() => clip_endpoint('http://localhost', 'abc'));

// Minimal fixtures from the actual r/soccer clip hosts; unrelated previews must
// never be mistaken for the requested match clip.
same(clip_parse('streamff', '[{"path":"0c9ead67","external_url":"https://cdn.hostedhost.top/0c9ead67.mp4"}]'), 'https://cdn.hostedhost.top/0c9ead67.mp4');
same(clip_parse('streamff', '[{"path":"example","external_url":null}]'), 'https://ffedge.streamff.com/uploads/example.mp4');
same(clip_parse('streamin', '<meta content="https://c-cdn.streamin.top/uploads/d5e74811.mp4?one=1&amp;two=2" property="og:video">'), 'https://c-cdn.streamin.top/uploads/d5e74811.mp4?one=1&two=2');
same(clip_parse('streamin', '<video><source src="https://w-cdn.streamin.top/uploads/example.mp4"></video>'), 'https://w-cdn.streamin.top/uploads/example.mp4');
same(clip_parse('streamain', '<div data-preview-src="https://cdn.streamain.com/wrong.mp4"></div><div data-link="https://cdn.streamain.com/guests/hDX5f3Rq3pbf9Va_1789512563.mp4"></div>'), 'https://cdn.streamain.com/guests/hDX5f3Rq3pbf9Va_1789512563.mp4');
foreach (['http://cdn.hostedhost.top/a.mp4', 'https://127.0.0.1/a.mp4', 'https://cdn.hostedhost.top.evil.test/a.mp4', 'https://cdn.hostedhost.top:444/a.mp4', 'https://user@cdn.hostedhost.top/a.mp4', 'javascript:alert(1)', 'https://cdn.hostedhost.top/a.html'] as $url) same(clip_media_url('streamff', $url), null);
rejects(fn() => clip_parse('streamff', '[]'));
rejects(fn() => clip_parse('streamff', 'not json'));
rejects(fn() => clip_parse('streamin', '<meta property="og:video" content="https://streamin.me/v/example">'));
rejects(fn() => clip_parse('streamain', '<div data-preview-src="https://cdn.streamain.com/wrong.mp4"></div>'));

// Redgifs returns both video URLs and still poster/thumbnail URLs.
$redgifs = '{"gif":{"urls":{"hd":"https://media.redgifs.com/ExampleClip.mp4","sd":"https://thumbs2.redgifs.com/ExampleClip-mobile.mp4","poster":"https://media.redgifs.com/ExampleClip-poster.jpg"}}}';
same(clip_parse('redgifs', $redgifs), 'https://media.redgifs.com/ExampleClip.mp4');
same(clip_parse('redgifs', '{"gif":{"urls":{"sd":"https://thumbs44.redgifs.com/ExampleClip-mobile.mp4"}}}'), 'https://thumbs44.redgifs.com/ExampleClip-mobile.mp4');
rejects(fn() => clip_parse('redgifs', '{"gif":{"urls":{"poster":"https://media.redgifs.com/ExampleClip-poster.jpg"}}}'));
foreach (['https://media.redgifs.com.evil.test/a.mp4', 'https://evil.redgifs.com/a.mp4', 'https://redgifs.com/a.mp4', 'http://media.redgifs.com/a.mp4', 'https://media.redgifs.com:443/a.mp4', 'https://user@media.redgifs.com/a.mp4'] as $url) same(clip_media_url('redgifs', $url), null);
$calls = [];
same(clip_resolve('redgifs', 'ExampleClip', function ($endpoint, $headers) use (&$calls, $redgifs) {
    $calls[] = [$endpoint, $headers];
    return count($calls) === 1 ? '{"token":"test.anonymous.token"}' : $redgifs;
}), 'https://media.redgifs.com/ExampleClip.mp4');
same($calls[0][0], 'https://api.redgifs.com/v2/auth/temporary');
same($calls[0][1], ['Origin: https://www.redgifs.com', 'Referer: https://www.redgifs.com/']);
same($calls[1][0], 'https://api.redgifs.com/v2/gifs/exampleclip');
same($calls[1][1][2], 'Authorization: Bearer test.anonymous.token');
foreach (['{}', '{"token":null}', '{"token":"bad\\r\\nInjected: true"}'] as $auth) {
    rejects(fn() => clip_resolve('redgifs', 'example', fn() => $auth));
}
same(clip_resolve('streamff', 'abc', function ($endpoint, $headers) {
    same($endpoint, 'https://ffedge.streamff.com/share/abc');
    same($headers, []);
    return '[{"path":"abc"}]';
}), 'https://ffedge.streamff.com/uploads/abc.mp4');
echo "Clip resolver checks passed.\n";
