// backend-server.js - Simple Express.js proxy server
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve your frontend files

// Health check endpoint
app.get('/api/youtube/health', (req, res) => {
    res.json({ status: 'OK', message: 'YouTube API proxy is running' });
});

// YouTube API proxy endpoints
app.get('/api/youtube/channel/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const API_KEY = process.env.YOUTUBE_API_KEY;
        
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${API_KEY}`
        );
        
        if (!response.ok) {
            throw new Error(`YouTube API error: ${response.status}`);
        }
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper function to filter out shorts
// function isShort(duration) {
//     if (!duration) return false;
    
//     const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
//     if (!match) return false;
    
//     const hours = parseInt((match[1] || '').replace('H', '')) || 0;
//     const minutes = parseInt((match[2] || '').replace('M', '')) || 0;
//     const seconds = parseInt((match[3] || '').replace('S', '')) || 0;
    
//     const totalSeconds = hours * 3600 + minutes * 60 + seconds;
//     return totalSeconds <= 60; // Consider videos 60 seconds or less as shorts
// }

const { exec } = require('child_process');

// Accepts a video ID and returns resolution & aspect ratio
function getVideoFormat(videoId) {
    return new Promise((resolve, reject) => {
        const command = `yt-dlp -j https://www.youtube.com/watch?v=${videoId}`;
        exec(command, { maxBuffer: 1024 * 1024 }, (error, stdout) => {
            if (error) return reject(error);
            try {
                const metadata = JSON.parse(stdout);
                const { width, height } = metadata;
                const aspectRatio = width && height ? (width / height).toFixed(2) : null;
                resolve({ videoId, width, height, aspectRatio });
                // resolve({ width, height, aspectRatio });
            } catch (e) {
                reject(e);
            }
        });
    });
}

function isProbablyShortVideo({ width, height, aspectRatio }) {
    return (
        width && height &&
        aspectRatio && parseFloat(aspectRatio) < 0.8 // Tall portrait format
    );
}

