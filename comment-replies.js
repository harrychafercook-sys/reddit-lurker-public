export const REPLY_PAGE_SIZE = 8;

// Share one budget across the whole reply tree, including deeply nested chains.
// Stop at complete comments so text, links and media are never clipped.
export function getReplyPage(comments = [], limit = REPLY_PAGE_SIZE) {
    let total = 0;
    const visit = replies => {
        const visible = [];
        for (const comment of replies || []) {
            // Match the Comment component, which also hides these branches.
            if (!comment.text || comment.text.trim() === '>') continue;
            const include = total < limit;
            total += 1;
            const children = visit(comment.replies);
            if (include) visible.push({ ...comment, replies: children });
        }
        return visible;
    };
    const replies = visit(comments);
    return { replies, remaining: Math.max(0, total - limit) };
}
