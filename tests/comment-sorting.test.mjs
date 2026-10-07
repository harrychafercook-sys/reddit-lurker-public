import test from 'node:test';
import assert from 'node:assert/strict';
import { getCommentsUrl, getPostCommentSort, normalizeCommentSort, readCommentCache, hasCachedComments } from '../comment-sorting.js';
import { getSortLabel } from '../sort-labels.js';

const thread = { id: 'match', subreddit: 'soccer' };
const comments = [{ id: 'reply', text: 'Newest comment' }];

test('opening a post lets Reddit apply its own default instead of forcing Best', () => {
    for (const suggestedSort of ['new', 'top', 'best', 'qa', undefined]) {
        const url = new URL(getCommentsUrl({ ...thread, suggestedSort }));
        assert.equal(url.search, '');
        assert.equal(url.pathname, '/r/soccer/comments/match');
    }
});

test('explicit choices use Reddit API values including confidence and qa', () => {
    for (const [choice, value] of [['best', 'confidence'], ['new', 'new'], ['top', 'top'], ['q&a', 'qa'], ['qa', 'qa']]) {
        const params = new URL(getCommentsUrl(thread, choice)).searchParams;
        assert.deepEqual([...params], [['sort', value]]);
    }
});

test('post metadata supplies the displayed sort including contest and Q&A posts', () => {
    assert.equal(getPostCommentSort({ suggested_sort: 'new' }), 'new');
    assert.equal(getPostCommentSort({ suggested_sort: 'confidence' }), 'best');
    assert.equal(getPostCommentSort({ suggestedSort: 'top' }), 'top');
    assert.equal(getPostCommentSort({ suggested_sort: 'qa' }), 'qa');
    assert.equal(getPostCommentSort({ suggested_sort: 'top', contest_mode: true }), 'random');
    assert.equal(getPostCommentSort({ suggested_sort: null }), 'best');
    assert.equal(normalizeCommentSort('unknown'), 'best');
    assert.equal(getSortLabel(getPostCommentSort({ suggested_sort: 'qa' })), 'Q&A');
});

test('default caches retain their actual ordering without replacing explicit sorts', () => {
    const best = [{ id: 'best', text: 'Highest confidence' }];
    const store = new Map([
        ['comment-match-default', { comments, sort: 'new' }],
        ['comment-match-best', best],
    ]);
    const read = key => store.get(key);
    assert.deepEqual(readCommentCache(thread, 'default', read), { comments, sort: 'new' });
    assert.deepEqual(readCommentCache(thread, 'best', read), { comments: best, sort: 'best' });
    assert.equal(readCommentCache(thread, 'top', read), null);
    assert.equal(hasCachedComments(thread, read), true);
});

test('old Best caches remain available offline without overriding the online post default', () => {
    const read = key => key === 'comment-match-best' ? comments : null;
    assert.equal(readCommentCache(thread, 'default', read), null);
    assert.deepEqual(readCommentCache(thread, 'default', read, true), { comments, sort: 'best' });
    assert.equal(hasCachedComments(thread, read), true);
    assert.equal(hasCachedComments(thread, () => null), false);
});

test('cached posts with a suggested sort recover that ordering offline', () => {
    const read = key => key === 'comment-match-new' ? comments : null;
    assert.deepEqual(readCommentCache({ ...thread, suggestedSort: 'new' }, 'default', read, true), { comments, sort: 'new' });
});

test('time ranges have distinct readable labels for the active feed', () => {
    assert.equal(getSortLabel('top-week'), 'Top · This week');
    assert.equal(getSortLabel('top-month'), 'Top · This month');
    assert.equal(getSortLabel('top-year'), 'Top · This year');
    assert.equal(getSortLabel('top-all'), 'Top · All time');
    assert.equal(getSortLabel('top'), 'Top');
});
