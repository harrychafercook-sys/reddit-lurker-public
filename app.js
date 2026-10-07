import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import DOMPurify from 'dompurify';
import { parseMarkdown } from './markdown.js';
import VideoPlayer from './video-player.js';
import { getVideoLink, getThreadContent } from './video-sources.js';
import { getPostContent } from './post-content.js';
import { getReplyPage, REPLY_PAGE_SIZE } from './comment-replies.js';
import { getAuthorFlairIcons, commentsNeedFlairRefresh } from './author-flair.js';
import { getNavScrollChange } from './nav-scroll.js';
import { observeHeaderHeight, getHeaderClearance, getHeaderScrollTop } from './header-layout.js';
import { getCommentAnchor, preserveCommentPosition } from './comment-scroll.js';
import ReplyExpansion from './reply-expansion.js';
import { getSortLabel, TOP_RANGE_LABELS } from './sort-labels.js';
import { getCommentsUrl, getPostCommentSort, normalizeCommentSort, readCommentCache, hasCachedComments } from './comment-sorting.js';
import { POST_CACHE_NAME, POST_CACHE_POLICY } from './cache-config.js';
import { appStorage as localStorage } from './storage.js';
import { version as APP_VERSION } from './package.json';

import { createDataCache } from './data-cache.js';
import { putBoundedCache, pruneBoundedCache } from './bounded-cache.js';
import { maintainCaches } from './cache-maintenance.js';
import { readZoom, applyZoom, normalizeZoom, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from './zoom.js';
import ZoomableImage from './zoomable-image.js';
import { extractArticle } from './article-extractor.js';
import MediaActions from './media-actions.js';
import { checkAndroidUpdates } from './native-media.js';

const dataCache = createDataCache(localStorage);
dataCache.prune();
applyZoom(readZoom(localStorage), localStorage);
maintainCaches().catch(() => {});
window.addEventListener('online', () => { dataCache.prune(); maintainCaches().catch(() => {}); });

// --- HELPER FUNCTIONS ---
const getCachedData = dataCache.get;
const setCachedData = dataCache.set;
function formatTimeAgo(utcSeconds) { const n = new Date(), p = new Date(utcSeconds * 1000), d = Math.floor((n - p) / 1000), i = { y: 31536000, mo: 2592000, d: 86400, h: 3600, m: 60, s: 1 }; for (let k in i) { const c = Math.floor(d / i[k]); if (c > 0) return `${c}${k} ago`; } return 'just now'; }
const decodeUrl = (url) => { const txt = document.createElement("textarea"); txt.innerHTML = url; return txt.value; };
const processData = listing => listing.data.children.map(({ data }) => {
    const content = getPostContent(data, decodeUrl);
    const thumbnail = data.thumbnail?.startsWith('http') ? data.thumbnail :
        data.preview?.images?.[0]?.source?.url || (content[0]?.type === 'image' ? content[0].url : null);
    return {
        id: data.id, subreddit: data.subreddit, author: data.author, title: data.title,
        upvotes: data.score, commentsCount: data.num_comments, content,
        thumbnail: thumbnail ? decodeUrl(thumbnail) : null,
        selfText: data.selftext, url: data.url_overridden_by_dest || data.url,
        isSelf: data.is_self, stickied: data.stickied, domain: data.domain,
        created: data.created_utc, isVideo: content.some(item => item.type === 'video'),
        suggestedSort: getPostCommentSort(data),
    };
});

async function fetchAndProcessThreads(token, subreddit, after, sort = 'hot') {
    const limit = 100;
    let apiUrl = `https://oauth.reddit.com/r/${subreddit}/${sort}?limit=${limit}`;
    if (sort.startsWith('top-')) {
        const time = sort.split('-')[1];
        apiUrl = `https://oauth.reddit.com/r/${subreddit}/top?limit=${limit}&t=${time}`;
    }
    apiUrl += (after ? `&after=${after}` : '');
    const postsResponse = await fetch(apiUrl, { headers: { 'Authorization': `bearer ${token}` } });
    if (!postsResponse.ok) {
        if (postsResponse.status === 404) {
            throw new Error(`Subreddit "r/${subreddit}" not found or it is a private community.`);
        }
        throw new Error('Failed to fetch posts. Status: ' + postsResponse.status);
    }
    const postsData = await postsResponse.json();
    const fetchedPosts = processData(postsData);

    return { posts: fetchedPosts, after: postsData.data.after };
}

// --- UI COMPONENTS ---
function ZoomSettings() {
    const [level, setLevel] = useState(() => normalizeZoom(document.documentElement.dataset.zoomLevel));
    const [saved, setSaved] = useState(true);
    const change = value => {
        const next = normalizeZoom(value);
        setLevel(next);
        setSaved(applyZoom(next, localStorage));
    };
    return (
        <section className="zoom-settings" aria-label="Zoom settings">
            <div className="zoom-heading"><span>Zoom</span><output aria-live="polite">{level}%</output></div>
            <div className="zoom-controls">
                <button type="button" aria-label="Zoom out" disabled={level <= MIN_ZOOM} onClick={() => change(level - ZOOM_STEP)}>−</button>
                <input type="range" aria-label="Zoom level" aria-valuetext={`${level}%`} min={MIN_ZOOM} max={MAX_ZOOM} step={ZOOM_STEP} value={level} onChange={event => change(event.target.value)} />
                <button type="button" aria-label="Zoom in" disabled={level >= MAX_ZOOM} onClick={() => change(level + ZOOM_STEP)}>+</button>
            </div>
            <div className="zoom-description"><span>Text, buttons and spacing</span><button type="button" onClick={() => change(100)} disabled={level === 100}>Reset to 100%</button></div>
            {!saved && <p role="status">Zoom changed for this session. Storage is full, so it could not be saved.</p>}
        </section>
    );
}

function CredentialsModal({ onSave, onClose, initialClientId = '', initialSecret = '', initialRapidApiKey = '' }) {
    const [clientId, setClientId] = useState(initialClientId);
    const [secret, setSecret] = useState(initialSecret);
    const [rapidApiKey, setRapidApiKey] = useState(initialRapidApiKey);

    const handleSave = () => {
        if (clientId.trim() && secret.trim()) {
            onSave(clientId.trim(), secret.trim(), rapidApiKey.trim());
        }
    };

    return (
        <div className="modal-overlay fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center animate-fade-in" onClick={onClose}>
            <div className="bg-slate-800 text-white rounded-lg shadow-xl p-6 w-full max-w-sm m-4 animate-scale-in" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-2xl font-bold mb-4">API Credentials</h2>
                <details className="mb-4"><summary className="cursor-pointer text-blue-300">Display zoom</summary><ZoomSettings /></details>
                <p className="text-gray-400 mb-6">Enter your Reddit app's Client ID and Secret. A RapidAPI key is optional and enables Txtify. These will be stored in your browser's local storage.</p>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="clientId" className="block text-sm font-medium text-gray-300">Reddit Client ID</label>
                        <input type="text" id="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500" />
                    </div>
                    <div>
                        <label htmlFor="secret" className="block text-sm font-medium text-gray-300">Reddit Client Secret</label>
                        <input type="password" id="secret" value={secret} onChange={(e) => setSecret(e.target.value)} className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500" />
                    </div>
                    <div>
                        <label htmlFor="rapidApiKey" className="block text-sm font-medium text-gray-300">RapidAPI Key (optional)</label>
                        <input type="password" id="rapidApiKey" value={rapidApiKey} onChange={(e) => setRapidApiKey(e.target.value)} className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500" />
                    </div>
                </div>
                <div className="mt-8 flex justify-end space-x-4">
                    <button onClick={onClose} className="bg-slate-600 hover:bg-slate-500 text-white font-bold py-2 px-4 rounded-md transition-colors">Cancel</button>
                    <button onClick={handleSave} disabled={!clientId.trim() || !secret.trim()} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded-md transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed">Save</button>
                </div>
            </div>
        </div>
    );
}
function SideMenu({ isOpen, onClose, favorites, onReorderFavorites, onFavoriteSelect, onRemoveFavorite, onSelectCachedFeed }) {
    const [isDragging, setIsDragging] = useState(false);
    const handleDragEnd = (result) => {
        setIsDragging(false);
        if (!result.destination) return;
        onReorderFavorites(result.source.index, result.destination.index);
    };
    const handleDragStart = () => {
        setIsDragging(true);
    };
    return (
        <div className={`fixed inset-0 z-40 ${!isOpen && 'pointer-events-none'}`}>
            <div className={`absolute inset-0 bg-black transition-opacity duration-300 ${isOpen ? 'opacity-60' : 'opacity-0'}`} onClick={onClose}></div>
            <div className={`side-menu absolute top-0 left-0 h-full w-64 bg-slate-800 text-white shadow-lg transform rounded-r-2xl ${isOpen ? 'translate-x-0' : '-translate-x-full'} flex flex-col`}>
                <div className="side-menu-header bg-slate-700 border-b border-slate-600">
                    <h2 className="text-xl font-bold p-4">Favorites</h2>
                    <div className="border-t border-slate-600"></div>
                    <button onClick={() => onFavoriteSelect('popular')} className="w-full text-left p-4 hover:bg-slate-600">Home</button>
                </div>
                <div className="flex-grow overflow-y-auto">
                    <DragDropContext onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
                    <Droppable droppableId="favorites-list">
                        {(provided) => (
                            <ul {...provided.droppableProps} ref={provided.innerRef}>
                                {favorites.map((fav, index) => (
                                    <Draggable key={fav} draggableId={fav} index={index}>
                                        {(provided, snapshot) => (
                                            <li
                                                ref={provided.innerRef}
                                                {...provided.draggableProps}
                                                {...provided.dragHandleProps}
                                                className={`flex items-center justify-between p-4 border-b border-slate-700 hover:bg-slate-700 cursor-pointer ${snapshot.isDragging ? 'shadow-lg scale-105 bg-slate-700' : ''}`}
                                                onClick={() => onFavoriteSelect(fav)}
                                            >
                                                <span>r/{fav}</span>
                                                <button onClick={(e) => { e.stopPropagation(); onRemoveFavorite(fav); }} className="text-red-500 hover:text-red-400 ml-4 text-xl font-bold">&times;</button>
                                            </li>
                                        )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                            </ul>
                        )}
                    </Droppable>
                </DragDropContext>
                </div>
                <div className="side-menu-footer border-t border-slate-700 flex justify-between items-center p-4">
                    <p className="text-xs text-gray-400">v{APP_VERSION}</p>
                    <button onClick={onSelectCachedFeed} className="text-xs text-blue-400 hover:underline">Cached Feed</button>
                </div>
            </div>
        </div>
    );
}
function MarkdownRenderer({ content, inline = false, onContentClick, embedImages = true }) {
    const processedContent = content || '';
    const handleLinkClick = event => {
        // Reading or swiping a table should not collapse its enclosing comment.
        if (event.target.closest('.markdown-table-scroll')) event.stopPropagation();
        const link = event.target.closest('a[href]');
        if (!onContentClick || !link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const video = getVideoLink(link.href);
        if (!video) return;
        event.preventDefault();
        event.stopPropagation();
        onContentClick([video], 0);
    };
    const sanitizeConfig = {
        ADD_TAGS: ['iframe'],
        ADD_ATTR: ['src', 'title', 'class', 'frameborder', 'allowfullscreen'], // Allow necessary iframe attributes
        ADD_CLASSES: { img: 'embedded-image' }
    };

    if (inline) {
        const rawMarkup = DOMPurify.sanitize(parseMarkdown(processedContent, { inline, embedImages }), sanitizeConfig);
        return <span onClick={handleLinkClick} dangerouslySetInnerHTML={{ __html: rawMarkup }} />;
    }

    const rawMarkup = DOMPurify.sanitize(parseMarkdown(processedContent, { embedImages }), sanitizeConfig);
    return <div className="prose" onClick={handleLinkClick} dangerouslySetInnerHTML={{ __html: rawMarkup }} />;
}
function SortIcon({ sortType }) {
    const paths = {
        best: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
        hot: 'M12 3c1 4-1 6-4 8-2 1-3 3-3 5a7 7 0 0 0 14 0c0-5-3-9-7-13ZM12 12c0 2-3 3-3 5a3 3 0 0 0 6 0c0-2-1-3-3-5Z',
        new: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
        rising: 'm3 17 6-6 4 4 8-10M15 5h6v6',
        top: 'M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 2v5m-4 3h8m-6-3h4v3',
        controversial: 'M8 20V4M4 8l4-4 4 4m4-4v16m-4-4 4 4 4-4',
        old: 'M3 5v5h5M3.8 10a8.5 8.5 0 1 1 .7 7M12 7v5l3 2',
        qa: 'M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0ZM9.5 8a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 1.5-2.5 3M12 15h.01',
        random: 'M3 6h3c5 0 7 12 12 12h3m-3-3 3 3-3 3M3 18h3c2 0 4-3 6-6s4-6 6-6h3m-3-3 3 3-3 3',
        live: 'M12 8v8m-4-6v4m8-4v4M4 8a7 7 0 0 0 0 8m16-8a7 7 0 0 1 0 8',
    };
    return <svg className="sort-icon" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d={paths[sortType.split('-')[0]] || paths.new} /></svg>;
}

function useHeaderLayout(isActive) {
    const ref = useRef(null);
    useLayoutEffect(() => {
        if (isActive && ref.current) return observeHeaderHeight(ref.current);
    }, [isActive]);
    return ref;
}

function MainHeader({ onMenuToggle, isVisible, isActive, currentSubreddit, isFavorite, onToggleFavorite, sortType }) {
    const headerRef = useHeaderLayout(isActive);
    const c = `app-header fixed top-0 left-0 right-0 z-30 transition-transform duration-300 ease-in-out ${!isVisible ? '-translate-y-full' : 'translate-y-0'}`;
    return (
        <header ref={headerRef} data-active={isActive} className={`${c} bg-slate-800`}>
            <div className="max-w-2xl mx-auto p-3 flex items-center justify-between text-white">
                <button onClick={onMenuToggle} className="text-white text-2xl hover:text-gray-400"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg></button>
                <div className="text-center">
                    <h1 className="text-xl font-bold">r/{currentSubreddit}</h1>
                    <p className="sort-summary text-xs text-gray-400 flex items-center justify-center" aria-label={`Current sort: ${getSortLabel(sortType)}`}><SortIcon sortType={sortType} /> {getSortLabel(sortType)}</p>
                </div>
                <button onClick={onToggleFavorite} className="text-white text-2xl hover:text-gray-300">
                    <svg className={`w-6 h-6 ${isFavorite ? 'text-white' : 'text-gray-500'}`} fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"></path></svg>
                </button>
            </div>
        </header>
    );
}

function DetailHeader({ onBackPress, isVisible, isActive, currentSubreddit, isFavorite, onToggleFavorite, commentSort }) {
    const headerRef = useHeaderLayout(isActive);
    const c = `app-header fixed top-0 left-0 right-0 z-30 transition-transform duration-300 ease-in-out ${!isVisible ? '-translate-y-full' : 'translate-y-0'}`;
    return (
        <header ref={headerRef} data-active={isActive} className={`${c} bg-slate-800`}>
            <div className="max-w-2xl mx-auto p-3 flex items-center justify-between text-white">
                <button onClick={onBackPress} className="text-white text-3xl font-light hover:text-gray-400">&larr;</button>
                <div className="text-center">
                    <h1 className="text-xl font-bold">r/{currentSubreddit}</h1>
                    {commentSort && <p className="sort-summary text-xs text-gray-400 flex items-center justify-center" aria-label={`Current sort: ${getSortLabel(commentSort)}`}><SortIcon sortType={commentSort} /> {getSortLabel(commentSort)}</p>}
                </div>
                <button onClick={onToggleFavorite} className="text-white text-2xl hover:text-gray-300">
                    <svg className={`w-6 h-6 ${isFavorite ? 'text-white' : 'text-gray-500'}`} fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"></path></svg>
                </button>
            </div>
        </header>
    );
}
function BottomNav({ isVisible, view, onCacheHighlighted, highlightedCount, isCaching, ...props }) {
    const i = "flex flex-col items-center justify-center text-gray-400 hover:text-white transition-colors", s = "w-6 h-6 mb-1", c = `app-footer fixed bottom-0 left-0 right-0 z-10 transition-transform duration-300 ease-in-out ${!isVisible ? 'translate-y-full' : 'translate-y-0'}`;
    return (<footer className={c}><div className="max-w-2xl mx-auto flex justify-around items-center h-16 bg-slate-800 border-t border-slate-700">{view === 'list' ? (<React.Fragment><button onClick={props.onOpenSortModal} className={i}><svg className={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 4h18M3 8h18M3 12h18M3 16h18M3 20h18" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg><span className="text-xs">Sort</span></button><button onClick={props.onRefreshFeed} className={i}><svg className={s} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h5M20 20v-5h-5"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 9a9 9 0 0115-2.83"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 15a9 9 0 01-15 2.83"></path></svg><span className="text-xs">Refresh</span></button><button onClick={onCacheHighlighted} disabled={highlightedCount === 0 || isCaching} className="bg-blue-600 rounded-2xl w-16 h-10 flex items-center justify-center text-white hover:bg-blue-500 disabled:bg-gray-500 disabled:cursor-not-allowed" title="Cache Selected">{isCaching ? <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div> : <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"></path></svg>}</button><button onClick={props.onOpenSubredditModal} className={i}><svg className={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2L2 7V21H22V7L12 2Z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M7 21V11L12 7L17 11V21" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg><span className="text-xs">Subs</span></button><button onClick={props.onOpenMoreModal} className={i}><svg className={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg><span className="text-xs">More</span></button></React.Fragment>) : (<React.Fragment><button onClick={props.onOpenSortModal} className={i}><svg className={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 4h18M3 8h18M3 12h18M3 16h18M3 20h18" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg><span className="text-xs">Sort</span></button><button onClick={props.onRefreshComments} className={i}><svg className={s} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h5M20 20v-5h-5"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 9a9 9 0 0115-2.83"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 15a9 9 0 01-15 2.83"></path></svg><span className="text-xs">Refresh</span></button><button onClick={props.onToggleComments} className="bg-blue-600 rounded-2xl w-16 h-10 flex items-center justify-center text-white hover:bg-blue-500"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V5H7v4m10 5v4H7v-4m3-7h4m-4 5h4m-4 5h4M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"></path></svg></button><button onClick={props.onScrollToParent('down')} className={i}><svg className={s} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg><span className="text-xs">Down</span></button><button onClick={props.onScrollToParent('up')} className={i}><svg className={s} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"></path></svg><span className="text-xs">Up</span></button></React.Fragment>)}</div></footer>);
}

function SortModal({ isOpen, onClose, onSelectSort, selectedSort, isCommentSort = false, isDefaultSort = false }) {
    if (!isOpen) return null;

    const sortOptions = isCommentSort ? ['best', 'top', 'new', 'controversial', 'old', 'qa'] : ['best', 'hot', 'new', 'rising'];
    const topOptions = Object.keys(TOP_RANGE_LABELS);
    const selectedMark = <svg className="sort-selected-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>;

    return (
        <div className="modal-overlay fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center animate-fade-in" onClick={onClose}>
            <div className="bg-slate-800 text-white rounded-lg shadow-xl p-6 w-full max-w-sm m-4 animate-scale-in" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-2xl font-bold">Sort By</h2>
                <p className="sort-current">Current: {getSortLabel(selectedSort)}{isDefaultSort ? ' · Post default' : ''}</p>
                <div className="grid grid-cols-2 gap-2">
                    {sortOptions.map(option => (
                        <button type="button" key={option} onClick={() => onSelectSort(option)} className="sort-option" aria-pressed={selectedSort === option}>
                            <SortIcon sortType={option} /><span>{getSortLabel(option)}</span>{selectedSort === option && selectedMark}
                        </button>
                    ))}
                </div>
                {!isCommentSort && (
                    <React.Fragment>
                        <h3 className="sort-summary text-lg font-bold mt-4 mb-2"><SortIcon sortType="top" />Top</h3>
                        <div className="grid grid-cols-2 gap-2">
                            {topOptions.map(option => (
                                <button type="button" key={option} onClick={() => onSelectSort(`top-${option}`)} className={`sort-option ${option === 'all' ? 'col-span-2' : ''}`} aria-pressed={selectedSort === `top-${option}`}>
                                    <span>{TOP_RANGE_LABELS[option]}</span>{selectedSort === `top-${option}` && selectedMark}
                                </button>
                            ))}
                        </div>
                    </React.Fragment>
                )}
            </div>
        </div>
    );
}

function ClearCacheModal({ isOpen, onClose, onConfirm }) {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center animate-fade-in" onClick={onClose}>
            <div className="bg-slate-800 text-white rounded-lg shadow-xl p-6 w-full max-w-sm m-4 animate-scale-in" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-2xl font-bold mb-4">Clear Cache</h2>
                <p className="text-gray-400 mb-6">Remove saved feeds, comments, articles and images? Your credentials and favourites stay. Old cached items are also removed automatically.</p>
                <div className="flex justify-end space-x-4">
                    <button onClick={onClose} className="bg-slate-600 hover:bg-slate-500 text-white font-bold py-2 px-4 rounded-md transition-colors">Cancel</button>
                    <button onClick={onConfirm} className="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-md transition-colors">Clear</button>
                </div>
            </div>
        </div>
    );
}

function MoreOptionsMenu({ isOpen, onClose, onClearCache, onCredentials }) {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center animate-fade-in" onClick={onClose}>
            <div className="bg-slate-800 text-white rounded-lg shadow-xl p-2 w-full max-w-xs m-4 animate-scale-in" onClick={(e) => e.stopPropagation()}>
                <ZoomSettings />
                <ul className="space-y-1">
                    {window.__REDDIT_LURKER_NATIVE__ && <li>
                        <button onClick={() => {
                            onClose();
                            checkAndroidUpdates().catch(() => window.alert('The Android update check is unavailable. Close and reopen the app, then try again.'));
                        }} className="w-full text-left px-4 py-2 rounded-md hover:bg-slate-700 transition-colors">Check for updates</button>
                    </li>}
                    <li>
                        <button onClick={onClearCache} className="w-full text-left px-4 py-2 rounded-md hover:bg-slate-700 transition-colors">Clear Cache</button>
                    </li>
                    <li>
                        <button onClick={onCredentials} className="w-full text-left px-4 py-2 rounded-md hover:bg-slate-700 transition-colors">Credentials</button>
                    </li>
                </ul>
                <p className="border-t border-slate-700 mx-4 mt-2 pt-3 pb-2 text-sm text-gray-400">Version {APP_VERSION}</p>
            </div>
        </div>
    );
}

function SubredditModal({ isOpen, onClose, onSelectSubreddit }) {
    const [inputValue, setInputValue] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (inputValue.trim()) {
            onSelectSubreddit(inputValue.trim());
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center animate-fade-in" onClick={onClose}>
            <div className="bg-slate-800 text-white rounded-lg shadow-xl p-6 w-full max-w-sm m-4 animate-scale-in" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-2xl font-bold mb-4">Find a Subreddit</h2>
                <form onSubmit={handleSubmit} className="flex space-x-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value.replace(/\s/g, ''))}
                        placeholder="e.g., reactjs"
                        className="flex-grow bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                    <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded-md transition-colors">
                        Go
                    </button>
                </form>
            </div>
        </div>
    );
}

const Comment = React.forwardRef(({ comment, postAuthor, depth, animationState, index, onContentClick, isLastInList = false, isCollapsed: isParentCollapsed, isHighlighted, animateNewReplies = false }, ref) => {
    const [isCollapsed, setIsCollapsed] = useState(() => depth === -1 && !!isParentCollapsed);
    const [revealOnMount] = useState(animateNewReplies);
    const [replyLimit, setReplyLimit] = useState(REPLY_PAGE_SIZE);
    const replyPage = React.useMemo(() => depth === -1
        ? getReplyPage(comment.replies, replyLimit)
        : { replies: comment.replies || [], remaining: 0 }, [comment.replies, depth, replyLimit]);
    const hasReplies = replyPage.replies.length > 0;
    const isOriginalPoster = !!postAuthor && postAuthor !== '[deleted]' && comment.author?.toLowerCase() === postAuthor.toLowerCase();
    const repliesId = `comment-replies-${comment.id}`;
    const colorPalette = ['bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-red-500', 'bg-purple-500', 'bg-pink-500'];
    const color = colorPalette[depth % colorPalette.length];
    const animationClass = animationState === 'animating-in' ? 'animate-fly-up' : animationState === 'animating-out' ? 'animate-fly-out-right' : '';
    const animationDelay = animationState === 'animating-in' || animationState === 'animating-out' ? `${index * 30}ms` : '0ms';

    const wrapperClass = `mt-1 ${depth === -1 ? 'comment-thread' : ''} ${depth > 0 ? 'ml-1' : ''} ${revealOnMount ? 'comment-reply-enter' : animationClass}`;

    useEffect(() => {
        if (depth === -1) { // Only for parent comments
            setIsCollapsed(isParentCollapsed);
        }
    }, [isParentCollapsed, depth]);

    if (!comment.text || comment.text.trim() === '>') {
        return null;
    }

    return (
        <div className={wrapperClass} style={{ animationDelay }} ref={ref}>
            <div className={`bg-slate-800 rounded-lg relative overflow-hidden cursor-pointer ${isHighlighted ? 'comment-current' : ''}`} onClick={() => hasReplies && setIsCollapsed(!isCollapsed)}>
                {depth >= 0 && <div className={`absolute top-0 left-0 h-full w-1 ${color}`}></div>}
                <div className="p-2 overflow-hidden">
                    <div className={`flex justify-between items-start text-gray-400 text-xs ${depth >= 0 ? 'pl-3' : ''}`}>
                        <div>
                            <span className={`font-bold ${isOriginalPoster ? 'comment-author-op' : 'text-gray-300'}`} title={isOriginalPoster ? 'Original poster' : undefined}>{comment.author}{isOriginalPoster && <span className="sr-only"> (original poster)</span>}</span>
                            {comment.flairIcons?.length > 0 && <span className="comment-author-flair">{comment.flairIcons.map((icon, i) => <img key={`${icon.url}-${i}`} src={icon.url} alt={icon.label} title={icon.label} width="16" height="16" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none'; }} />)}</span>}
                            <span className="mx-2">•</span><span>{comment.score} points</span><span className="mx-2">•</span><span>{comment.time}</span>
                        </div>
                        {hasReplies && (<svg className={`w-4 h-4 text-gray-500 transition-transform transform ${isCollapsed ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>)}
                    </div>
                    <div className={`text-gray-200 mt-1 ${depth >= 0 ? 'pl-3' : ''}`}><MarkdownRenderer content={comment.text} onContentClick={onContentClick} /></div>
                </div>
            </div>
            {hasReplies && (
                <ReplyExpansion collapsed={isCollapsed} revision={replyLimit}>
                    <div id={repliesId}>
                        {replyPage.replies.map((reply, i) => (
                            <Comment
                                key={reply.id}
                                comment={reply}
                                postAuthor={postAuthor}
                                depth={depth + 1}
                                animationState={depth === -1 && replyLimit > REPLY_PAGE_SIZE ? undefined : animationState}
                                animateNewReplies={animateNewReplies || (depth === -1 && replyLimit > REPLY_PAGE_SIZE)}
                                index={index + i + 1}
                                onContentClick={onContentClick}
                                isLastInList={i === replyPage.replies.length - 1}
                                isCollapsed={isParentCollapsed}
                            />
                        ))}
                    </div>
                    {depth === -1 && replyPage.remaining > 0 && (
                        <div className="comment-reply-controls">
                            <button type="button" aria-controls={repliesId} onClick={event => {
                                event.stopPropagation();
                                setReplyLimit(limit => limit + REPLY_PAGE_SIZE);
                            }}><span>Load more replies ({replyPage.remaining})</span></button>
                        </div>
                    )}
                </ReplyExpansion>
            )}
        </div>
    );
});

const ThreadDetail = React.forwardRef(({ thread, accessToken, onContentClick, onTxtifyArticle, commentSort, onCommentSortLoaded, onToggleComments, onScrollToParent, currentParentCommentIndex, areAllCommentsCollapsed }, ref) => {
    const [comments, setComments] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [commentAnimationState, setCommentAnimationState] = useState('animating-in');
    const [showDropdown, setShowDropdown] = useState(false);
    const parentCommentRefs = useRef({});
    const titleCardRef = useRef(null);
    const commentRequestRef = useRef(null);
    const refreshTimerRef = useRef(null);

    const fetchComments = useCallback(async (sort = 'default', { preserveComments = false } = {}) => {
        commentRequestRef.current?.abort();
        const controller = new AbortController();
        commentRequestRef.current = controller;
        if (!preserveComments) {
            setComments([]);
            setIsLoading(true);
        }
        setError(null);
        try {
            const response = await fetch(getCommentsUrl(thread, sort), { headers: { 'Authorization': `bearer ${accessToken}` }, signal: controller.signal });
            if (!response.ok) throw new Error('Failed to fetch comments.');
            const data = await response.json();
            if (controller.signal.aborted) return;
            const loadedSort = sort === 'default' ? getPostCommentSort(data[0]?.data?.children?.[0]?.data) : normalizeCommentSort(sort);
            const processReplies = (apiReplies) => {
                if (!apiReplies?.data?.children) return [];
                return apiReplies.data.children.filter(r => r.kind === 't1').map(({ data: r }) => {
                    let body = r.body ? decodeUrl(r.body) : '';
                    if (body) {
                        body = body.replace(/giphy\|(\w+)/g, (match, id) => `https://media.giphy.com/media/${id}/giphy.gif`);
                        body = body.replace(/\[GIF\]\((https?:\/\/giphy\.com[^\s]+)\)/g, (match, url) => {
                            const idMatch = url.match(/\/gifs\/(?:[^\s-]+\-)?([a-zA-Z0-9]+)$/);
                            if (idMatch) {
                                return `https://media.giphy.com/media/${idMatch[1]}/giphy.gif`;
                            }
                            return url;
                        });
                    }
                    return { id: r.id, author: r.author, flairIcons: getAuthorFlairIcons(r), score: r.score, time: formatTimeAgo(r.created_utc), text: body, replies: processReplies(r.replies) };
                });
            };
            const topLevelComments = processReplies(data[1]);
            setCachedData(`comment-${thread.id}-${sort}`, sort === 'default' ? { sort: loadedSort, comments: topLevelComments } : topLevelComments);
            setComments(topLevelComments);
            onCommentSortLoaded(loadedSort);
        } catch (err) {
            if (!controller.signal.aborted && !preserveComments) setError(err.message);
        } finally {
            if (!controller.signal.aborted) setIsLoading(false);
        }
    }, [thread, accessToken, onCommentSortLoaded]);

    React.useImperativeHandle(ref, () => ({
        refresh: (sort = commentSort) => {
            if (titleCardRef.current) {
                const y = getHeaderScrollTop(titleCardRef.current, 'bottom');
                window.scrollTo({ top: y, behavior: 'smooth' });
            }
            setCommentAnimationState('animating-out');
            clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = setTimeout(() => {
                setComments([]);
                fetchComments(sort).then(() => {
                    setCommentAnimationState('animating-in');
                });
            }, 500);
        },
        parentCommentRefs: parentCommentRefs
    }));

    useEffect(() => {
        if (!thread) return;
        setComments([]);
        setError(null);
        setCommentAnimationState('animating-in');
        const cached = readCommentCache(thread, commentSort, getCachedData, !accessToken || !navigator.onLine);
        if (cached) {
            setComments(cached.comments);
            onCommentSortLoaded(cached.sort);
            setIsLoading(false);
            if (accessToken && navigator.onLine && commentsNeedFlairRefresh(cached.comments)) {
                fetchComments(commentSort, { preserveComments: true });
            }
        } else if (accessToken) {
            fetchComments(commentSort);
        } else {
            setIsLoading(false);
            setError('Comments not available offline.');
        }
        return () => {
            commentRequestRef.current?.abort();
            clearTimeout(refreshTimerRef.current);
        };
    }, [thread, accessToken, fetchComments, commentSort, onCommentSortLoaded]);

    if (!thread) return null;
    const content = getThreadContent(thread);

    return (
        <div className="thread-detail text-white h-full">
            <div className="p-2 md:p-4">
                <div ref={titleCardRef} className={`bg-slate-800 border rounded-md shadow-lg p-4 mb-4 animate-fade-in-slow border-slate-700`}>
                    <p className="text-gray-400 text-xs">Posted by u/{thread.author} in r/{thread.subreddit}</p>
                    <div className={`${thread.stickied ? 'text-green-400' : 'text-gray-100'} text-xl font-medium my-2`}><MarkdownRenderer content={thread.title} inline={true} embedImages={false} /></div>
                    {thread.selfText && (<div className="text-gray-300 mt-4 whitespace-pre-wrap"><MarkdownRenderer content={thread.selfText} onContentClick={onContentClick} /></div>)}
                    {content && content.length > 0 && (
                        <div className={`mt-4 rounded-lg max-w-full h-auto cursor-pointer ${content.length > 1 ? 'relative' : ''}`} onClick={() => onContentClick(content, 0)}>
                            {content[0].provider ? <button type="button" className="clip-preview" onClick={event => { event.stopPropagation(); onContentClick(content, 0); }}>{thread.thumbnail && <img src={thread.thumbnail} alt="" />}<span>▶ Play clip</span></button> : content[0].type === 'image' ? <img src={content[0].url} className="w-full rounded-lg" alt="Post content"/> : <VideoPlayer src={content[0].url} className="w-full rounded-lg bg-black" loop playsInline autoPlay muted controls />}
                            {content.length > 1 && <div className="absolute top-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded-full">1 / {content.length}</div>}
                        </div>
                    )}
                    <div className="text-gray-400 text-sm mt-2 flex items-center relative"><p>{thread.commentsCount}</p><span className="mx-2">•</span><button onClick={() => setShowDropdown(!showDropdown)} className="text-blue-500 hover:underline">{thread.domain}</button>{showDropdown && <LinkActionDropdown url={thread.url} onContentClick={onContentClick} onTxtify={onTxtifyArticle} onClose={() => setShowDropdown(false)} />}<span className="mx-2">•</span><p>{formatTimeAgo(thread.created)}</p></div>
                </div>
                <div className="relative">
                    {isLoading && <div className="loader" style={{ position: 'absolute', top: '20px', left: 'calc(50% - 10vmin)' }}></div>}
                    {error && <p className="text-center text-red-400">{error}</p>}
                    {comments.map((comment, index) => (
                        <Comment
                            key={comment.id}
                            comment={comment}
                            postAuthor={thread.author}
                            depth={-1}
                            animationState={commentAnimationState}
                            index={index}
                            onContentClick={onContentClick}
                            isLastInList={index === comments.length - 1}
                            isCollapsed={areAllCommentsCollapsed}
                            ref={el => parentCommentRefs.current[index] = el}
                            isHighlighted={index === currentParentCommentIndex}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
});
function ArticleViewer({ url, onClose, animationState, onAnimationEnd }) {
    const [article, setArticle] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const rapidApiKey = localStorage.getItem('rapidApiKey');

    useEffect(() => {
        const fetchArticle = async () => {
            setIsLoading(true);
            setError(null);
            setArticle(null);

            const cacheKey = `article_${url}`;
            const cachedArticle = getCachedData(cacheKey);

            if (cachedArticle) {
                setArticle(cachedArticle);
                setIsLoading(false);
                return;
            }

            if (!rapidApiKey) {
                setError('RapidAPI Key not found. Please enter it in the credentials modal.');
                setIsLoading(false);
                return;
            }

            try {
                const extracted = await extractArticle(url, rapidApiKey);
                setArticle(extracted);
                setCachedData(cacheKey, extracted);
            } catch (err) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchArticle();
    }, [url, rapidApiKey]);

    const formatDate = (dateString) => {
        if (!dateString) return '';
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        return new Date(dateString).toLocaleDateString(undefined, options);
    };

    const truncateUrl = (url) => {
        if (!url) return '';
        try {
            const urlObj = new URL(url);
            let domain = urlObj.hostname;
            if (domain.startsWith('www.')) {
                domain = domain.substring(4);
            }
            let path = urlObj.pathname;
            if (path.length > 20) {
                path = path.substring(0, 20) + '...';
            }
            return domain + path;
        } catch (e) {
            return url;
        }
    };

    const animationClass = animationState === 'animating-in' ? 'animate-fade-in' : animationState === 'animating-out' ? 'animate-fade-out' : '';


    return (
        <div className={`full-screen-viewer fixed inset-0 z-50 bg-slate-900 text-white overflow-y-auto ${animationClass}`} onAnimationEnd={onAnimationEnd}>
            <div className="max-w-2xl mx-auto p-4">
                <div className="flex justify-end mb-4">
                    <button onClick={onClose} className="text-white text-2xl hover:text-gray-400">&times;</button>
                </div>

                {isLoading && <div className="loader"></div>}

                {error && (
                    <div className="text-center text-red-400 p-8">
                        <h2 className="text-2xl font-bold mb-4">Error Loading Article</h2>
                        <p className="mb-6">{error}</p>
                        <button onClick={onClose} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded-md">Go Back</button>
                    </div>
                )}

                {article && (
                    <div className="prose max-w-none">
                        <h1 className="text-3xl font-bold mb-2 text-white">{article.title}</h1>
                        <div className="flex items-center text-sm text-gray-400 mb-4">
                            {article.published && <p>{formatDate(article.published)}</p>}
                            {article.published && url && <span className="mx-2">•</span>}
                            {url && (
                                <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center hover:underline">
                                    {article.favicon && <img src={article.favicon} className="w-4 h-4 mr-2" alt="favicon" />}
                                    {truncateUrl(url)}
                                </a>
                            )}
                        </div>
                        {article.image && <img src={article.image} alt={article.title} className="w-full rounded-lg mb-4" />}
                        <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(article.content) }} />
                    </div>
                )}
            </div>
        </div>
    );
}

function MediaViewer({ items, startIndex, onClose, animationState, onAnimationEnd }) {
    const [currentIndex, setCurrentIndex] = useState(startIndex);
    const [isLoading, setIsLoading] = useState(true);
    const currentItem = items[currentIndex];

    useEffect(() => {
        setIsLoading(true);
    }, [currentItem.url]);

    const goToNext = (e) => { e.stopPropagation(); setCurrentIndex((prev) => (prev + 1) % items.length); };
    const goToPrev = (e) => { e.stopPropagation(); setCurrentIndex((prev) => (prev - 1 + items.length) % items.length); };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'ArrowRight') goToNext(e);
            if (e.key === 'ArrowLeft') goToPrev(e);
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        document.body.classList.add('modal-open');

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.body.classList.remove('modal-open');
        };
    }, [onClose]);

    const handleCloseClick = (e) => {
        e.stopPropagation();
        onClose();
    };

    const animationClass = animationState === 'animating-in' ? 'animate-scale-in' : 'animate-scale-out-custom';

    return (
        <div className={`full-screen-viewer fixed inset-0 z-50 bg-black bg-opacity-90 flex flex-col items-center justify-center ${animationClass}`} onAnimationEnd={onAnimationEnd} onClick={handleCloseClick}>
            <div className="absolute top-4 left-4 z-10 text-white bg-black bg-opacity-50 px-3 py-1 rounded-full text-sm font-mono">{currentIndex + 1} / {items.length}</div>
            {items.length > 1 && (
                <button aria-label="Previous image" onClick={goToPrev} className="absolute left-4 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white p-3 rounded-full hover:bg-opacity-75 transition-opacity z-10">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                </button>
            )}
            <div className="relative w-full h-full flex items-center justify-center p-4 md:p-8" onClick={(e) => e.stopPropagation()}>
                {isLoading && currentItem.type === 'image' && <div className="loader"></div>}
                {currentItem.type === 'image' ? <ZoomableImage key={currentIndex + currentItem.url} src={currentItem.url} onLoad={() => setIsLoading(false)} /> : <VideoPlayer key={currentItem.url} src={currentItem.url} sourceUrl={currentItem.sourceUrl} className="max-w-full max-h-full" controls autoPlay loop onLoadStart={() => setIsLoading(true)} onCanPlay={() => setIsLoading(false)} />}
            </div>
            {items.length > 1 && (
                <button aria-label="Next image" onClick={goToNext} className="absolute right-4 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white p-3 rounded-full hover:bg-opacity-75 transition-opacity z-10">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                </button>
            )}
            <div className="absolute bottom-4 right-4 z-10 flex space-x-2">
                {(currentItem.type === 'image' || (currentItem.type === 'video' && /^https:\/\/v\.redd\.it\/[^/]+\/[^?]+\.m3u8(?:\?|$)/i.test(currentItem.url))) && <MediaActions key={currentItem.url} item={currentItem} />}
                <button aria-label="Close media viewer" onClick={handleCloseClick} onTouchEnd={handleCloseClick} className="bg-black bg-opacity-50 text-white p-3 rounded-full hover:bg-opacity-75 transition-opacity">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        </div>
    );
}
function LinkActionDropdown({ url, onTxtify, onClose, onContentClick }) {
    const dropdownRef = useRef(null);
    const canTxtify = !!localStorage.getItem('rapidApiKey')?.trim();

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);

    const handleOriginalLinkClick = (e) => {
        e.stopPropagation();
        window.open(url, '_blank');
        onClose();
    };

    const handleTxtifyClick = (e) => {
        e.stopPropagation();
        if (!canTxtify) return;
        onTxtify(url);
        onClose();
    };

    return (
        <div ref={dropdownRef} className="absolute bottom-full left-0 mb-2 w-48 bg-slate-700 rounded-md shadow-lg z-20 animate-fade-in">
            <ul className="py-1">
                {getVideoLink(url) && onContentClick && <li><button onClick={event => { event.stopPropagation(); onContentClick([getVideoLink(url)], 0); onClose(); }} className="block w-full text-left px-4 py-2 text-sm text-white hover:bg-slate-600">Play video</button></li>}
                <li>
                    <button onClick={handleOriginalLinkClick} className="block w-full text-left px-4 py-2 text-sm text-white hover:bg-slate-600">
                        Original Link
                    </button>
                </li>
                {canTxtify && <li>
                    <button onClick={handleTxtifyClick} className="block w-full text-left px-4 py-2 text-sm text-white hover:bg-slate-600">
                        Txtify Article
                    </button>
                </li>}
            </ul>
        </div>
    );
}

function SwipeableThreadCard({ thread, animationState, index, onTxtifyArticle, ...props }) {
    const longPressTimer = useRef();
    const isLongPress = useRef(false);
    const touchStartPos = useRef({ x: 0, y: 0 });
    const isPressing = useRef(false);

    const handlePressStart = (e) => {
        isPressing.current = true;
        isLongPress.current = false;
        const touch = e.touches ? e.touches[0] : e;
        touchStartPos.current = { x: touch.clientX, y: touch.clientY };

        longPressTimer.current = setTimeout(() => {
            isLongPress.current = true;
            props.onLongPress(thread.id);
        }, 500);
    };

    const handlePressEnd = () => {
        isPressing.current = false;
        clearTimeout(longPressTimer.current);
    };

    const handleMove = (e) => {
        if (!isPressing.current) return;

        const touch = e.touches ? e.touches[0] : e;
        const moveX = Math.abs(touch.clientX - touchStartPos.current.x);
        const moveY = Math.abs(touch.clientY - touchStartPos.current.y);

        if (moveX > 10 || moveY > 10) {
            clearTimeout(longPressTimer.current);
        }
    };

    const handleClick = () => {
        if (isLongPress.current) {
            isLongPress.current = false;
            return;
        }
        props.onClick(thread);
    };

    const animationClass = animationState === 'animating-in' ? 'animate-fly-up' : animationState === 'animating-out' ? 'animate-fly-out-right' : '';
    const animationDelay = animationState === 'animating-in' || animationState === 'animating-out' ? `${(index % 5) * 100}ms` : '0ms';
    const wc = `swipe-wrapper mb-2 ${animationClass}`;
    const bc = props.isHighlighted ? 'bg-blue-900' : (thread.isArticleCached ? 'bg-orange-900' : (thread.isCached ? 'bg-slate-700' : 'bg-slate-800 hover:bg-slate-700'));

    const content = getThreadContent(thread);
    const contentType = content[0]?.type;
    const [showDropdown, setShowDropdown] = useState(false);

    const handleDomainClick = (e) => {
        e.stopPropagation();
        setShowDropdown(!showDropdown);
    };

    const handleTxtify = (url) => {
        onTxtifyArticle(url);
    };

    return (<div className={wc} style={{ animationDelay }}><div className="swipe-content" onMouseDown={handlePressStart} onTouchStart={handlePressStart} onMouseUp={handlePressEnd} onTouchEnd={handlePressEnd} onMouseMove={handleMove} onTouchMove={handleMove} onClick={handleClick}><div className={`relative border border-slate-700 rounded-md shadow-lg p-3 md:p-4 cursor-pointer transform transition-colors duration-200 ${bc}`}><div className="flex justify-between items-center"><div className="flex-1 pr-4"><p className="text-gray-400 text-xs">{thread.upvotes} <span className="font-bold text-gray-200">{thread.author}</span> in {thread.subreddit}</p><div className={`${thread.stickied ? 'text-green-400' : 'text-gray-100'} text-base font-medium my-2`}><MarkdownRenderer content={thread.title} inline={true} /></div></div>{(thread.thumbnail || contentType === 'video') && <div role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); props.onContentClick(content, 0); } }} aria-label={contentType === 'video' ? 'Play video' : 'View image'} className="relative w-20 h-16 bg-cover bg-center rounded-md z-10" style={{ backgroundImage: thread.thumbnail ? `url(${thread.thumbnail})` : undefined }} onClick={(e) => { e.stopPropagation(); props.onContentClick(content, 0); }}>{contentType === 'video' && (<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' class='feather feather-play-circle'%3E%3Ccircle cx='12' cy='12' r='10'%3E%3C/circle%3E%3Cpolygon points='10 8 16 12 10 16 10 8'%3E%3C/polygon%3E%3C/svg%3E" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8" />)}{contentType === 'image' && (<div className="absolute bottom-1 right-1"><svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg></div>)}</div>}</div><div className="text-gray-400 text-sm mt-2 flex items-center relative"><p>{thread.commentsCount}</p><span className="mx-2">•</span><button onClick={handleDomainClick} className="text-blue-500 hover:underline">{thread.domain}</button>{showDropdown && <LinkActionDropdown url={thread.url} onContentClick={props.onContentClick} onTxtify={handleTxtify} onClose={() => setShowDropdown(false)} />}<span className="mx-2">•</span><p>{formatTimeAgo(thread.created)}</p></div></div></div></div>);
}

function App() {
    const menuWidth = 256;
    const [menuTranslateX, setMenuTranslateX] = useState(-menuWidth);
    const [isMenuTransitioning, setIsMenuTransitioning] = useState(false);
    const touchStartX = useRef(0);
    const touchCurrentX = useRef(0);
    const isDraggingMenu = useRef(false);
    const [isDraggingFavorite, setIsDraggingFavorite] = useState(false);
    const [threads, setThreads] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isOffline, setIsOffline] = useState(false);
    const [showCredentialsModal, setShowCredentialsModal] = useState(false);
    const [accessToken, setAccessToken] = useState(null);
    const [selectedThread, setSelectedThread] = useState(null);
    const [highlightedThreads, setHighlightedThreads] = useState(new Set());
    const [showNav, setShowNav] = useState(true);
    const lastScrollY = useRef(0);
    const navScrollDistance = useRef(0);
    const [isDetailActive, setIsDetailActive] = useState(false);
    const feedScrollY = useRef(0);
    const pendingViewScrollY = useRef(null);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [favorites, setFavorites] = useState(getCachedData('favorites') || ['all']);
    const [viewingContent, setViewingContent] = useState(null);
    const [nextPageCursor, setNextPageCursor] = useState(null);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [currentSubreddit, setCurrentSubreddit] = useState('popular');
    const [cardAnimationState, setCardAnimationState] = useState('idle');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showSubredditModal, setShowSubredditModal] = useState(false);
    const [showSortModal, setShowSortModal] = useState(false);
    const [showCommentSortModal, setShowCommentSortModal] = useState(false);
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const [showClearCacheModal, setShowClearCacheModal] = useState(false);
    const [currentSort, setCurrentSort] = useState('hot');
    const [commentSort, setCommentSort] = useState('default');
    const [resolvedCommentSort, setResolvedCommentSort] = useState('best');
    const [areAllCommentsCollapsed, setAreAllCommentsCollapsed] = useState(false);
    const [currentParentCommentIndex, setCurrentParentCommentIndex] = useState(-1);
    const threadDetailRef = useRef();
    const [viewingArticle, setViewingArticle] = useState(null);
    const [isCredentialsModalOpen, setIsCredentialsModalOpen] = useState(false);
    const [articleAnimationState, setArticleAnimationState] = useState('idle');
    const [mediaViewerAnimationState, setMediaViewerAnimationState] = useState('idle');
    const [isCaching, setIsCaching] = useState(false);
    const [cacheNotice, setCacheNotice] = useState('');
    const [isProgrammaticScroll, setIsProgrammaticScroll] = useState(false);
    const programmaticScrollTimeout = useRef(null);
    const cancelCommentAnchor = useRef(null);

    useEffect(() => () => cancelCommentAnchor.current?.(), [isDetailActive]);

    useLayoutEffect(() => {
        // Feed and comments share the window scroll. Browser history restoration
        // can otherwise overwrite our position during the sliding transition.
        const previous = window.history.scrollRestoration;
        window.history.scrollRestoration = 'manual';
        return () => { window.history.scrollRestoration = previous; };
    }, []);

    useLayoutEffect(() => {
        if (pendingViewScrollY.current === null) return;
        const top = pendingViewScrollY.current;
        pendingViewScrollY.current = null;
        // Wait for the destination view's layout, then cancel any smooth scroll
        // still running in the outgoing view before the next paint.
        const restore = () => {
            window.scrollTo({ top, left: 0, behavior: 'instant' });
            lastScrollY.current = window.scrollY;
            navScrollDistance.current = 0;
        };
        restore();
        // Keep the destination steady during the 400ms slide. History traversal
        // and outgoing touch/keyboard momentum can continue after popstate.
        const end = performance.now() + 400;
        let frame;
        const settle = () => {
            restore();
            if (performance.now() < end) frame = requestAnimationFrame(settle);
        };
        frame = requestAnimationFrame(settle);
        setShowNav(true);
        return () => cancelAnimationFrame(frame);
    }, [isDetailActive]);

    const handleSelectCachedFeed = async () => {
        handleMenuToggle();
        if (isDetailActive) {
            setIsDetailActive(false);
            setSelectedThread(null);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setCardAnimationState('animating-out');

        setTimeout(async () => {
            setIsLoading(true);
            setError(null);
            setThreads([]);

            try {
                await pruneBoundedCache(POST_CACHE_NAME, POST_CACHE_POLICY);
                const cache = await caches.open(POST_CACHE_NAME);
                const keys = await cache.keys();
                const postRequests = keys.filter(req => req.url.includes('post-'));
                const postsPromises = postRequests.map(async (req) => {
                    const res = await cache.match(req);
                    return res ? res.json() : null;
                });
                const posts = (await Promise.all(postsPromises)).filter(Boolean);

                // De-duplicate posts by ID to prevent issues with the filter
                const uniquePosts = Array.from(new Map(posts.map(p => [p.id, p])).values());

                const postsWithComments = uniquePosts.filter(post => hasCachedComments(post, getCachedData));

                const postsWithCacheStatus = postsWithComments.map(post => ({
                    ...post,
                    isCached: true,
                    isArticleCached: !!getCachedData(`article_${post.url}`)
                }));

                setThreads(postsWithCacheStatus);
                setCurrentSubreddit('cached');
                setNextPageCursor(null);
            } catch (e) {
                setError("Could not load cached feed.");
                console.error(e);
            } finally {
                setIsLoading(false);
                setCardAnimationState('animating-in');
            }
        }, 300);
    };

    const isDetailActiveRef = useRef(isDetailActive);
    isDetailActiveRef.current = isDetailActive;
    const isMenuOpenRef = useRef(isMenuOpen);
    isMenuOpenRef.current = isMenuOpen;
    const viewingContentRef = useRef(viewingContent);
    viewingContentRef.current = viewingContent;
    const viewingArticleRef = useRef(viewingArticle);
    viewingArticleRef.current = viewingArticle;

    useEffect(() => {
        if (isMenuOpen) {
            document.body.classList.add('modal-open');
        } else {
            document.body.classList.remove('modal-open');
        }
    }, [isMenuOpen]);

    const handleCloseArticle = () => {
        setArticleAnimationState('animating-out');
    };

    const onArticleAnimationEnd = () => {
        if (articleAnimationState === 'animating-out') {
            setViewingArticle(null);
            setArticleAnimationState('idle');
        }
    };

    const handleCloseMediaViewer = () => {
        setMediaViewerAnimationState('animating-out');
    };

    const onMediaViewerAnimationEnd = () => {
        if (mediaViewerAnimationState === 'animating-out') {
            setViewingContent(null);
            setMediaViewerAnimationState('idle');
        }
    };

    useEffect(() => {
        const handlePopState = () => {
            if (viewingArticleRef.current) {
                handleCloseArticle();
                return;
            }
            if (viewingContentRef.current) {
                handleCloseMediaViewer();
                return;
            }
            if (isDetailActiveRef.current) {
                pendingViewScrollY.current = feedScrollY.current;
                setIsDetailActive(false);
                setTimeout(() => { if (!isDetailActiveRef.current) setSelectedThread(null); }, 400);
                return;
            }
            if (isMenuOpenRef.current) {
                setIsMenuOpen(false);
                return;
            }
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, []);

    const ensureToken = useCallback(async () => {
        if (accessToken) return accessToken;

        const clientId = localStorage.getItem('redditClientId');
        const clientSecret = localStorage.getItem('redditSecret');

        if (!clientId || !clientSecret) {
            if (navigator.onLine) {
                setShowCredentialsModal(true);
            }
            return null;
        }

        if (!navigator.onLine) {
            return null;
        }

        try {
            const tokenResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + btoa(clientId + ':' + clientSecret) },
                body: 'grant_type=client_credentials'
            });
            if (!tokenResponse.ok) {
                localStorage.removeItem('redditClientId');
                localStorage.removeItem('redditSecret');
                if (navigator.onLine) {
                    setShowCredentialsModal(true);
                }
                throw new Error('Authentication failed. Please check your credentials and try again.');
            }
            const tokenData = await tokenResponse.json();
            setAccessToken(tokenData.access_token);
            return tokenData.access_token;
        } catch (err) {
            console.warn("Could not fetch token.", err.message);
            return null;
        }
    }, [accessToken]);

    const fetchThreads = useCallback(async (subreddit = 'popular', after = null) => {
        const cacheKey = `cachedFeed_${subreddit}_${currentSort}`;

        if (after) setIsLoadingMore(true);
        else setIsLoading(true);
        setError(null);
        setIsOffline(false);

        const token = await ensureToken();

        let networkSuccess = false;
        if (token) {
            try {
                const { posts, after: newAfter } = await fetchAndProcessThreads(token, subreddit, after, currentSort);
                networkSuccess = true;

                const postsWithCacheStatus = posts.map(post => ({
                    ...post,
                    isCached: hasCachedComments(post, getCachedData)
                }));

                if (after) {
                    setThreads(prev => [...prev, ...postsWithCacheStatus]);
                    setNextPageCursor(newAfter);
                    const cachedFeed = getCachedData(cacheKey) || { threads: [] };
                    setCachedData(cacheKey, { threads: [...cachedFeed.threads, ...posts], after: newAfter });
                } else {
                    setThreads(postsWithCacheStatus);
                    setNextPageCursor(newAfter);
                    setCachedData(cacheKey, { threads: posts, after: newAfter });
                    setCardAnimationState('animating-in');
                }
            } catch (err) {
                console.error("API Error, falling back to cache:", err);
                if (!after) {
                    setError(err.message);
                }
            }
        }

        if (!networkSuccess && !after) {
            const cachedFeed = getCachedData(cacheKey);
            if (cachedFeed && cachedFeed.threads) {
                setError(null);
                const threadsWithCacheStatus = cachedFeed.threads.map(post => ({
                    ...post,
                    isCached: hasCachedComments(post, getCachedData)
                }));
                setThreads(threadsWithCacheStatus);
                setNextPageCursor(cachedFeed.after);
                setCardAnimationState('animating-in');
            } else {
                setIsOffline(true);
            }
        }

        setIsLoading(false);
        setIsLoadingMore(false);
        if (!after) setIsRefreshing(false);
    }, [ensureToken, currentSort]);

    useEffect(() => {
        if (currentSubreddit === 'cached') return;
        fetchThreads(currentSubreddit);
    }, [fetchThreads, currentSubreddit, currentSort]);

    const handleSaveCredentials = (id, s, rapidKey) => {
        localStorage.setItem('redditClientId', id);
        localStorage.setItem('redditSecret', s);
        if (rapidKey.trim()) localStorage.setItem('rapidApiKey', rapidKey.trim());
        else localStorage.removeItem('rapidApiKey');
        setIsCredentialsModalOpen(false);
        setShowCredentialsModal(false);
        fetchThreads(currentSubreddit);
    };

    const handleCacheHighlighted = async () => {
        setCacheNotice('');
        setIsCaching(true);
        const token = await ensureToken();
        if (!token) {
            setIsCaching(false);
            return;
        }

        const rapidApiKey = localStorage.getItem('rapidApiKey')?.trim();

        const highlightedArray = Array.from(highlightedThreads);
        const downloaded = new Set();
        for (const threadId of highlightedArray) {
            const thread = threads.find(t => t.id === threadId);
            if (thread) {
                // 1. Cache comments
                try {
                    const response = await fetch(getCommentsUrl(thread), { headers: { 'Authorization': `bearer ${token}` } });
                    if (response.ok) {
                        const data = await response.json();
                        const processReplies = (apiReplies) => {
                            if (!apiReplies?.data?.children) return [];
                            return apiReplies.data.children.filter(r => r.kind === 't1').map(({ data: r }) => {
                                let body = r.body ? decodeUrl(r.body) : '';
                                if (body) {
                                    body = body.replace(/giphy\|(\w+)/g, (match, id) => `https://media.giphy.com/media/${id}/giphy.gif`);
                                    body = body.replace(/\[GIF\]\((https?:\/\/giphy\.com[^\s]+)\)/g, (match, url) => {
                                        const idMatch = url.match(/\/gifs\/(?:[^\s-]+\-)?([a-zA-Z0-9]+)$/);
                                        if (idMatch) {
                                            return `https://media.giphy.com/media/${idMatch[1]}/giphy.gif`;
                                        }
                                        return url;
                                    });
                                }
                                return { id: r.id, author: r.author, flairIcons: getAuthorFlairIcons(r), score: r.score, time: formatTimeAgo(r.created_utc), text: body, replies: processReplies(r.replies) };
                            });
                        };
                        const topLevelComments = processReplies(data[1]);
                        const defaultSort = getPostCommentSort(data[0]?.data?.children?.[0]?.data);
                        if (setCachedData(`comment-${thread.id}-default`, { sort: defaultSort, comments: topLevelComments })) {
                            if (await putBoundedCache(POST_CACHE_NAME, `post-${thread.id}`,
                                new Response(JSON.stringify({ ...thread, suggestedSort: defaultSort })), POST_CACHE_POLICY)) downloaded.add(thread.id);
                        }
                    }
                } catch (err) {
                    console.error(`Failed to cache comments for ${thread.id}`, err);
                }

                await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay

                // 2. Txtify and cache article
                if (rapidApiKey && thread.url && !thread.isSelf) {
                    try {
                        const extracted = await extractArticle(thread.url, rapidApiKey);
                        setCachedData(`article_${thread.url}`, extracted);
                    } catch (err) {
                        console.error(`Failed to txtify article for ${thread.id}`, err);
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
        }
        setHighlightedThreads(new Set()); // Clear highlights after caching
        // Optionally, refresh the view to show new cached status
        const currentThreads = [...threads];
        const updatedThreads = currentThreads.map(t => {
            if (highlightedArray.includes(t.id)) {
                return { ...t, isCached: hasCachedComments(t, getCachedData), isArticleCached: !!getCachedData(`article_${t.url}`) };
            }
            return t;
        });
        setThreads(updatedThreads);
        const savedCount = highlightedArray.filter(id => downloaded.has(id) && hasCachedComments({ id }, getCachedData)).length;
        if (savedCount < highlightedArray.length) {
            setCacheNotice(`${savedCount} of ${highlightedArray.length} posts saved. Some downloads were unavailable or too large for the cache. You can keep browsing.`);
        }
        setIsCaching(false);
    };
    const handleContentClick = (items, startIndex) => {
        if (items && items.length > 0) {
            setViewingContent({ items, startIndex });
            setMediaViewerAnimationState('animating-in');
            window.history.pushState({ view: 'media' }, '', '#media');
        }
    };

    const handleRefreshComments = () => {
        if (threadDetailRef.current) {
            threadDetailRef.current.refresh();
        }
    };

    const handleThreadClick = (t) => {
        if (isDetailActiveRef.current) return;
        feedScrollY.current = window.scrollY;
        pendingViewScrollY.current = 0;
        setCommentSort('default');
        setResolvedCommentSort(getPostCommentSort(t));
        setSelectedThread(t);
        setIsDetailActive(true);
        window.history.pushState({ view: 'detail' }, '', '#detail');
    };

    const handleBackPress = () => { if (isDetailActive) { window.history.back(); } };

    const handleThreadLongPress = (threadId) => {
        setHighlightedThreads(prev => {
            const newSet = new Set(prev);
            if (newSet.has(threadId)) {
                newSet.delete(threadId);
            } else {
                newSet.add(threadId);
            }
            return newSet;
        });
    };

    const handleMenuToggle = () => {
        const newIsOpen = !isMenuOpen;
        setIsMenuOpen(newIsOpen);
        setIsMenuTransitioning(true);
        setMenuTranslateX(newIsOpen ? 0 : -menuWidth);
        if (newIsOpen) {
            window.history.pushState({ view: 'menu' }, '', '#menu');
        }
    };
    const handleToggleFavorite = () => {
        const sub = selectedThread ? selectedThread.subreddit : currentSubreddit;
        const newFavorites = favorites.includes(sub) ? favorites.filter(f => f !== sub) : [...favorites, sub];
        setFavorites(newFavorites);
        setCachedData('favorites', newFavorites);
    };

    const handleRemoveFavorite = (fav) => {
        const newFavorites = favorites.filter(f => f !== fav);
        setFavorites(newFavorites);
        setCachedData('favorites', newFavorites);
    };
    const handleReorderFavorites = (s, e) => {
        const r = Array.from(favorites);
        const [rm] = r.splice(s, 1);
        r.splice(e, 0, rm);
        setFavorites(r);
        setCachedData('favorites', r);
    };
    const handleOpenSubredditModal = () => setShowSubredditModal(true);
    const handleOpenSortModal = () => {
        if (isDetailActive) {
            setShowCommentSortModal(true);
        } else {
            setShowSortModal(true);
        }
    };
    const handleOpenMoreMenu = () => setShowMoreMenu(true);

    const handleConfirmClearCache = async () => {
        dataCache.clear();
        await maintainCaches({ clear: true }).catch(() => {});
        setShowClearCacheModal(false);
        setThreads(previous => previous.map(thread => ({ ...thread, isCached: false, isArticleCached: false })));
        if (currentSubreddit === 'cached') {
            setThreads([]);
            setCurrentSubreddit('popular');
        } else handleRefreshFeed();
    };

    const handleSelectSort = (sort) => {
        setShowSortModal(false);
        if (sort === currentSort) return;

        window.scrollTo({ top: 0, behavior: 'smooth' });
        setCardAnimationState('animating-out');

        const animationDuration = 300;

        setTimeout(() => {
            setIsRefreshing(true);
            setCurrentSort(sort);
        }, animationDuration);
    };

    const handleSelectCommentSort = (sort) => {
        setShowCommentSortModal(false);
        if (sort === commentSort) return;

        setCommentSort(sort);
    };

    const handleSubredditChange = (subreddit) => {
        if (subreddit === currentSubreddit) return;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setCardAnimationState('animating-out');

        const animationDuration = 300;

        setTimeout(() => {
            setIsRefreshing(true);
            setCurrentSubreddit(subreddit);
            setCurrentSort('hot');
        }, animationDuration);
    };

    const handleSelectSubreddit = (subreddit) => {
        setShowSubredditModal(false);
        handleSubredditChange(subreddit);
    };

    const handleFavoriteSelect = (subreddit) => {
        handleMenuToggle();
        setTimeout(() => {
            if (isDetailActive) {
                setIsDetailActive(false);
                setSelectedThread(null);
            }
            handleSubredditChange(subreddit);
        }, 300);
    };

    const handleRefreshFeed = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setCardAnimationState('animating-out');

        const animationDuration = 300;

        setTimeout(() => {
            setIsRefreshing(true);
            fetchThreads(currentSubreddit);
        }, animationDuration);
    };

    const handleTxtifyArticle = (url) => {
        if (!localStorage.getItem('rapidApiKey')?.trim()) return;
        setViewingArticle(url);
        setArticleAnimationState('animating-in');
        window.history.pushState({ view: 'article' }, '', '#article');
    };

    const handleToggleAllComments = () => {
        cancelCommentAnchor.current?.();
        const refs = threadDetailRef.current?.parentCommentRefs.current || {};
        const parents = Object.keys(refs).sort((a, b) => Number(a) - Number(b)).map(key => refs[key]).filter(Boolean);
        const anchor = getCommentAnchor(parents, getHeaderClearance(), window.innerHeight);
        if (anchor) {
            clearTimeout(programmaticScrollTimeout.current);
            setShowNav(true);
            setIsProgrammaticScroll(true);
            setCurrentParentCommentIndex(parents.findIndex(parent => parent.firstElementChild === anchor.element));
            cancelCommentAnchor.current = preserveCommentPosition(anchor.element, anchor.top, () => {
                cancelCommentAnchor.current = null;
                setIsProgrammaticScroll(false);
            });
        }
        setAreAllCommentsCollapsed(collapsed => !collapsed);
    };

    const handleScrollToParent = (direction) => () => {
        cancelCommentAnchor.current?.();
        if (!threadDetailRef.current || !threadDetailRef.current.parentCommentRefs) return;

        const parentCommentsRefs = threadDetailRef.current.parentCommentRefs.current;
        const commentKeys = Object.keys(parentCommentsRefs).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
        const parentComments = commentKeys.map(key => parentCommentsRefs[key]).filter(Boolean);

        if (parentComments.length === 0) return;

        let nextIndex = currentParentCommentIndex;
        if (direction === 'down') {
            nextIndex = (nextIndex + 1) % parentComments.length;
        } else { // 'up'
            if (nextIndex <= 0) {
                nextIndex = parentComments.length - 1;
            } else {
                nextIndex = nextIndex - 1;
            }
        }

        setCurrentParentCommentIndex(nextIndex);

        const element = parentComments[nextIndex];
        if (element) {
            setShowNav(true);
            setIsProgrammaticScroll(true);
            if (programmaticScrollTimeout.current) {
                clearTimeout(programmaticScrollTimeout.current);
            }
            const y = getHeaderScrollTop(element);
            window.scrollTo({ top: y, behavior: 'smooth' });
            programmaticScrollTimeout.current = setTimeout(() => setIsProgrammaticScroll(false), 1000);
        }
    };

    const handleScroll = useCallback(() => {
        if (isProgrammaticScroll) {
            lastScrollY.current = window.scrollY;
            navScrollDistance.current = 0;
            return;
        }

        // Navbar visibility
        const nav = getNavScrollChange(lastScrollY.current, window.scrollY, navScrollDistance.current);
        navScrollDistance.current = nav.distance;
        if (nav.visible !== null) setShowNav(nav.visible);
        lastScrollY.current = window.scrollY;

        // Comment highlighting on scroll
        if (!isDetailActiveRef.current) return;

        if (threadDetailRef.current && threadDetailRef.current.parentCommentRefs) {
            const parentCommentsRefs = threadDetailRef.current.parentCommentRefs.current;
            const commentKeys = Object.keys(parentCommentsRefs).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
            const parentComments = commentKeys.map(key => parentCommentsRefs[key]).filter(Boolean);

            if (parentComments.length === 0) return;

            const viewportTopOffset = showNav ? getHeaderClearance() : 0;

            let newIndex = -1;
            let minDistance = Infinity;

            parentComments.forEach((el, index) => {
                const rect = el.getBoundingClientRect();
                // Consider comments whose top is above the bottom of the viewport and whose bottom is below the top of the viewport.
                if (rect.top < window.innerHeight && rect.bottom > viewportTopOffset) {
                    const distance = Math.abs(rect.top - viewportTopOffset);
                    if (distance < minDistance) {
                        minDistance = distance;
                        newIndex = index;
                    }
                }
            });

            if (newIndex !== -1) {
                setCurrentParentCommentIndex(prevIndex => {
                    if (newIndex !== prevIndex) {
                        return newIndex;
                    }
                    return prevIndex;
                });
            }
        }
    }, [isProgrammaticScroll, showNav]);

    useEffect(() => {
        window.addEventListener('scroll', handleScroll);
        return () => {
            window.removeEventListener('scroll', handleScroll);
        };
    }, [handleScroll]);

    const handleTouchStart = (e) => {
        if (e.target.closest?.('.full-screen-viewer, .modal-overlay, .markdown-table-scroll')) return;
        if (isDraggingFavorite) return;
        touchStartX.current = e.targetTouches[0].clientX;
        touchCurrentX.current = touchStartX.current;
        isDraggingMenu.current = isMenuOpen ? true : touchStartX.current < 50;
        if (isDraggingMenu.current) {
            setIsMenuTransitioning(false);
        }
    };

    const handleTouchMove = (e) => {
        if (!isDraggingMenu.current) return;
        touchCurrentX.current = e.targetTouches[0].clientX;
    };

    const handleTouchEnd = () => {
        if (!isDraggingMenu.current) return;
        isDraggingMenu.current = false;
        setIsMenuTransitioning(true);
        const diff = touchCurrentX.current - touchStartX.current;
        if (isMenuOpen) {
            if (diff < -50) {
                setIsMenuOpen(false);
                setMenuTranslateX(-menuWidth);
            } else {
                setMenuTranslateX(0);
            }
        } else {
            if (diff > 50) {
                setIsMenuOpen(true);
                setMenuTranslateX(0);
            } else {
                setMenuTranslateX(-menuWidth);
            }
        }
    };

    useEffect(() => {
        window.addEventListener('touchstart', handleTouchStart);
        window.addEventListener('touchmove', handleTouchMove);
        window.addEventListener('touchend', handleTouchEnd);
        return () => {
            window.removeEventListener('touchstart', handleTouchStart);
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleTouchEnd);
        };
    }, [isMenuOpen]);

    if (showCredentialsModal) return <CredentialsModal onSave={handleSaveCredentials} onClose={() => setShowCredentialsModal(false)} />;
    if (isOffline && threads.length === 0) {
        return (
            <div className="text-center text-gray-300 p-8 flex flex-col justify-center items-center h-screen">
                <h2 className="text-2xl font-bold mb-4">You are Offline</h2>
                <p className="mb-6">No cached content available. Please connect to the internet to fetch posts.</p>
            </div>
        );
    }
    if (isLoading && threads.length === 0) return <div className="loader"></div>;
    if (error) return (<div className="text-center text-red-400 p-8"><h2 className="text-2xl font-bold mb-4">An Error Occurred</h2><p className="mb-6">{error}</p><button onClick={() => setIsCredentialsModalOpen(true)} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded-md">Enter Credentials Again</button></div>);

    return (
        <div className="bg-slate-900 min-h-screen">
            {cacheNotice && <div role="status" className="cache-notice fixed z-40 left-4 right-4 max-w-xl mx-auto bg-slate-700 text-white rounded-lg p-3 shadow-lg flex items-start gap-3"><p className="flex-1 text-sm">{cacheNotice}</p><button aria-label="Dismiss cache notice" onClick={() => setCacheNotice('')}>×</button></div>}
            {viewingContent && <MediaViewer items={viewingContent.items} startIndex={viewingContent.startIndex} onClose={handleCloseMediaViewer} animationState={mediaViewerAnimationState} onAnimationEnd={onMediaViewerAnimationEnd} />}
            {viewingArticle && <ArticleViewer url={viewingArticle} onClose={handleCloseArticle} animationState={articleAnimationState} onAnimationEnd={onArticleAnimationEnd} />}
            <SubredditModal isOpen={showSubredditModal} onClose={() => setShowSubredditModal(false)} onSelectSubreddit={handleSelectSubreddit} />
            <SortModal isOpen={showSortModal} onClose={() => setShowSortModal(false)} onSelectSort={handleSelectSort} selectedSort={currentSort} />
            <SortModal isOpen={showCommentSortModal} onClose={() => setShowCommentSortModal(false)} onSelectSort={handleSelectCommentSort} selectedSort={resolvedCommentSort} isCommentSort={true} isDefaultSort={commentSort === 'default'} />
            <ClearCacheModal isOpen={showClearCacheModal} onClose={() => setShowClearCacheModal(false)} onConfirm={handleConfirmClearCache} />
            <MoreOptionsMenu
                isOpen={showMoreMenu}
                onClose={() => setShowMoreMenu(false)}
                onClearCache={() => { setShowMoreMenu(false); setShowClearCacheModal(true); }}
                onCredentials={() => { setShowMoreMenu(false); setIsCredentialsModalOpen(true); }}
            />
            {isCredentialsModalOpen && (
                <CredentialsModal
                    onSave={handleSaveCredentials}
                    onClose={() => setIsCredentialsModalOpen(false)}
                    initialClientId={localStorage.getItem('redditClientId') || ''}
                    initialSecret={localStorage.getItem('redditSecret') || ''}
                    initialRapidApiKey={localStorage.getItem('rapidApiKey') || ''}
                />
            )}
            <SideMenu
                isOpen={isMenuOpen}
                onClose={handleMenuToggle}
                favorites={favorites}
                onReorderFavorites={handleReorderFavorites}
                onFavoriteSelect={handleFavoriteSelect}
                onRemoveFavorite={handleRemoveFavorite}
                onSelectCachedFeed={handleSelectCachedFeed}
                translateX={menuTranslateX}
                isTransitioning={isMenuTransitioning}
                setIsDraggingFavorite={setIsDraggingFavorite}
            />
            <div className="max-w-2xl mx-auto">
                <div className={`transition-opacity duration-300 ${isDetailActive ? 'opacity-0' : 'opacity-100'}`}>
                    <MainHeader onMenuToggle={handleMenuToggle} isVisible={showNav} isActive={!isDetailActive} currentSubreddit={currentSubreddit} isFavorite={favorites.includes(currentSubreddit)} onToggleFavorite={handleToggleFavorite} sortType={currentSort} />
                </div>
                <div className={`transition-opacity duration-300 ${isDetailActive ? 'opacity-100' : 'opacity-0'}`}>
                    <DetailHeader onBackPress={handleBackPress} isVisible={showNav} isActive={isDetailActive} currentSubreddit={selectedThread?.subreddit} isFavorite={favorites.includes(selectedThread?.subreddit)} onToggleFavorite={handleToggleFavorite} commentSort={resolvedCommentSort} />
                </div>
                <main className="app-main overflow-clip pt-16 pb-16">
                    <div className={`view-container ${isDetailActive ? 'detail-active' : ''}`}>
                        <div className="view-pane">
                            <div className="p-2 md:p-4 relative">
                                {isRefreshing && <div className="loader" style={{ position: 'absolute', top: '20px', left: 'calc(50% - 10vmin)' }}></div>}
                                {threads.map((thread, index) => <SwipeableThreadCard key={thread.id} thread={thread} onClick={handleThreadClick} onLongPress={handleThreadLongPress} isHighlighted={highlightedThreads.has(thread.id)} onContentClick={handleContentClick} onTxtifyArticle={handleTxtifyArticle} animationState={cardAnimationState} index={index} />)}
                                {!isLoading && nextPageCursor && (
                                    <div className="flex justify-center mt-4">
                                        <button onClick={() => fetchThreads(currentSubreddit, nextPageCursor)} disabled={isLoadingMore} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded-md transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed">
                                            {isLoadingMore ? 'Loading...' : 'Load More'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="view-pane"><ThreadDetail ref={threadDetailRef} thread={selectedThread} accessToken={accessToken} onContentClick={handleContentClick} onTxtifyArticle={handleTxtifyArticle} commentSort={commentSort} onCommentSortLoaded={setResolvedCommentSort} onToggleComments={handleToggleAllComments} onScrollToParent={handleScrollToParent} currentParentCommentIndex={currentParentCommentIndex} areAllCommentsCollapsed={areAllCommentsCollapsed} /></div>
                    </div>
                </main>
                <BottomNav isVisible={showNav} view={isDetailActive ? 'detail' : 'list'} onRefreshFeed={handleRefreshFeed} onRefreshComments={handleRefreshComments} onOpenSubredditModal={handleOpenSubredditModal} onOpenSortModal={handleOpenSortModal} onOpenMoreModal={handleOpenMoreMenu} onCacheHighlighted={handleCacheHighlighted} highlightedCount={highlightedThreads.size} isCaching={isCaching} onToggleComments={handleToggleAllComments} onScrollToParent={handleScrollToParent} />
            </div>
        </div>
    );
}

ReactDOM.render(<App />, document.getElementById('root'));
