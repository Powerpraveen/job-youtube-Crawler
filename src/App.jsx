import React, { useState } from 'react';

// Advanced Date Parsing
const parseDate = (dateString) => {
    if (!dateString) return null;
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    let parts = dateString.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (parts) {
        const day = parseInt(parts[1], 10);
        const month = parseInt(parts[2], 10) - 1;
        let year = parseInt(parts[3], 10);
        if (year < 100) year += 2000;
        const date = new Date(Date.UTC(year, month, day));
        if (!isNaN(date.getTime())) return date;
    }
    parts = dateString.replace(/, /g, ' ').match(/(?:(\d{1,2}) )?([a-z]{3,}) (\d{1,2})?(?:, )?(\d{4})/i);
    if (parts) {
        const monthStr = parts[2].substring(0, 3).toLowerCase();
        if (months[monthStr] !== undefined) {
            const day = parseInt(parts[1] || parts[3], 10);
            const month = months[monthStr];
            const year = parseInt(parts[4], 10);
            const date = new Date(Date.UTC(year, month, day));
            if (!isNaN(date.getTime())) return date;
        }
    }
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) return date;
    return null;
};

const JOBS_PER_PAGE = 10;

// Main App Component
export default function App() {
    const [url, setUrl] = useState('');
    const [youtubeHandle, setYoutubeHandle] = useState('');
    const [apiKey, setApiKey] = useState('');

    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [copiedJob, setCopiedJob] = useState(null);
    const [status, setStatus] = useState('');
    const [page, setPage] = useState(1);

    const totalPages = Math.ceil(jobs.length / JOBS_PER_PAGE);
    const jobsToShow = jobs.slice((page - 1) * JOBS_PER_PAGE, page * JOBS_PER_PAGE);

    const fetchHtml = async (targetUrl, proxy = true) => {
        const fetchUrl = proxy ? `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}` : targetUrl;
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error(`Failed to fetch ${targetUrl}`);
        const data = await response.json();
        return data.contents;
    };

    const getChannelVideos = async (handle, key) => {
        if (!handle || !key) return [];
        try {
            const searchResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?part=id&q=${handle.replace('@', '')}&type=channel&key=${key}`);
            const searchData = await searchResponse.json();
            if (!searchData.items || searchData.items.length === 0) throw new Error(`Could not find channel with handle: ${handle}`);
            const channelId = searchData.items[0].id.channelId;
            const channelResponse = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${key}`);
            const channelData = await channelResponse.json();
            const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads;
            let allVideos = [];
            let nextPageToken = '';
            do {
                const playlistResponse = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50&pageToken=${nextPageToken}&key=${key}`);
                const playlistData = await playlistResponse.json();
                allVideos = allVideos.concat(playlistData.items);
                nextPageToken = playlistData.nextPageToken;
            } while (nextPageToken);
            return allVideos.map(item => ({ title: item.snippet.title.toLowerCase(), url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}` }));
        } catch (err) {
            throw new Error(`Failed to fetch YouTube videos: ${err.message}`);
        }
    };
    
    const findMatchingYouTubeVideo = (jobTitle, videoList) => {
        if (!jobTitle || videoList.length === 0) return null;
        const lowerJobTitle = jobTitle.toLowerCase();
        const perfectMatch = videoList.find(video => video.title.includes(lowerJobTitle));
        if (perfectMatch) return perfectMatch.url;
        const jobTitleWords = lowerJobTitle.split(' ').filter(w => w.length > 3);
        for (const video of videoList) {
            const matchCount = jobTitleWords.reduce((count, word) => video.title.includes(word) ? count + 1 : count, 0);
            if (matchCount >= 3) return video.url;
        }
        return null;
    };

    const findEmbeddedYouTubeLink = (doc) => {
        const iframe = doc.querySelector('iframe[src*="youtube.com/embed/"]');
        if (iframe && iframe.src) return iframe.src;

        const anchor = doc.querySelector('a[href*="youtube.com/watch"], a[href*="youtu.be/"]');
        if (anchor && anchor.href) return anchor.href;

        return null;
    };

    const handleFetchJobs = async () => {
        if (!url) {
            setError('Please enter a website URL.');
            return;
        }
        setIsLoading(true);
        setError('');
        setJobs([]);
        setCopiedJob(null);
        setPage(1);

        try {
            let channelVideos = [];
            const useApi = youtubeHandle && apiKey;
            if (useApi) {
                setStatus('Step 1/4: Fetching videos from YouTube channel...');
                channelVideos = await getChannelVideos(youtubeHandle, apiKey);
            }

            setStatus(`Step ${useApi ? '2' : '1'}/${useApi ? '4' : '3'}: Fetching main page...`);
            const mainHtml = await fetchHtml(url);
            const parser = new DOMParser();
            const mainDoc = parser.parseFromString(mainHtml, 'text/html');
            const postLinks = new Set();
            const jobUrlKeywords = ['job', 'career', 'vacancy', 'hiring', 'position'];
            mainDoc.querySelectorAll('article a, .post a, .job-listing a, h2 a, h3 a').forEach(link => {
                let href = link.href;
                if (href && !href.startsWith('http')) {
                    try { href = new URL(href, url).href; } catch (e) { return; }
                }
                if (href && href.startsWith(new URL(url).origin) && jobUrlKeywords.some(keyword => link.innerText.toLowerCase().includes(keyword) || href.toLowerCase().includes(keyword))) {
                    postLinks.add(href);
                }
            });

            const uniqueLinks = Array.from(postLinks);
            if (uniqueLinks.length === 0) throw new Error('Could not find any potential job post links.');

            setStatus(`Step ${useApi ? '3' : '2'}/${useApi ? '4' : '3'}: Analyzing ${uniqueLinks.length} links...`);
            const promises = uniqueLinks.map(link => fetchHtml(link).then(html => ({ url: link, html })).catch(() => null));
            const results = (await Promise.all(promises)).filter(r => r && r.html);
            
            setStatus(`Step ${useApi ? '4' : '3'}/${useApi ? '4' : '3'}: Verifying posts...`);
            const foundJobs = [];
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const findTitle = (doc) => {
                const selectors = ['h1.entry-title', 'h2.entry-title', 'h1.post-title', 'article h1', 'main h1', '.entry-content h1', 'h1'];
                for (const selector of selectors) {
                    const element = doc.querySelector(selector);
                    if (element && element.innerText.trim()) return element.innerText.trim();
                }
                return 'Post Title Not Found';
            };

            for (const result of results) {
                const postParser = new DOMParser();
                const postDoc = postParser.parseFromString(result.html, 'text/html');
                const title = findTitle(postDoc);
                const deadlineMatch = result.html.match(/(?:last date|closing date|deadline|apply by)[\s:.-]*([\w\s,./-]+\d{1,4})/i);

                if (deadlineMatch && deadlineMatch[1]) {
                    const jobKeywords = ['qualification', 'experience', 'salary', 'location', 'apply', 'responsibilit'];
                    const score = jobKeywords.reduce((s, kw) => result.html.toLowerCase().includes(kw) ? s + 1 : s, 0);

                    if (score >= 2) {
                        const lastDate = parseDate(deadlineMatch[1].trim());
                        if (lastDate && lastDate >= today) {
                            let youtubeLink = null;
                            if (useApi) {
                                youtubeLink = findMatchingYouTubeVideo(title, channelVideos);
                            }
                            if (!youtubeLink) {
                                youtubeLink = findEmbeddedYouTubeLink(postDoc);
                            }
                            if (!foundJobs.some(job => job.link === result.url)) {
                                foundJobs.push({ title, link: result.url, lastDate, youtubeLink });
                            }
                        }
                    }
                }
            }

            if (foundJobs.length === 0) {
                setError('Scan complete. No jobs with future deadlines were found.');
            } else {
                setJobs(foundJobs.sort((a, b) => a.lastDate - b.lastDate));
            }
        } catch (err) {
            setError(`An error occurred: ${err.message}`);
        } finally {
            setIsLoading(false);
            setStatus('');
        }
    };

    const getShareText = (job) => {
        let text = `Post: ${job.title}\nLast date: ${job.lastDate.toLocaleDateString('en-GB')}`;
        if (job.youtubeLink) text += `\nVideo Link: ${job.youtubeLink}`;
        text += `\nApply Now: ${job.link}`;
        return text;
    };
    const getWhatsAppLink = (job) => `https://wa.me/?text=${encodeURIComponent(getShareText(job))}`;
    const handleCopy = (job) => {
        navigator.clipboard.writeText(getShareText(job));
        setCopiedJob(job.link);
        setTimeout(() => setCopiedJob(null), 2000);
    };
    const handleNativeShare = (job) => {
        if (navigator.share) {
            navigator.share({ title: job.title, text: getShareText(job), url: job.link });
        } else {
            handleCopy(job);
        }
    };
    
    const goToPrevPage = () => setPage(p => Math.max(1, p - 1));
    const goToNextPage = () => setPage(p => Math.min(totalPages, p + 1));

    return (
        <div className="bg-gray-50 min-h-screen flex items-center justify-center font-sans p-4">
            <div className="w-full max-w-3xl bg-white rounded-xl shadow-lg p-6 md:p-8">
                <div className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-bold text-gray-800">Job Deadline Crawler</h1>
                    <p className="text-gray-500 mt-2">Find job deadlines and related YouTube videos.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Website to Scan</label>
                        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/careers" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">YouTube Channel Handle (Optional)</label>
                        <input type="text" value={youtubeHandle} onChange={(e) => setYoutubeHandle(e.target.value)} placeholder="@channelHandle" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">YouTube API Key (Optional)</label>
                        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Enter API Key to search a specific channel" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                    </div>
                </div>
                <button onClick={handleFetchJobs} disabled={isLoading} className="w-full bg-indigo-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-indigo-700 disabled:bg-indigo-300 transition shadow-md">
                    {isLoading ? 'Crawling...' : 'Start Scan'}
                </button>
                {isLoading && <div className="text-center p-4"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-3"></div><p className="text-indigo-600 font-semibold">{status}</p></div>}
                {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg text-center mt-4" role="alert"><p>{error}</p></div>}
                {jobs.length > 0 && (
                    <div className="mt-8">
                        <h2 className="text-2xl font-bold text-gray-700 mb-4 border-b pb-2">Upcoming Deadlines Found</h2>
                        <ul className="space-y-4">
                            {jobsToShow.map((job) => (
                                <li key={job.link} className="p-4 bg-gray-50 rounded-lg border-l-4 border-green-500">
                                    <div className="flex-grow">
                                        <a href={job.link} target="_blank" rel="noopener noreferrer" className="text-lg font-semibold text-indigo-700 hover:underline">{job.title}</a>
                                        <p className="text-sm font-semibold text-red-600 mt-1">Last Date to Apply: {job.lastDate.toLocaleDateString('en-GB')}</p>
                                        {job.youtubeLink && (
                                            <p className="text-sm font-semibold text-blue-600 mt-1">
                                                Video Link: <a href={job.youtubeLink} target="_blank" rel="noopener noreferrer" className="font-normal underline hover:text-blue-800">Watch on YouTube</a>
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        <a href={getWhatsAppLink(job)} target="_blank" rel="noopener noreferrer" className="bg-green-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-green-600 transition text-sm">WhatsApp</a>
                                        <button onClick={() => handleCopy(job)} className="bg-teal-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-teal-600 transition text-sm">{copiedJob === job.link ? 'Copied!' : 'Copy'}</button>
                                        <button onClick={() => handleNativeShare(job)} className="bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-600 transition text-sm">Share</button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                        <div className="flex justify-between mt-6 items-center">
                            <button disabled={page === 1} onClick={goToPrevPage} className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50">Previous</button>
                            <span>Page {page} of {totalPages}</span>
                            <button disabled={page === totalPages} onClick={goToNextPage} className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50">Next</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
