class SecureYouTubeTracker {
    constructor() {
        this.channels = [];
        this.storageKey = 'youtube_tracker_channels';
        this.apiBaseUrl = '/api/youtube'; // Backend proxy
        this.initializeEventListeners();
        this.loadChannels();
        this.checkServerConnection();
        this.renderChannels();
    }

    async checkServerConnection() {
        const statusDiv = document.getElementById('serverStatus');
        try {
            const response = await fetch('/api/youtube/health');
            if (response.ok) {
                statusDiv.textContent = '🟢 Server connected and ready!';
                statusDiv.className = 'status-indicator status-connected';
            } else {
                throw new Error('Server not responding');
            }
        } catch (error) {
            statusDiv.textContent = '🔴 Server not connected. Make sure your backend is running on port 3001.';
            statusDiv.className = 'status-indicator status-disconnected';
        }
    }

    initializeEventListeners() {
        const form = document.getElementById('addChannelForm');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.addChannel();
        });
    }

    async addChannel() {
        const nameInput = document.getElementById('channelName');
        const urlInput = document.getElementById('channelUrl');
        
        const name = nameInput.value.trim();
        const url = urlInput.value.trim();

        if (!name || !url) {
            this.showError('Please fill in all fields');
            return;
        }

        try {
            this.hideError();
            this.showLoading(true);
            
            // Get channel ID through backend proxy
            const channelIdResponse = await fetch(`${this.apiBaseUrl}/extract-channel-id`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            
            if (!channelIdResponse.ok) {
                const errorData = await channelIdResponse.json();
                throw new Error(errorData.error || 'Failed to extract channel ID');
            }
            
            const { channelId, playlistId, type } = await channelIdResponse.json();
            
            let contentInfo, videos;
            
            if (type === 'playlist') {
                // Get playlist info
                const playlistResponse = await fetch(`${this.apiBaseUrl}/playlist/${playlistId}`);
                if (!playlistResponse.ok) {
                    const errorData = await playlistResponse.json();
                    throw new Error(errorData.error || 'Failed to get playlist information');
                }
                const playlistData = await playlistResponse.json();
                if (!playlistData.items || playlistData.items.length === 0) {
                    throw new Error('Playlist not found');
                }
                contentInfo = playlistData.items[0];
                
                // Get playlist videos
                const videosResponse = await fetch(`${this.apiBaseUrl}/playlist/${playlistId}/videos?maxResults=6`);
                if (!videosResponse.ok) {
                    const errorData = await videosResponse.json();
                    throw new Error(errorData.error || 'Failed to get playlist videos');
                }
                const videosData = await videosResponse.json();
                videos = await this.formatPlaylistVideos(videosData.items || []);
            } else {
                // Get channel info through backend proxy

                // Step 1: Get channel info
                const channelInfoResponse = await fetch(`${this.apiBaseUrl}/channel/${channelId}`);
                if (!channelInfoResponse.ok) {
                    const errorData = await channelInfoResponse.json();
                    throw new Error(errorData.error || 'Failed to get channel information');
                }
                
                const channelData = await channelInfoResponse.json();
                if (!channelData.items || channelData.items.length === 0) {
                    throw new Error('Channel not found');
                }
                contentInfo = channelData.items[0];

                // Step 2: Fetch videos via /channel/:id/videos (unfiltered)
                console.log('🔍 Fetching videos for channelId:', channelId);
                const videosResponse = await fetch(`${this.apiBaseUrl}/channel/${channelId}/videos?maxResults=6`);
                if (!videosResponse.ok) {
                    const errorData = await videosResponse.json();
                    throw new Error(errorData.error || 'Failed to get channel videos');
                }

                // all videos
                const videosData = await videosResponse.json();
                console.log('📺 Raw videos data:', videosData);

                const rawItems = videosData.items || [];
                console.log('🎬 Raw items count:', rawItems.length);

                if (rawItems.length > 0) {
                    console.log('📝 First raw item structure:', rawItems[0]);
                }

                const videoIds = rawItems
                    .map(item => {
                        const videoId = item.id?.videoId || item.id;
                        console.log('🆔 Extracted video ID:', videoId, 'from item:', item.id);
                        return videoId;
                    })
                    .filter(Boolean);

                console.log('🎯 Final video IDs:', videoIds);

                if (!videoIds.length) {
                    throw new Error('No video IDs to fetch metadata for.');
                }
                console.log('Fetching metadata for videoIds:', videoIds); // Debug log

                // Step 3: POST video IDs to /videos/metadata for yt-dlp filtering
                console.log('📡 Fetching metadata for videoIds:', videoIds);
                const metadataResponse = await fetch(`${this.apiBaseUrl}/videos/metadata`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ videoIds }),
                });

                if (!metadataResponse.ok) {
                    const errorData = await metadataResponse.json();
                    throw new Error(errorData.error || 'Failed to get filtered video metadata');
                }

                const metadataData = await metadataResponse.json();
                console.log('🔬 Metadata response:', metadataData);
                console.log('📊 Metadata items count:', metadataData.items?.length || 0);

                if (metadataData.items && metadataData.items.length > 0) {
                    console.log('📋 First metadata item:', metadataData.items[0]);
                }

                videos = await this.formatVideos(metadataData.items || []);
                console.log('🎥 Final formatted videos:', videos);
            }

            const channel = {
                id: Date.now(),
                name: name,
                url: type === 'playlist' ? `https://www.youtube.com/playlist?list=${playlistId}` : `https://www.youtube.com/channel/${channelId}`,
                channelId: channelId || playlistId,
                contentType: type || 'channel',
                thumbnail: contentInfo.snippet.thumbnails.default?.url || contentInfo.snippet.thumbnails.high?.url,
                lastChecked: new Date().toISOString(),
                videos: videos,
                hasNewContent: this.checkForNewContent(videos)
            };

            this.channels.push(channel);
            this.saveChannels();
            this.renderChannels();
            
            nameInput.value = '';
            urlInput.value = '';
            
        } catch (error) {
            console.error('Error adding channel:', error);
            this.showError('Error adding channel: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    async refreshChannel(channelId, buttonElement = null) {
        try {
            // Set button to loading state
            if (buttonElement) {
                ButtonStateManager.setLoading(buttonElement, '🔄 Refreshing...');
            }

            const channel = this.channels.find(c => c.id === channelId);
            if (!channel) return;

            const previousVideos = channel.videos || [];
            let newVideos;

            if (channel.contentType === 'playlist') {
                const response = await fetch(`${this.apiBaseUrl}/playlist/${channel.channelId}/videos?maxResults=6`);
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to refresh playlist');
                }

                const data = await response.json();
                newVideos = await this.formatPlaylistVideos(data.items || []);
            } else {
                // Step 1: Fetch raw videos
                const videosResponse = await fetch(`${this.apiBaseUrl}/channel/${channel.channelId}/videos?maxResults=12`);
                if (!videosResponse.ok) {
                    const errorData = await videosResponse.json();
                    throw new Error(errorData.error || 'Failed to get channel videos during refresh');
                }

                const videosData = await videosResponse.json();
                const rawItems = videosData.items || [];

                const videoIds = rawItems
                    .map(item => item.id?.videoId || item.id)
                    .filter(Boolean);

                // Step 2: Call /videos/metadata to get filtered list
                const metadataResponse = await fetch(`${this.apiBaseUrl}/videos/metadata`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ videoIds: videoItems.map(item => item.id.videoId) })
                });

                if (!metadataResponse.ok) {
                    const errorData = await metadataResponse.json();
                    throw new Error(errorData.error || 'Failed to fetch filtered video metadata during refresh');
                }

                const metadataData = await metadataResponse.json();
                console.log('metadataData.items sample:', metadataData.items?.[0]);
                newVideos = await this.formatVideos(metadataData.items || []);
            }

            // Update channel object
            const newVideoIds = newVideos.map(v => v.id);
            const previousVideoIds = previousVideos.map(v => v.id);
            const hasNewVideos = newVideoIds.some(id => !previousVideoIds.includes(id));

            channel.videos = newVideos;
            channel.hasNewContent = hasNewVideos;
            channel.lastChecked = new Date().toISOString();
            
            this.saveChannels();
            this.renderChannels();

            // Show success state
            if (buttonElement) {
                ButtonStateManager.setSuccess(buttonElement, '✅ Updated!');
            }
            
        } catch (error) {
            console.error('Error refreshing channel:', error);
            this.showError('Error refreshing content: ' + error.message);
            if (buttonElement) {
                ButtonStateManager.setError(buttonElement, '❌ Failed');
            }
        }
    }

    async formatVideos(videoItems) {
    console.log('🎬 formatVideos called with:', videoItems?.length || 0, 'items');
    
    if (!videoItems || videoItems.length === 0) {
        console.log('⚠️ No video items to format');
        return [];
    }
    
    console.log('📝 First video item structure:', videoItems[0]);
    
    return videoItems.map((item, index) => {
        console.log(`🎯 Processing video ${index + 1}:`, item.id);
        
        return {
            id: item.id,
            title: item.snippet?.title || 'No Title',
            thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url,
            url: `https://www.youtube.com/watch?v=${item.id}`,
            publishedAt: new Date(item.snippet?.publishedAt || Date.now()),
            duration: this.parseDuration(item.contentDetails?.duration || 'PT0S')
        };
    });
}



    async formatPlaylistVideos(playlistItems) {
        const videoIds = playlistItems.map(item => item.snippet.resourceId.videoId).join(',');
        
        // Get video details for duration
        const detailsResponse = await fetch(`${this.apiBaseUrl}/videos/${videoIds}`);
        const detailsData = await detailsResponse.json();
        
        return playlistItems.map((item, index) => ({
            id: item.snippet.resourceId.videoId,
            title: item.snippet.title,
            thumbnail: item.snippet.thumbnails.medium?.url,
            url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
            publishedAt: new Date(item.snippet.publishedAt),
            duration: this.parseDuration(detailsData.items[index]?.contentDetails?.duration || 'PT0S')
        }));
    }

    // Add this duration parser method to youtube-tracker.js
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

    removeChannel(channelId) {
        if (confirm('Are you sure you want to remove this channel?')) {
            this.channels = this.channels.filter(c => c.id !== channelId);
            this.saveChannels();
            this.renderChannels();
        }
    }

    checkForNewContent(videos) {
        if (!videos || videos.length === 0) return false;
        
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return videos.some(video => video.publishedAt > oneDayAgo);
    }

    formatDate(date) {
        return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
            Math.round((date - new Date()) / (1000 * 60 * 60 * 24)), 'day'
        );
    }

    renderChannels() {
        const grid = document.getElementById('channelsGrid');
        
        if (this.channels.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <h3>No channels added yet</h3>
                    <p>Add your first YouTube channel or playlist to get started!</p>
                    <p><small>✅ API keys are now handled securely server-side!</small></p>
                </div>
            `;
            return;
        }

        grid.innerHTML = this.channels.map(channel => `
            <div class="channel-card">
                <div class="channel-header">
                    <h3 class="channel-name">${this.escapeHtml(channel.name)}</h3>
                    <span class="content-type-badge">${channel.contentType === 'playlist' ? 'Playlist' : 'Channel'}</span>
                    ${channel.hasNewContent ? '<span class="new-badge">New</span>' : ''}
                </div>
                
                <div class="videos-section">
                    <div class="videos-title">Recent Videos</div>
                    <div class="videos-grid">
                        ${channel.videos.slice(0, 6).map(video => `
                            <div class="video-thumbnail" onclick="window.open('${video.url}', '_blank')">
                                <img src="${video.thumbnail}" alt="${this.escapeHtml(video.title)}" loading="lazy">
                                <div class="video-duration">${video.duration}</div>
                                ${this.isNewVideo(video.publishedAt) ? '<div class="new-video-indicator">New</div>' : ''}
                                <div class="video-overlay">
                                    <div class="video-title-thumb">${this.escapeHtml(video.title)}</div>
                                    <div class="video-date-thumb">${this.formatDate(video.publishedAt)}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="channel-actions">
                    <button class="btn btn-primary" onclick="tracker.refreshChannel(${channel.id}, this)">
                        Refresh
                    </button>
                    <a href="${channel.url}" target="_blank" class="btn btn-primary">
                        Visit ${channel.contentType === 'playlist' ? 'Playlist' : 'Channel'}
                    </a>
                    <button class="btn btn-danger" onclick="tracker.removeChannel(${channel.id})">
                        Remove
                    </button>
                </div>
            </div>
        `).join('');
    }

    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    isNewVideo(publishedAt) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return publishedAt > oneDayAgo;
    }

    showLoading(show) {
        const addBtn = document.querySelector('.add-btn');
        addBtn.disabled = show;
        addBtn.textContent = show ? 'Loading...' : 'Add Channel';
    }

    showError(message) {
        const errorDiv = document.getElementById('errorMessage');
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }

    hideError() {
        const errorDiv = document.getElementById('errorMessage');
        errorDiv.style.display = 'none';
    }

    // localStorage methods
    saveChannels() {
        try {
            const channelsData = JSON.stringify(this.channels);
            localStorage.setItem(this.storageKey, channelsData);
            console.log('Channels saved to localStorage:', this.channels.length);
        } catch (error) {
            console.error('Error saving channels to localStorage:', error);
            this.showError('Error saving data to localStorage');
        }
    }

    loadChannels() {
        try {
            const savedChannels = localStorage.getItem(this.storageKey);
            if (savedChannels) {
                this.channels = JSON.parse(savedChannels);
                // Convert date strings back to Date objects
                this.channels.forEach(channel => {
                    if (channel.videos) {
                        channel.videos.forEach(video => {
                            if (typeof video.publishedAt === 'string') {
                                video.publishedAt = new Date(video.publishedAt);
                            }
                        });
                    }
                });
                console.log('Channels loaded from localStorage:', this.channels.length);
            }
        } catch (error) {
            console.error('Error loading channels from localStorage:', error);
            this.channels = [];
        }
    }

    clearAllData() {
        if (confirm('Are you sure you want to clear all saved data? This cannot be undone.')) {
            try {
                localStorage.removeItem(this.storageKey);
                this.channels = [];
                this.renderChannels();
                console.log('All data cleared from localStorage');
                alert('All data has been cleared successfully');
            } catch (error) {
                console.error('Error clearing localStorage:', error);
                this.showError('Error clearing saved data');
            }
        }
    }

    exportData() {
        try {
            const data = {
                channels: this.channels,
                exportDate: new Date().toISOString(),
                version: '1.0'
            };
            
            const dataStr = JSON.stringify(data, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            
            const link = document.createElement('a');
            link.href = URL.createObjectURL(dataBlob);
            link.download = `youtube-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
            link.click();
            
            console.log('Data exported successfully');
        } catch (error) {
            console.error('Error exporting data:', error);
            this.showError('Error exporting data');
        }
    }

    importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (data.channels && Array.isArray(data.channels)) {
                    if (confirm('This will replace all current data. Continue?')) {
                        this.channels = data.channels;
                        // Convert date strings back to Date objects
                        this.channels.forEach(channel => {
                            if (channel.videos) {
                                channel.videos.forEach(video => {
                                    if (typeof video.publishedAt === 'string') {
                                        video.publishedAt = new Date(video.publishedAt);
                                    }
                                });
                            }
                        });
                        
                        this.saveChannels();
                        this.renderChannels();
                        console.log('Data imported successfully');
                        alert('Data imported successfully');
                    }
                } else {
                    throw new Error('Invalid file format');
                }
            } catch (error) {
                console.error('Error importing data:', error);
                this.showError('Error importing data: Invalid file format');
            }
        };
        
        reader.readAsText(file);
    }
}

// Button state management utility
const ButtonStateManager = {
    setLoading: function(button, loadingText = 'Loading...') {
        if (!button) return;
        
        // Store original content
        button.dataset.originalText = button.innerHTML;
        button.dataset.originalDisabled = button.disabled;
        
        // Set loading state
        button.classList.add('loading');
        button.disabled = true;
        button.innerHTML = loadingText;
    },
    
    setSuccess: function(button, successText = 'Success!', duration = 2000) {
        if (!button) return;
        
        button.classList.remove('loading');
        button.classList.add('success');
        button.innerHTML = successText;
        
        setTimeout(() => {
            this.reset(button);
        }, duration);
    },
    
    setError: function(button, errorText = 'Error!', duration = 3000) {
        if (!button) return;
        
        button.classList.remove('loading');
        button.classList.add('error');
        button.innerHTML = errorText;
        
        setTimeout(() => {
            this.reset(button);
        }, duration);
    },
    
    reset: function(button) {
        if (!button) return;
        
        button.classList.remove('loading', 'success', 'error');
        button.innerHTML = button.dataset.originalText || button.innerHTML;
        button.disabled = button.dataset.originalDisabled === 'true';
        
        // Clean up
        delete button.dataset.originalText;
        delete button.dataset.originalDisabled;
    }
};