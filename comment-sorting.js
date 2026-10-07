const sorts = new Set(['best', 'top', 'new', 'controversial', 'old', 'qa', 'random', 'live']);

export function normalizeCommentSort(sort) {
    if (sort === 'confidence') return 'best';
    if (sort === 'q&a') return 'qa';
    return sorts.has(sort) ? sort : 'best';
}

export function getPostCommentSort(post) {
    if (post?.contest_mode) return 'random';
    return normalizeCommentSort(post?.suggested_sort ?? post?.suggestedSort);
}

export function getCommentsUrl(thread, sort = 'default') {
    const url = new URL(`https://oauth.reddit.com/r/${thread.subreddit}/comments/${thread.id}`);
    // Leaving sort out lets Reddit apply the post/community's suggested order.
    if (sort !== 'default') {
        const normalized = normalizeCommentSort(sort);
        url.searchParams.set('sort', normalized === 'best' ? 'confidence' : normalized);
    }
    return url.href;
}

export function readCommentCache(thread, sort, read, allowLegacy = false) {
    if (sort === 'default') {
        const cached = read(`comment-${thread.id}-default`);
        if (cached && Array.isArray(cached.comments)) {
            return { comments: cached.comments, sort: normalizeCommentSort(cached.sort) };
        }
        // Online, discover the real default instead of assuming a legacy Best
        // cache represents it. Offline, keep existing downloads readable.
        if (!allowLegacy) return null;
        sort = getPostCommentSort(thread);
        const suggested = read(`comment-${thread.id}-${sort}`);
        if (Array.isArray(suggested)) return { comments: suggested, sort };
        sort = 'best';
    }
    const comments = read(`comment-${thread.id}-${sort}`);
    return Array.isArray(comments) ? { comments, sort: normalizeCommentSort(sort) } : null;
}

export function hasCachedComments(thread, read) {
    return !!readCommentCache(thread, 'default', read, true);
}
