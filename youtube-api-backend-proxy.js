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

app.get('/api/youtube/channel/:channelId/videos', async (req, res) => {
    
    // Helper function to filter out shorts
    function isShort(duration) {
        if (!duration) return false;
        
        const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
        if (!match) return false;
        
        const hours = parseInt((match[1] || '').replace('H', '')) || 0;
        const minutes = parseInt((match[2] || '').replace('M', '')) || 0;
        const seconds = parseInt((match[3] || '').replace('S', '')) || 0;
        
        const totalSeconds = hours * 3600 + minutes * 60 + seconds;
        return totalSeconds <= 60; // Consider videos 60 seconds or less as shorts
    }

    try {
        const { channelId } = req.params;
        const { maxResults = 6 } = req.query;
        const API_KEY = process.env.YOUTUBE_API_KEY;
        
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&maxResults=${maxResults}&order=date&type=video&key=${API_KEY}`
        );
        
        const data = await response.json();
        
        // Filter out shorts (videos under 60 seconds) by getting video details
        if (data.items && data.items.length > 0) {
            const videoIds = data.items.map(item => item.id.videoId).join(',');
            const detailsResponse = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${API_KEY}`
            );
            const detailsData = await detailsResponse.json();
            
            // Filter videos longer than 60 seconds
            const filteredItems = data.items.filter((item, index) => {
                const duration = detailsData.items[index]?.contentDetails?.duration;
                return !isShort(duration);
            }).slice(0, maxResults);
            
            data.items = filteredItems;
        }
        
        res.json(data);
    } catch (error) {
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// .env file (create this in your project root):
// YOUTUBE_API_KEY=your_actual_youtube_api_key_here