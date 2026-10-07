<?php
declare(strict_types=1);
define('IMAGE_SHARE_LIBRARY_ONLY', true);
require __DIR__ . '/../api/fetch-image.php';

function same($actual, $expected): void {
    if ($actual !== $expected) throw new RuntimeException('Unexpected image result.');
}
function rejects(callable $action): void {
    try { $action(); } catch (Throwable $error) { return; }
    throw new RuntimeException('Expected rejection.');
}

$signed = 'https://preview.redd.it/example.jpg?width=1080&format=pjpg&auto=webp&s=a%2Bb';
same(image_share_url($signed), $signed);
foreach (['https://i.redd.it/example.gif', 'https://external-preview.redd.it/example.png?s=abc', 'https://i.imgur.com/example.jpeg', 'https://media.giphy.com/media/example/giphy.gif', 'https://media3.giphy.com/media/example/giphy.webp', 'https://media.redgifs.com/Example.jpg'] as $url) same(image_share_url($url), $url);
foreach (['http://i.redd.it/example.png', 'https://i.redd.it.evil.test/example.png', 'https://127.0.0.1/example.png', 'https://localhost/example.png', 'https://user@i.redd.it/example.png', 'https://i.redd.it:443/example.png', 'https://i.redd.it/example.html', 'https://i.redd.it/example.png#fragment', 'https://example.com/a.png', "https://i.redd.it/a.png\r\nHost: localhost"] as $url) rejects(fn() => image_share_url($url));
same(image_share_type("\x89PNG\r\n\x1a\nextra"), ['image/png', 'png']);
same(image_share_type("\xff\xd8\xff"), ['image/jpeg', 'jpg']);
same(image_share_type('GIF89aanimated-frames'), ['image/gif', 'gif']);
same(image_share_type('GIF87a'), ['image/gif', 'gif']);
same(image_share_type('RIFF1234WEBP'), ['image/webp', 'webp']);
same(image_share_type('1234ftypavif'), ['image/avif', 'avif']);
foreach (['', '<html>denied</html>', '<svg></svg>', '1234ftypisom', 'almost PNG'] as $bytes) rejects(fn() => image_share_type($bytes));
echo "Image host allowlist, signed URLs and file signatures passed.\n";
