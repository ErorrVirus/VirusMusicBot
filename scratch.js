const url = 'https://www.youtube.com/playlist?list=PL4lCaoEsuuMxhA_rO8K8l6tWd2mR2t5uL';

fetch(url)
    .then(res => res.text())
    .then(text => {
        // Find ytInitialData
        const match = text.match(/var ytInitialData = (\{.*?\});<\/script>/) || text.match(/window\["ytInitialData"\] = (\{.*?\});/);
        if (match) {
            const data = JSON.parse(match[1]);
            const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs;
            if (tabs) {
                const playlistData = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents[0]?.itemSectionRenderer?.contents[0]?.playlistVideoListRenderer;
                if (playlistData) {
                    const tracks = playlistData.contents.map(c => {
                        const video = c.playlistVideoRenderer;
                        if (!video) return null;
                        return {
                            title: video.title?.runs[0]?.text,
                            author: video.shortBylineText?.runs[0]?.text
                        };
                    }).filter(Boolean);
                    console.log('Playlist Tracks:', tracks.slice(0, 5));
                }
            }
        }
    })
    .catch(console.error);
