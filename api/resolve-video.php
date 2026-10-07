<?php
declare(strict_types=1);

// Resolve public clip metadata only. No arbitrary URLs, cookies, video proxying,
// script execution or persistent media storage.
function clip_endpoint(string $provider, string $id): string {
    $idPattern = $provider === 'redgifs' ? '/\A[a-zA-Z0-9]{1,80}\z/' : '/\A[a-zA-Z0-9]{1,32}\z/';
    if (!preg_match($idPattern, $id)) {
        throw new InvalidArgumentException('Invalid clip ID.');
    }
    $endpoints = [
        'streamff' => 'https://ffedge.streamff.com/share/',
        'streamin' => 'https://streamin.me/v/',
        'streamain' => 'https://streamain.com/embed/',
        'redgifs' => 'https://api.redgifs.com/v2/gifs/',
    ];
    if (!isset($endpoints[$provider])) throw new InvalidArgumentException('Unsupported clip host.');
    return $endpoints[$provider] . ($provider === 'redgifs' ? strtolower($id) : $id);
}

function clip_media_url(string $provider, string $value): ?string {
    $url = html_entity_decode(trim($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $parts = parse_url($url);
    $hosts = [
        'streamff' => ['cdn.hostedhost.top', 'ffedge.streamff.com'],
        'streamin' => ['c-cdn.streamin.top', 'w-cdn.streamin.top'],
        'streamain' => ['cdn.streamain.com'],
        'redgifs' => ['media.redgifs.com'],
    ];
    $host = strtolower($parts['host'] ?? '');
    $allowedHost = in_array($host, $hosts[$provider] ?? [], true) ||
        ($provider === 'redgifs' && preg_match('/\Athumbs[0-9]*\.redgifs\.com\z/', $host));
    if (!$parts || ($parts['scheme'] ?? '') !== 'https' ||
        isset($parts['user']) || isset($parts['pass']) || isset($parts['port']) ||
        !$allowedHost ||
        !preg_match('/\.(mp4|webm|m3u8)\z/i', $parts['path'] ?? '')) return null;
    return $url;
}

function clip_parse(string $provider, string $body): string {
    $candidates = [];
    if ($provider === 'redgifs') {
        $data = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
        // The poster/thumbnail are still images; only select a playable source.
        foreach (['hd', 'sd', 'hls'] as $quality) {
            $value = $data['gif']['urls'][$quality] ?? null;
            if (is_string($value)) $candidates[] = $value;
        }
    } elseif ($provider === 'streamff') {
        $data = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
        $item = $data[0] ?? [];
        if (is_string($item['external_url'] ?? null)) $candidates[] = $item['external_url'];
        if (is_string($item['path'] ?? null) && preg_match('/\A[a-zA-Z0-9_-]{1,100}\z/', $item['path'])) {
            $candidates[] = 'https://ffedge.streamff.com/uploads/' . $item['path'] . '.mp4';
        }
    } else {
        // Read inert HTML attributes, never scripts or unrelated recommended clips.
        $document = new DOMDocument();
        $previous = libxml_use_internal_errors(true);
        try { $document->loadHTML($body, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING); }
        finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
        $xpath = new DOMXPath($document);
        $query = $provider === 'streamain'
            ? '//*[@data-link]/@data-link'
            : '//meta[@property="og:video:secure_url" or @property="og:video:url" or @property="og:video"]/@content | //video/@src | //video/source/@src';
        foreach ($xpath->query($query) as $attribute) $candidates[] = $attribute->nodeValue;
    }
    foreach ($candidates as $candidate) {
        $url = clip_media_url($provider, $candidate);
        if ($url !== null) return $url;
    }
    throw new RuntimeException('This clip is unavailable or no longer has a supported video source.');
}

function clip_fetch(string $endpoint, array $headers = []): string {
    $host = parse_url($endpoint, PHP_URL_HOST);
    $addresses = gethostbynamel($host) ?: [];
    $address = null;
    foreach ($addresses as $ip) {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            $address = $ip;
            break;
        }
    }
    if ($address === null) throw new RuntimeException('Clip host could not be reached.');
    $body = '';
    $request = curl_init($endpoint);
    curl_setopt_array($request, [
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_RESOLVE => [$host . ':443:' . $address],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => 'RedditLurker/clip-resolver',
        CURLOPT_HTTPHEADER => array_merge(['Accept: application/json, text/html'], $headers),
        CURLOPT_ENCODING => '',
        CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body): int {
            if (strlen($body) + strlen($chunk) > 512 * 1024) return 0;
            $body .= $chunk;
            return strlen($chunk);
        },
    ]);
    try {
        $ok = curl_exec($request);
        $status = curl_getinfo($request, CURLINFO_HTTP_CODE);
        if ($ok === false || $status !== 200) throw new RuntimeException('Clip host could not be reached.');
    } finally { unset($request); }
    return $body;
}

function clip_resolve(string $provider, string $id, ?callable $fetch = null): string {
    $fetch ??= 'clip_fetch';
    $endpoint = clip_endpoint($provider, $id);
    $headers = [];
    if ($provider === 'redgifs') {
        // Anonymous, short-lived API access. Keep the token server-side and
        // scoped to fixed Redgifs API endpoints; never send it to a media CDN.
        $headers = ['Origin: https://www.redgifs.com', 'Referer: https://www.redgifs.com/'];
        $auth = json_decode($fetch('https://api.redgifs.com/v2/auth/temporary', $headers), true, 32, JSON_THROW_ON_ERROR);
        $token = $auth['token'] ?? null;
        if (!is_string($token) || !preg_match('/\A[a-zA-Z0-9._~-]{1,8192}\z/', $token)) {
            throw new RuntimeException('Clip host could not be reached.');
        }
        $headers[] = 'Authorization: Bearer ' . $token;
    }
    return clip_parse($provider, $fetch($endpoint, $headers));
}

if (defined('CLIP_RESOLVER_LIBRARY_ONLY')) return;
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
        http_response_code(405);
        header('Allow: GET');
        echo json_encode(['error' => 'GET required.']);
    } elseif (!$_GET) {
        if (!extension_loaded('curl') || !class_exists('DOMDocument')) throw new RuntimeException('Missing resolver runtime.');
        echo json_encode(['service' => 'reddit-lurker-clips', 'version' => 1]);
    } else {
        $provider = $_GET['provider'] ?? '';
        $id = $_GET['id'] ?? '';
        if (!is_string($provider) || !is_string($id) || count($_GET) !== 2) throw new InvalidArgumentException('Invalid clip request.');
        echo json_encode(['url' => clip_resolve($provider, $id)], JSON_UNESCAPED_SLASHES);
    }
} catch (InvalidArgumentException $error) {
    http_response_code(400);
    echo json_encode(['error' => $error->getMessage()]);
} catch (Throwable $error) {
    http_response_code(502);
    echo json_encode(['error' => 'The clip is unavailable or its host could not be reached.']);
}
