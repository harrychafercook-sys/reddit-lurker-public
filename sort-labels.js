export const TOP_RANGE_LABELS = {
    day: 'Today', week: 'This week', month: 'This month', year: 'This year', all: 'All time',
};

const SORT_LABELS = {
    best: 'Best', hot: 'Hot', new: 'New', rising: 'Rising', top: 'Top',
    controversial: 'Controversial', old: 'Old', qa: 'Q&A', 'q&a': 'Q&A', random: 'Random', live: 'Live',
};

export function getSortLabel(sort = '') {
    const [type, range] = sort.split('-');
    if (type === 'top' && TOP_RANGE_LABELS[range]) return `Top · ${TOP_RANGE_LABELS[range]}`;
    return SORT_LABELS[type] || sort;
}
