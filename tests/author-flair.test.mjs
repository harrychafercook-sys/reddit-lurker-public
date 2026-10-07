import test from 'node:test';
import assert from 'node:assert/strict';
import { getAuthorFlairIcons, commentsNeedFlairRefresh } from '../author-flair.js';

const crest = { e: 'emoji', a: ':Newells_Old_Boys:', u: 'https://emoji.redditmedia.com/iqzosieqp63h1_t5_2qi58/Newells_Old_Boys' };

test('club flairs retain Reddit image URLs and readable club names in order', () => {
    assert.deepEqual(getAuthorFlairIcons({ author_flair_richtext: [crest, { e: 'text', t: ' | ' }, { ...crest, a: ':Second_Club:', u: crest.u + '?x=1&amp;y=2' }] }), [
        { url: crest.u, label: 'Newells Old Boys' },
        { url: crest.u + '?x=1&y=2', label: 'Second Club' },
    ]);
});

test('absent, text-only and invalid flair images leave no broken icons', () => {
    for (const author_flair_richtext of [undefined, null, '', [], [{ e: 'text', t: 'Supporter' }], [null, { e: 'emoji' }]]) {
        assert.deepEqual(getAuthorFlairIcons({ author_flair_richtext }), []);
    }
    for (const u of ['javascript:alert(1)', 'http://emoji.redditmedia.com/icon', 'https://redditmedia.com.attacker.test/icon', 'https://example.org/icon', 'not a URL']) {
        assert.deepEqual(getAuthorFlairIcons({ author_flair_richtext: [{ ...crest, u }] }), []);
    }
});

test('only old comment caches need a flair refresh, including nested replies', () => {
    assert.equal(commentsNeedFlairRefresh([]), false);
    assert.equal(commentsNeedFlairRefresh([{ flairIcons: [], replies: [{ flairIcons: getAuthorFlairIcons({ author_flair_richtext: [crest] }) }] }]), false);
    assert.equal(commentsNeedFlairRefresh([{ flairIcons: [], replies: [{ author: 'old-cached-reader' }] }]), true);
});
