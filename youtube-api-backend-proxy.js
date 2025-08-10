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

// Accepts a video ID and returns resolution & aspect ratio
function getVideoFormat(videoId) {
    const now = Date.now();

    // Cache miss or expired, run yt-dlp
    return new Promise((resolve, reject) => {
        const command = `yt-dlp -j --no-warnings --skip-download https://www.youtube.com/watch?v=${videoId}`;
        
        console.log(`🔍 [Backend] Running yt-dlp for video: ${videoId}`);
        
        exec(command, { 
            maxBuffer: 1024 * 1024,
            timeout: 30000 // 30 second timeout
        }, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ [Backend] yt-dlp error for ${videoId}:`, error.message);
                return reject(new Error(`yt-dlp failed for ${videoId}: ${error.message}`));
            }
            
            if (stderr) {
                console.warn(`⚠️ [Backend] yt-dlp stderr for ${videoId}:`, stderr);
            }
            
            try {
                const metadata = JSON.parse(stdout);
                const { width, height } = metadata;
                const aspectRatio = width && height ? (width / height).toFixed(2) : null;
                
                console.log(`📐 [Backend] Video ${videoId}: ${width}x${height} (ratio: ${aspectRatio})`);
                
                const result = { videoId, width, height, aspectRatio };

                resolve(result);
            } catch (parseError) {
                console.error(`❌ [Backend] JSON parse error for ${videoId}:`, parseError.message);
                reject(new Error(`Failed to parse yt-dlp output for ${videoId}: ${parseError.message}`));
            }
        });
    });
}

function isProbablyShortVideo({ width, height, aspectRatio }) {
    if (!width || !height || !aspectRatio) {
        console.log('⚠️ [Backend] Missing dimensions, assuming not a short');
        return false; // If we can't determine, assume it's not a short
    }
    
    const ratio = parseFloat(aspectRatio);
    const isShort = ratio < 0.8; // Tall portrait format
    
    console.log(`📱 [Backend] Aspect ratio ${ratio} - ${isShort ? 'SHORT' : 'REGULAR'}`);
    
    return isShort;
}

// Heuristic check for shorts based on duration and title
// This is a simple heuristic and may not be 100% accurate
function isHeuristicallyShort(video) {
    try {
        const durationISO = video.contentDetails?.duration || '';
        const title = video.snippet?.title?.toLowerCase() || '';

        // Parse duration (e.g., PT59S, PT1M12S)
        const durationMatch = durationISO.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
        if (!durationMatch) return false;

        const hours = parseInt(durationMatch[1]) || 0;
        const minutes = parseInt(durationMatch[2]) || 0;
        const seconds = parseInt(durationMatch[3]) || 0;
        const totalSeconds = hours * 3600 + minutes * 60 + seconds;

        const isShortByTime = totalSeconds <= 120; // 2 minutes in seconds
        const isShortByTitle = title.includes('#shorts') || title.includes('#short');

        return isShortByTime || isShortByTitle;
    } catch (e) {
        console.warn('⚠️ Heuristic check failed:', e.message);
        return false;
    }
}

// Process videos in batches with priority and progress updates
async function processVideosInBatches(videoIds, batchSize = 30, progressCallback = null) {
    const results = [];
    const totalBatches = Math.ceil(videoIds.length / batchSize);
    
    console.log(`🔄 [Backend] Processing ${videoIds.length} videos in ${totalBatches} batches of ${batchSize}`);
    
    for (let i = 0; i < videoIds.length; i += batchSize) {
        const batchNumber = Math.floor(i / batchSize) + 1;
        const batch = videoIds.slice(i, i + batchSize);
        
        console.log(`📦 [Backend] Processing batch ${batchNumber}/${totalBatches}: ${batch.length} videos`);
        
        const batchPromises = batch.map(id => 
            limit(() => getVideoFormat(id).catch(err => ({ 
                videoId: id, 
                error: err.message,
                status: 'error'
            })))
        );
        
        const batchResults = await Promise.allSettled(batchPromises);
        
        // Process batch results
        const processedBatch = batchResults.map(result => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                return {
                    videoId: 'unknown',
                    error: result.reason?.message || 'Unknown error',
                    status: 'error'
                };
            }
        });
        
        results.push(...processedBatch);
        
        console.log(`✅ [Backend] Batch ${batchNumber} completed. Total processed: ${results.length}/${videoIds.length}`);
        
        // Call progress callback if provided
        if (progressCallback) {
            progressCallback({
                processed: results.length,
                total: videoIds.length,
                currentBatch: batchNumber,
                totalBatches: totalBatches,
                batchResults: processedBatch
            });
        }
    }
    
    console.log(`🎉 [Backend] All batches completed. Total results: ${results.length}`);
    return results;
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

        // Step 2: Process metadata to filter shorts
        // Filter out shorts using heuristic method only
        const filteredChunks = chunks.filter(item => !isHeuristicallyShort(item));
        console.log('🎯 [Backend] Videos after filtering shorts:', filteredChunks.length);

        // Send the final response
        res.json({ items: filteredChunks });        

    } catch (error) {
        console.error('❌ [Backend] Error in /videos/metadata:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add this after your existing /api/youtube/videos/metadata endpoint
app.post('/api/youtube/videos/metadata/stream', async (req, res) => {
    try {
        const { videoIds, batchSize = 50 } = req.body;
        const API_KEY = process.env.YOUTUBE_API_KEY;

        console.log('🔍 [Backend] Streaming video IDs:', videoIds?.length);

        if (!videoIds || !Array.isArray(videoIds)) {
            return res.status(400).json({ error: 'videoIds must be an array' });
        }

        if (videoIds.length === 0) {
            console.log('⚠️ [Backend] Empty video IDs array');
            res.writeHead(200, {
                'Content-Type': 'application/x-ndjson',
                'Transfer-Encoding': 'chunked',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });
            res.write(JSON.stringify({ type: 'complete', totalVideos: 0, totalBatches: 0 }) + '\n');
            res.end();
            return;
        }

        // Set up streaming response
        res.writeHead(200, {
            'Content-Type': 'application/x-ndjson',
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        const totalBatches = Math.ceil(videoIds.length / batchSize);
        let processedCount = 0;
        const allFilteredVideos = [];

        for (let i = 0; i < videoIds.length; i += batchSize) {
            const batchNumber = Math.floor(i / batchSize) + 1;
            const batch = videoIds.slice(i, i + batchSize);
            
            console.log(`📦 [Backend] Processing batch ${batchNumber}/${totalBatches}: ${batch.length} videos`);
            
            // Fetch metadata for this batch
            const idsParam = batch.join(',');
            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${idsParam}&key=${API_KEY}`
            );
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ [Backend] YouTube API error:', response.status, errorText);
                continue; // Skip this batch but continue with others
            }
            
            const data = await response.json();
            const batchItems = data.items || [];
            
            // Filter shorts from this batch
            const filteredBatchVideos = batchItems.filter(item => !isHeuristicallyShort(item));
            
            allFilteredVideos.push(...filteredBatchVideos);
            processedCount += batch.length;

            // Stream this batch immediately
            const batchResponse = {
                type: 'batch',
                batchNumber,
                totalBatches,
                videos: filteredBatchVideos,
                processedCount,
                totalProcessed: processedCount,
                totalToProcess: videoIds.length
            };
            
            res.write(JSON.stringify(batchResponse) + '\n');
            
            console.log(`✅ [Backend] Streamed batch ${batchNumber}: ${filteredBatchVideos.length} videos passed filter`);
        }
        
        // Send completion signal
        const completeResponse = {
            type: 'complete',
            totalVideos: allFilteredVideos.length,
            totalBatches,
        };
        
        res.write(JSON.stringify(completeResponse) + '\n');
        res.end();
        
        console.log(`🎉 [Backend] Streaming complete. Total filtered videos: ${allFilteredVideos.length}`);

    } catch (error) {
        console.error('❌ [Backend] Error in /videos/metadata/stream:', error);
        
        const errorResponse = {
            type: 'error',
            message: error.message
        };
        
        res.write(JSON.stringify(errorResponse) + '\n');
        res.end();
    }
});

app.get('/api/youtube/channel/:channelId/videos', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { maxResults = 6 } = req.query;
        const API_KEY = process.env.YOUTUBE_API_KEY;
        
        console.log('Fetching videos for channel:', channelId);

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
        console.log('Search API returned:', data.items?.length || 0, 'items');
        
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

// Endpoint to get video details by video IDs
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