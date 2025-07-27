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
            this.showProgressiveLoading(true);
            
            // Step 1: Get channel ID through backend proxy
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
            
            // Step 2: Get basic channel/playlist info and show preview
            let contentInfo;
            if (type === 'playlist') {
                const playlistResponse = await fetch(`${this.apiBaseUrl}/playlist/${playlistId}`);
                if (!playlistResponse.ok) {
                    const errorData = await playlistResponse.json();
                    throw new Error(errorData.error || 'Failed to get playlist information');
                }
                const playlistData = await playlistResponse.json();
                contentInfo = playlistData.items[0];
            } else {
                const channelInfoResponse = await fetch(`${this.apiBaseUrl}/channel/${channelId}`);
                if (!channelInfoResponse.ok) {
                    const errorData = await channelInfoResponse.json();
                    throw new Error(errorData.error || 'Failed to get channel information');
                }
                const channelData = await channelInfoResponse.json();
                contentInfo = channelData.items[0];
            }

            // Create channel object with basic info
            const channel = {
                id: Date.now(),
                name: name,
                url: type === 'playlist' ? `https://www.youtube.com/playlist?list=${playlistId}` : `https://www.youtube.com/channel/${channelId}`,
                channelId: channelId || playlistId,
                contentType: type || 'channel',
                thumbnail: contentInfo.snippet.thumbnails.default?.url || contentInfo.snippet.thumbnails.high?.url,
                lastChecked: new Date().toISOString(),
                videos: [],
                hasNewContent: false,
                isLoading: true // Add loading state
            };

            // Step 3: Show channel preview immediately
            this.channels.push(channel);
            this.showChannelPreview(channel);

            // Step 4: Load videos progressively
            await this.loadVideosProgressive(channel, type);

            // Step 5: Finalize channel
            channel.isLoading = false;
            channel.hasNewContent = this.checkForNewContent(channel.videos);
            this.saveChannels();
            this.renderChannels();
            
            nameInput.value = '';
            urlInput.value = '';
            
        } catch (error) {
            console.error('Error adding channel:', error);
            this.showError('Error adding channel: ' + error.message);
        } finally {
            this.showProgressiveLoading(false);
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
                const response = await fetch(`${this.apiBaseUrl}/playlist/${channel.channelId}/videos`);
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to refresh playlist');
                }

                const data = await response.json();
                newVideos = await this.formatPlaylistVideos(data.items || []);
            } else {
                // Step 1: Fetch raw videos
                const videosResponse = await fetch(`${this.apiBaseUrl}/channel/${channel.channelId}/videos`);
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
                    body: JSON.stringify({ videoIds })
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

    showProgressiveLoading(show) {
        const addBtn = document.querySelector('.add-btn');
        addBtn.disabled = show;
        addBtn.textContent = show ? '🔄 Loading channel...' : 'Add Channel';
    }

    showChannelPreview(channel) {
        // Update the grid to show the channel card immediately with loading state
        this.renderChannels();
        
        // Scroll to the new channel card
        setTimeout(() => {
            const channelCards = document.querySelectorAll('.channel-card');
            const newCard = channelCards[channelCards.length - 1];
            if (newCard) {
                newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }

    async loadVideosProgressive(channel, type) {
        try {
            if (type === 'playlist') {
                const response = await fetch(`${this.apiBaseUrl}/playlist/${channel.channelId}/videos`);
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to get playlist videos');
                }
                const data = await response.json();
                const videos = await this.formatPlaylistVideos(data.items || []);
                
                // Update videos progressively (simulate batching for playlists)
                this.updateChannelVideos(channel, videos);
            } else {
                // Step 1: Get raw video list
                const videosResponse = await fetch(`${this.apiBaseUrl}/channel/${channel.channelId}/videos`);
                if (!videosResponse.ok) {
                    const errorData = await videosResponse.json();
                    throw new Error(errorData.error || 'Failed to get channel videos');
                }

                const videosData = await videosResponse.json();
                const rawItems = videosData.items || [];
                const videoIds = rawItems
                    .map(item => item.id?.videoId || item.id)
                    .filter(Boolean);

                if (!videoIds.length) {
                    this.updateChannelVideos(channel, []);
                    return;
                }

                // Step 2: Send all videoIds but process them progressively
                const allVideos = [];
                let batchIndex = 0;

                const metadataResponse = await fetch(`${this.apiBaseUrl}/videos/metadata/stream`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        videoIds,
                        batchSize: 10,
                        channelId: channel.id // Send channel ID for tracking
                    })
                });

                if (!metadataResponse.ok) {
                    const errorData = await metadataResponse.json();
                    throw new Error(errorData.error || 'Failed to start video metadata streaming');
                }

                // Handle streaming response
                const reader = metadataResponse.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        
                        if (done) break;
                        
                        buffer += decoder.decode(value, { stream: true });
                        
                        // Process each complete JSON line
                        const lines = buffer.split('\n');
                        buffer = lines.pop(); // Keep incomplete line in buffer
                        
                        for (const line of lines) {
                            if (line.trim()) {
                                try {
                                    const batchData = JSON.parse(line);
                                    
                                    if (batchData.type === 'batch') {
                                        const batchVideos = await this.formatVideos(batchData.videos || []);
                                        allVideos.push(...batchVideos);
                                        
                                        // Update UI with new batch
                                        this.updateChannelVideos(channel, [...allVideos]);
                                        batchIndex++;
                                        
                                    } else if (batchData.type === 'complete') {
                                        console.log('All batches processed:', batchData.totalVideos);
                                        break;
                                    } else if (batchData.type === 'error') {
                                        throw new Error(batchData.message);
                                    }
                                } catch (parseError) {
                                    console.error('Error parsing batch data:', parseError);
                                }
                            }
                        }
                    }
                } finally {
                    reader.releaseLock();
                }


            }
        } catch (error) {
            console.error('Error loading videos:', error);
            this.showError('Error loading videos: ' + error.message);
        }
    }

    updateChannelVideos(channel, newVideos, batchInfo = null) {
        channel.videos = newVideos;
        // Show loading state if videos are being fetched
        if (newVideos.length === 0 && channel.isLoading) {
            channel.loadingMessage = 'Starting batch processing...';
        } else if (channel.isLoading && batchInfo) {
            channel.loadingMessage = `Processing batch ${batchInfo.current}/${batchInfo.total} (${newVideos.length} videos loaded)`;
        } else if (channel.isLoading) {
            channel.loadingMessage = `Loading... (${newVideos.length} videos loaded)`;
        }
        this.renderChannels(); // Re-render to show updated videos
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
                    ${channel.isLoading ? `
                        <div class="videos-loading">
                            <div class="loading-spinner">🔄</div>
                            <p>Loading videos...</p>
                        </div>
                    ` : `
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
                    `}
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