// Enhanced YouTube API Class with Playlist Support
class YouTubeAPI {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://www.googleapis.com/youtube/v3';
        this.lastRefreshData = new Map(); // Store last refresh data for "new" detection
    }

    // Existing channel methods
    async getChannelId(channelInput) {
        try {
            if (channelInput.startsWith('UC')) {
                return channelInput;
            }

            let username = channelInput;
            if (channelInput.includes('youtube.com/')) {
                const match = channelInput.match(/youtube\.com\/(@|c\/|user\/|channel\/)([^\/\?]+)/);
                if (match) {
                    username = match[2];
                    if (match[1] === '@') {
                        username = username.replace('@', '');
                    }
                }
            }

            const searchResponse = await fetch(
                `${this.baseUrl}/search?part=snippet&type=channel&q=${encodeURIComponent(username)}&key=${this.apiKey}&maxResults=1`
            );
            
            if (!searchResponse.ok) {
                throw new Error(`API Error: ${searchResponse.status}`);
            }
            
            const searchData = await searchResponse.json();
            
            if (searchData.items && searchData.items.length > 0) {
                return searchData.items[0].snippet.channelId;
            }

            throw new Error('Channel not found');
        } catch (error) {
            console.error('Error getting channel ID:', error);
            throw error;
        }
    }

    async getChannelInfo(channelId) {
        try {
            const response = await fetch(
                `${this.baseUrl}/channels?part=snippet,statistics&id=${channelId}&key=${this.apiKey}`
            );
            
            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.items && data.items.length > 0) {
                const channel = data.items[0];
                return {
                    id: channel.id,
                    name: channel.snippet.title,
                    description: channel.snippet.description,
                    thumbnail: channel.snippet.thumbnails.high?.url || channel.snippet.thumbnails.default?.url,
                    subscriberCount: channel.statistics.subscriberCount,
                    videoCount: channel.statistics.videoCount
                };
            }
            throw new Error('Channel not found');
        } catch (error) {
            console.error('Error getting channel info:', error);
            throw error;
        }
    }

    async getChannelVideos(channelId, maxResults = 6, checkForNew = false) {
        try {
            const response = await fetch(
                `${this.baseUrl}/search?part=snippet&channelId=${channelId}&order=date&type=video&maxResults=${maxResults}&key=${this.apiKey}`
            );
            
            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.items && data.items.length > 0) {
                const videoIds = data.items.map(item => item.id.videoId).join(',');
                
                const detailsResponse = await fetch(
                    `${this.baseUrl}/videos?part=contentDetails,statistics&id=${videoIds}&key=${this.apiKey}`
                );
                
                if (!detailsResponse.ok) {
                    throw new Error(`API Error: ${detailsResponse.status}`);
                }
                
                const detailsData = await detailsResponse.json();
                
                const videos = data.items.map((item, index) => {
                    const details = detailsData.items[index];
                    const publishedAt = new Date(item.snippet.publishedAt);
                    
                    // Check if video is new since last refresh
                    let isNew = false;
                    if (checkForNew) {
                        const lastRefresh = this.lastRefreshData.get(`channel_${channelId}`);
                        isNew = !lastRefresh || publishedAt > lastRefresh;
                    }
                    
                    return {
                        id: item.id.videoId,
                        title: item.snippet.title,
                        description: item.snippet.description,
                        publishedAt: publishedAt,
                        thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
                        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
                        duration: this.parseDuration(details?.contentDetails?.duration || 'PT0S'),
                        viewCount: details?.statistics?.viewCount || '0',
                        likeCount: details?.statistics?.likeCount || '0',
                        isNew: isNew
                    };
                });

                // Update last refresh time if checking for new videos
                if (checkForNew && videos.length > 0) {
                    this.lastRefreshData.set(`channel_${channelId}`, new Date());
                }

                return videos;
            }
            return [];
        } catch (error) {
            console.error('Error getting channel videos:', error);
            throw error;
        }
    }

    // New playlist methods
    async getPlaylistId(playlistInput) {
        try {
            // If it's already a playlist ID
            if (playlistInput.startsWith('PL') || playlistInput.startsWith('UU') || playlistInput.startsWith('FL')) {
                return playlistInput;
            }

            // Extract playlist ID from URL
            if (playlistInput.includes('youtube.com/') || playlistInput.includes('youtu.be/')) {
                const match = playlistInput.match(/[?&]list=([^&]+)/);
                if (match) {
                    return match[1];
                }
            }

            throw new Error('Invalid playlist input');
        } catch (error) {
            console.error('Error getting playlist ID:', error);
            throw error;
        }
    }

    async getPlaylistInfo(playlistId) {
        try {
            const response = await fetch(
                `${this.baseUrl}/playlists?part=snippet,status,contentDetails&id=${playlistId}&key=${this.apiKey}`
            );
            
            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.items && data.items.length > 0) {
                const playlist = data.items[0];
                return {
                    id: playlist.id,
                    title: playlist.snippet.title,
                    description: playlist.snippet.description,
                    thumbnail: playlist.snippet.thumbnails.high?.url || playlist.snippet.thumbnails.default?.url,
                    channelId: playlist.snippet.channelId,
                    channelTitle: playlist.snippet.channelTitle,
                    itemCount: playlist.contentDetails.itemCount,
                    publishedAt: new Date(playlist.snippet.publishedAt),
                    privacy: playlist.status.privacyStatus
                };
            }
            throw new Error('Playlist not found');
        } catch (error) {
            console.error('Error getting playlist info:', error);
            throw error;
        }
    }

    async getPlaylistVideos(playlistId, maxResults = 6, checkForNew = false) {
        try {
            const response = await fetch(
                `${this.baseUrl}/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=${maxResults}&key=${this.apiKey}`
            );
            
            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.items && data.items.length > 0) {
                const videoIds = data.items.map(item => item.contentDetails.videoId).join(',');
                
                const detailsResponse = await fetch(
                    `${this.baseUrl}/videos?part=contentDetails,statistics,snippet&id=${videoIds}&key=${this.apiKey}`
                );
                
                if (!detailsResponse.ok) {
                    throw new Error(`API Error: ${detailsResponse.status}`);
                }
                
                const detailsData = await detailsResponse.json();
                
                const videos = data.items.map((item, index) => {
                    const details = detailsData.items[index];
                    const publishedAt = new Date(item.snippet.publishedAt);
                    
                    // Check if video is new since last refresh
                    let isNew = false;
                    if (checkForNew) {
                        const lastRefresh = this.lastRefreshData.get(`playlist_${playlistId}`);
                        isNew = !lastRefresh || publishedAt > lastRefresh;
                    }
                    
                    return {
                        id: item.contentDetails.videoId,
                        title: item.snippet.title,
                        description: item.snippet.description,
                        publishedAt: publishedAt,
                        thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
                        url: `https://www.youtube.com/watch?v=${item.contentDetails.videoId}`,
                        duration: this.parseDuration(details?.contentDetails?.duration || 'PT0S'),
                        viewCount: details?.statistics?.viewCount || '0',
                        likeCount: details?.statistics?.likeCount || '0',
                        channelTitle: details?.snippet?.channelTitle || item.snippet.channelTitle,
                        position: item.snippet.position,
                        isNew: isNew
                    };
                });

                // Update last refresh time if checking for new videos
                if (checkForNew && videos.length > 0) {
                    this.lastRefreshData.set(`playlist_${playlistId}`, new Date());
                }

                return videos;
            }
            return [];
        } catch (error) {
            console.error('Error getting playlist videos:', error);
            throw error;
        }
    }

    async getChannelPlaylists(channelId, maxResults = 10) {
        try {
            const response = await fetch(
                `${this.baseUrl}/playlists?part=snippet,contentDetails&channelId=${channelId}&maxResults=${maxResults}&key=${this.apiKey}`
            );
            
            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.items && data.items.length > 0) {
                return data.items.map(playlist => ({
                    id: playlist.id,
                    title: playlist.snippet.title,
                    description: playlist.snippet.description,
                    thumbnail: playlist.snippet.thumbnails.high?.url || playlist.snippet.thumbnails.default?.url,
                    itemCount: playlist.contentDetails.itemCount,
                    publishedAt: new Date(playlist.snippet.publishedAt)
                }));
            }
            return [];
        } catch (error) {
            console.error('Error getting channel playlists:', error);
            throw error;
        }
    }

    // Enhanced universal method to handle both channels and playlists
    async getContent(input, maxResults = 6, checkForNew = false) {
        try {
            // Determine if input is a channel or playlist
            if (input.includes('list=') || input.startsWith('PL') || input.startsWith('UU') || input.startsWith('FL')) {
                // It's a playlist
                const playlistId = await this.getPlaylistId(input);
                const playlistInfo = await this.getPlaylistInfo(playlistId);
                const videos = await this.getPlaylistVideos(playlistId, maxResults, checkForNew);
                
                return {
                    type: 'playlist',
                    info: playlistInfo,
                    videos: videos
                };
            } else {
                // It's a channel
                const channelId = await this.getChannelId(input);
                const channelInfo = await this.getChannelInfo(channelId);
                const videos = await this.getChannelVideos(channelId, maxResults, checkForNew);
                
                return {
                    type: 'channel',
                    info: channelInfo,
                    videos: videos
                };
            }
        } catch (error) {
            console.error('Error getting content:', error);
            throw error;
        }
    }

    // Utility methods
    parseDuration(duration) {
        const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
        if (!match) return '0:00';
        
        const hours = (match[1] || '').replace('H', '');
        const minutes = (match[2] || '').replace('M', '');
        const seconds = (match[3] || '').replace('S', '');
        
        if (hours) {
            return `${hours}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
        }
        return `${minutes || '0'}:${seconds.padStart(2, '0')}`;
    }

    // Refresh tracking methods
    setLastRefreshTime(id, type = 'channel') {
        this.lastRefreshData.set(`${type}_${id}`, new Date());
    }

    getLastRefreshTime(id, type = 'channel') {
        return this.lastRefreshData.get(`${type}_${id}`);
    }

    clearRefreshData() {
        this.lastRefreshData.clear();
    }
}

// Usage examples:
/*
const api = new YouTubeAPI('YOUR_API_KEY');

// Get channel content with new video detection
const channelContent = await api.getContent('@channelname', 6, true);

// Get playlist content with new video detection
const playlistContent = await api.getContent('https://youtube.com/playlist?list=PLxxxxxxx', 6, true);

// Get specific playlist info
const playlistInfo = await api.getPlaylistInfo('PLxxxxxxx');

// Get channel's playlists
const playlists = await api.getChannelPlaylists('UCxxxxxxx');

// Check for new videos on next refresh
const updatedContent = await api.getContent('@channelname', 6, true);
// Videos will have isNew: true if published after last refresh
*/