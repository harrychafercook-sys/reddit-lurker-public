<?php
declare(strict_types=1);

const IMAGE_SHARE_MAX_BYTES = 24 * 1024 * 1024;

function image_share_url(string $value): string {
    if (strlen($value) > 8192 || preg_match('/[\x00-\x20\x7f]/', $value)) throw new InvalidArgumentException('Invalid image URL.');
    $parts = parse_url($value);
    $host = strtolower($parts['host'] ?? '');
    $allowed = in_array($host, ['i.redd.it', 'preview.redd.it', 'external-preview.redd.it', 'i.imgur.com', 'media.giphy.com', 'i.giphy.com', 'media.redgifs.com'], true) ||
        preg_match('/\Amedia[0-9]{1,2}\.giphy\.com\z/', $host) || preg_match('/\Athumbs[0-9]*\.redgifs\.com\z/', $host);
    if (!$parts || ($parts['scheme'] ?? '') !== 'https' || !$allowed || isset($parts['user']) || isset($parts['pass']) || isset($parts['port']) ||
        isset($parts['fragment']) || !preg_match('/\.(?:jpe?g|png|gif|webp|avif)\z/i', $parts['path'] ?? '')) {
        throw new InvalidArgumentException('This image host is not supported for sharing.');
    }
    // Keep signed preview query strings byte-for-byte.
    return $value;
}

function image_share_type(string $bytes): array {
    if (str_starts_with($bytes, "\x89PNG\r\n\x1a\n")) return ['image/png', 'png'];
    if (str_starts_with($bytes, "\xff\xd8\xff")) return ['image/jpeg', 'jpg'];
    if (str_starts_with($bytes, 'GIF87a') || str_starts_with($bytes, 'GIF89a')) return ['image/gif', 'gif'];
    if (substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WEBP') return ['image/webp', 'webp'];
    if (substr($bytes, 4, 4) === 'ftyp' && in_array(substr($bytes, 8, 4), ['avif', 'avis'], true)) return ['image/avif', 'avif'];
    throw new RuntimeException('The image host did not return a supported image.');
}

function image_share_fetch(string $value): string {
    $url = image_share_url($value);
    $host = parse_url($url, PHP_URL_HOST);
    $address = null;
    foreach (gethostbynamel($host) ?: [] as $ip) {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) { $address = $ip; break; }
    }
    if ($address === null) throw new RuntimeException('The image host could not be reached.');
    $body = '';
    $tooLarge = false;
    $request = curl_init($url);
    curl_setopt_array($request, [
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_RESOLVE => [$host . ':443:' . $address],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => 'RedditLurker/image-sharing',
        CURLOPT_HTTPHEADER => ['Accept: image/*'],
        CURLOPT_ENCODING => '',
        CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$tooLarge): int {
            if (preg_match('/\AContent-Length:\s*(\d+)/i', $line, $match) && (int) $match[1] > IMAGE_SHARE_MAX_BYTES) {
                $tooLarge = true;
                return 0;
            }
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body, &$tooLarge): int {
            if (strlen($body) + strlen($chunk) > IMAGE_SHARE_MAX_BYTES) { $tooLarge = true; return 0; }
            $body .= $chunk;
            return strlen($chunk);
        },
    ]);
    try {
        $ok = curl_exec($request);
        $status = (int) curl_getinfo($request, CURLINFO_HTTP_CODE);
        if ($tooLarge) throw new LengthException('This image is too large to share (24 MB maximum).');
        if ($ok === false) throw new RuntimeException('The image host could not be reached. Please try again.');
        if ($status !== 200) throw new RuntimeException('The image host refused the download (HTTP ' . $status . ').');
        image_share_type($body);
        return $body;
    } finally { unset($request); }
}

if (defined('IMAGE_SHARE_LIBRARY_ONLY')) return;
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Cross-Origin-Resource-Policy: same-origin');
try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
        http_response_code(405);
        header('Allow: GET');
        throw new InvalidArgumentException('GET required.');
    }
    if (!$_GET) {
        if (!extension_loaded('curl')) throw new RuntimeException('Missing image download runtime.');
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['service' => 'reddit-lurker-images', 'version' => 1]);
    } else {
        $url = $_GET['url'] ?? null;
        if (!is_string($url) || count($_GET) !== 1) throw new InvalidArgumentException('Invalid image request.');
        $body = image_share_fetch($url);
        [$mime, $extension] = image_share_type($body);
        header('Content-Type: ' . $mime);
        header('Content-Disposition: attachment; filename="reddit-image.' . $extension . '"');
        header('Content-Length: ' . strlen($body));
        echo $body;
    }
} catch (Throwable $error) {
    if (http_response_code() !== 405) http_response_code($error instanceof InvalidArgumentException ? 400 : ($error instanceof LengthException ? 413 : 502));
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $error->getMessage()]);
}