// Accept list of video IDs for metadata fetch (title, duration, etc.)
app.post('/api/youtube/videos/metadata', async (req, res) => {
    try {
        const { videoIds } = req.body;
        const API_KEY = process.env.YOUTUBE_API_KEY;

        console.log('🔍 [Backend] Received video IDs:', videoIds);

        if (!videoIds || !Array.isArray(videoIds)) {
            return res.status(400).json({ error: 'videoIds must be an array' });
        }

        if (videoIds.length === 0) {
            console.log('⚠️ [Backend] Empty video IDs array');
            return res.json({ items: [] });
        }

        // Step 1: Fetch metadata from YouTube API
        const chunks = [];
        for (let i = 0; i < videoIds.length; i += 50) {
            const chunk = videoIds.slice(i, i + 50);
            const idsParam = chunk.join(',');
            
            console.log(`📡 [Backend] Fetching chunk ${Math.floor(i/50) + 1}: ${chunk.length} videos`);
            
            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${idsParam}&key=${API_KEY}`
            );
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ [Backend] YouTube API error:', response.status, errorText);
                throw new Error(`YouTube API error: ${response.status} - ${errorText}`);
            }
            
            const data = await response.json();
            console.log(`📊 [Backend] Chunk ${Math.floor(i/50) + 1} returned:`, data.items?.length || 0, 'items');
            chunks.push(...(data.items || []));
        }

        console.log('📋 [Backend] Total metadata items fetched:', chunks.length);

        // Step 2: Extract video IDs for yt-dlp (skip this for now to isolate the issue)
        // Let's first return all videos without yt-dlp filtering
        console.log('🎬 [Backend] Returning all videos without filtering');
        res.json({ items: chunks });

        // Comment out the yt-dlp filtering temporarily:
        /*
        const ytDlpChecks = await Promise.allSettled(
            chunks.map(item => getVideoFormat(item.id))
        );

        console.log('🔍 [Backend] yt-dlp checks completed:', ytDlpChecks.length);
        console.log('✅ [Backend] Successful checks:', ytDlpChecks.filter(r => r.status === 'fulfilled').length);
        console.log('❌ [Backend] Failed checks:', ytDlpChecks.filter(r => r.status === 'rejected').length);

        const allowedVideoIds = ytDlpChecks
            .filter(result => result.status === 'fulfilled')
            .map(result => result.value)
            .filter(format => !isProbablyShortVideo(format))
            .map(format => format.videoId);

        console.log('🎯 [Backend] Videos after filtering shorts:', allowedVideoIds.length);

        const filteredChunks = chunks.filter(item =>
            allowedVideoIds.includes(item.id)
        );

        console.log('📋 [Backend] Final filtered chunks:', filteredChunks.length);
        res.json({ items: filteredChunks });
        */
        
    } catch (error) {
        console.error('❌ [Backend] Error in /videos/metadata:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/youtube/channel/:channelId/videos', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { maxResults = 6 } = req.query;
        const API_KEY = process.env.YOUTUBE_API_KEY;
        
        console.log('Fetching videos for channel:', channelId); // Debug log

        // Request more videos initially to account for filtering
        const requestCount = parseInt(maxResults) * 4 ; // Request maxResults*4 videos by default, may adjust based on my needs
        
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&maxResults=${requestCount}&order=date&type=video&key=${API_KEY}`
        );
        if (!response.ok) {
            const errorText = await response.text();
            console.error('YouTube API error:', response.status, errorText);
            throw new Error(`YouTube API error: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        console.log('Search API returned:', data.items?.length || 0, 'items'); // Debug log
        
        // Return the raw search results - don't filter here
        res.json(data);
    } catch (error) {
        console.error('Error in /channel/:channelId/videos:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add playlist endpoints
app.get('/api/youtube/playlist/:playlistId', async (req, res) => {
    try {
        const { playlistId } = req.params;
        const API_KEY = process.env.YOUTUBE_API_KEY;
        
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&id=${playlistId}&key=${API_KEY}`
        );
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/youtube/playlist/:playlistId/videos', async (req, res) => {
    try {
        const { playlistId } = req.params;
        const { maxResults = 6 } = req.query;
        const API_KEY = process.env.YOUTUBE_API_KEY;
        
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${maxResults}&key=${API_KEY}`
        );
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper endpoint to extract channel ID from URL
app.post('/api/youtube/extract-channel-id', async (req, res) => {
    try {
        const { url } = req.body;
        const API_KEY = process.env.YOUTUBE_API_KEY;
        
        // In extract-channel-id endpoint, add playlist detection:
        if (url.includes('list=')) {
            const playlistId = url.split('list=')[1].split('&')[0];
            return res.json({ playlistId, type: 'playlist' });
        }

        // Extract channel ID from various YouTube URL formats
        let channelId = null;

        if (url.includes('/channel/')) {
            channelId = url.split('/channel/')[1].split('?')[0];
        } else if (url.includes('@')) {
            // Handle @username format
            const username = url.split('@')[1].split('?')[0];
            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(username)}&key=${API_KEY}&maxResults=1`
            );
            const data = await response.json();
            if (data.items && data.items.length > 0) {
                channelId = data.items[0].snippet.channelId;
            }
        } else if (url.includes('/c/') || url.includes('/user/')) {
            const username = url.split('/').pop().split('?')[0];
            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(username)}&key=${API_KEY}&maxResults=1`
            );
            const data = await response.json();
            if (data.items && data.items.length > 0) {
                channelId = data.items[0].snippet.channelId;
            }
        }

        if (!channelId) {
            throw new Error('Could not extract channel ID from URL');
        }
        
        res.json({ channelId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to get video details by video IDs (video duration)
app.get('/api/youtube/videos/:videoIds', async (req, res) => {
    try {
        const { videoIds } = req.params;
        const API_KEY = process.env.YOUTUBE_API_KEY;
        
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${API_KEY}`
        );
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// .env file (create this in your project root):
// YOUTUBE_API_KEY=your_actual_youtube_api_key_here