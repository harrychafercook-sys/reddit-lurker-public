import test from 'node:test';
import assert from 'node:assert/strict';
import { getReplyPage, REPLY_PAGE_SIZE } from '../comment-replies.js';

const reply = (id, replies = []) => ({ id, text: `Reply ${id}`, replies });
const ids = comments => comments.flatMap(comment => [comment.id, ...ids(comment.replies)]);

test('short threads and exactly one page have no load-more remainder', () => {
    assert.deepEqual(getReplyPage(), { replies: [], remaining: 0 });
    const comments = Array.from({ length: REPLY_PAGE_SIZE }, (_, i) => reply(i));
    assert.deepEqual(getReplyPage(comments), { replies: comments, remaining: 0 });
});

test('wide threads expand in complete pages until every reply is reachable', () => {
    const comments = Array.from({ length: 19 }, (_, i) => reply(i));
    for (const limit of [8, 16, 24]) {
        const page = getReplyPage(comments, limit);
        assert.deepEqual(ids(page.replies), ids(comments).slice(0, limit));
        assert.equal(page.remaining, Math.max(0, 19 - limit));
    }
});

test('a deeply nested chain shares the cutoff instead of expanding every level', () => {
    let comments = [];
    for (let i = 18; i >= 0; i--) comments = [reply(i, comments)];
    const original = structuredClone(comments);
    assert.deepEqual(ids(getReplyPage(comments).replies), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(getReplyPage(comments).remaining, 11);
    assert.equal(ids(getReplyPage(comments, 16).replies).length, 16);
    assert.deepEqual(getReplyPage(comments, 24).replies, comments);
    assert.deepEqual(comments, original, 'paging must not discard replies from cached data');
});

test('mixed siblings and descendants preserve their order across page boundaries', () => {
    const comments = [reply('a', [reply('b', [reply('c')]), reply('d')]), reply('e', [reply('f')])];
    assert.deepEqual(getReplyPage(comments, 2), {
        replies: [reply('a', [reply('b')])], remaining: 4,
    });
    assert.deepEqual(ids(getReplyPage(comments, 5).replies), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(getReplyPage(comments, 8).replies, comments);
});

test('hidden comment branches do not use the budget or inflate the remainder', () => {
    const comments = [
        { ...reply('empty', [reply('hidden-child')]), text: '' },
        { ...reply('quote'), text: ' > ' },
        reply('visible'),
        { id: 'missing' },
    ];
    assert.deepEqual(getReplyPage(comments, 1), { replies: [reply('visible')], remaining: 0 });
});

test('long Markdown and media stay intact at a page boundary', () => {
    const text = 'A long paragraph. '.repeat(1000) + '\n\n![image](https://example.org/image.gif)';
    const comments = [{ id: 'long', text, replies: [reply('next')] }];
    const page = getReplyPage(comments, 1);
    assert.equal(page.replies[0].text, text);
    assert.equal(page.remaining, 1);
});
