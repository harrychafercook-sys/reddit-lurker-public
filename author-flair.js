// Keep Reddit's emoji URLs rather than trying to recreate subreddit CSS sprites.
export function getAuthorFlairIcons(comment) {
    if (!Array.isArray(comment?.author_flair_richtext)) return [];
    return comment.author_flair_richtext.flatMap(part => {
        if (part?.e !== 'emoji' || typeof part.u !== 'string') return [];
        let url;
        try { url = new URL(part.u.replaceAll('&amp;', '&')); } catch { return []; }
        if (url.protocol !== 'https:' || !['redditmedia.com', 'redd.it', 'redditstatic.com'].some(host =>
            url.hostname === host || url.hostname.endsWith('.' + host))) return [];
        const label = typeof part.a === 'string' ? part.a.replace(/^:|:$/g, '').replaceAll('_', ' ').trim() : '';
        return [{ url: url.href, label: label || 'User flair' }];
    });
}

export function commentsNeedFlairRefresh(comments) {
    return comments.some(comment => !Array.isArray(comment.flairIcons) || commentsNeedFlairRefresh(comment.replies || []));
}
