(() => {
    const keys = ['redditClientId', 'redditSecret', 'rapidApiKey', 'favorites', 'displayZoom'];
    return {
        read() {
            const values = {};
            for (const key of keys) {
                const value = localStorage.getItem(key);
                if (value !== null) values[key] = value;
            }
            return values;
        },
        write(values) {
            // A retry never overwrites settings already saved on the hosted origin.
            for (const key of keys) {
                if (typeof values[key] === 'string' && localStorage.getItem(key) === null) {
                    localStorage.setItem(key, values[key]);
                }
            }
            return true;
        }
    };
})()
