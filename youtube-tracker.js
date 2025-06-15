// Main YouTube Tracker Class with localStorage support
class YouTubeTracker {
    constructor() {
        this.youtubeAPI = null;
        this.channels = [];
        this.storageKey = 'youtube_tracker_channels';
        this.apiKeyStorageKey = 'youtube_tracker_api_key';
        this.initializeEventListeners();
        this.loadChannels();
        this.loadApiKey();
        this.renderChannels();
    }

    initializeEventListeners() {
        const form = document.getElementById('addChannelForm');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.addChannel();
        });
    }

    async addChannel() {
        const apiKeyInput = document.getElementById('apiKey');
        const nameInput = document.getElementById('channelName');
        const urlInput = document.getElementById('channelUrl');
        
        const apiKey = apiKeyInput.value.trim();
        const name = nameInput.value.trim();
        const url = urlInput.value.trim();

        if (!apiKey || !name || !url) {
            this.showError('Please fill in all fields');
            return;
        }

        try {
            this.hideError();
            this.showLoading(true);
            
            // Initialize API with the provided key
            this.youtubeAPI = new YouTubeAPI(apiKey);
            
            // // Get channel ID and info
            // const channelId = await this.youtubeAPI.getChannelId(url);
            // const channelInfo = await this.youtubeAPI.getChannelInfo(channelId);
            // const videos = await this.youtubeAPI.getChannelVideos(channelId, 6);

            // const channel = {
            //     id: Date.now(),
            //     name: channelInfo.name,
            //     url: `https://www.youtube.com/channel/${channelId}`,
            //     channelId: channelId,
            //     thumbnail: channelInfo.thumbnail,
            //     lastChecked: new Date().toISOString(),
            //     videos: videos,
            //     hasNewContent: this.checkForNewContent(videos),
            //     apiKey: apiKey // Store API key for future refreshes
            // };

            // Use the new universal getContent method
            const content = await this.youtubeAPI.getContent(url, 6);

            const channel = {
                id: Date.now(),
                name: content.info.name || content.info.title,
                url: content.type === 'channel' ? `https://www.youtube.com/channel/${content.info.id}` : `https://www.youtube.com/playlist?list=${content.info.id}`,
                channelId: content.info.id,
                contentType: content.type, // Add this to track if it's channel or playlist
                thumbnail: content.info.thumbnail,
                lastChecked: new Date().toISOString(),
                videos: content.videos,
                hasNewContent: this.checkForNewContent(content.videos),
                apiKey: apiKey
            };

            this.channels.push(channel);
            this.saveChannels();
            this.saveApiKey(apiKey); // Save API key for convenience
            this.renderChannels();
            
            nameInput.value = '';
            urlInput.value = '';
            
        } catch (error) {
            this.showError('Error adding channel: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    async refreshChannel(channelId) {
        try {
            const channel = this.channels.find(c => c.id === channelId);
            if (!channel) return;

            // Initialize API with stored key
            this.youtubeAPI = new YouTubeAPI(channel.apiKey);

            const previousVideos = channel.videos || [];
            // const newVideos = await this.youtubeAPI.getChannelVideos(channel.channelId, 6);
            const content = await this.youtubeAPI.getContent(channel.channelId, 6, true);
            const newVideos = content.videos;
            
            // Check for new videos by comparing with previous videos
            const newVideoIds = newVideos.map(v => v.id);
            const previousVideoIds = previousVideos.map(v => v.id);
            const hasNewVideos = newVideoIds.some(id => !previousVideoIds.includes(id));

            channel.videos = newVideos;
            channel.hasNewContent = hasNewVideos;
            channel.lastChecked = new Date().toISOString();
            
            this.saveChannels();
            this.renderChannels();
            
        } catch (error) {
            console.error('Error refreshing channel:', error);
            this.showError('Error refreshing channel: ' + error.message);
        }
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
                    <p>Add your first YouTube channel to get started!</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = this.channels.map(channel => `
            <div class="channel-card">
                <div class="channel-header">
                    <h3 class="channel-name">${channel.name}</h3>
                    ${channel.hasNewContent ? '<span class="new-badge">New</span>' : ''}
                </div>
                
                <div class="videos-section">
                    <div class="videos-title">Recent Videos</div>
                    <div class="videos-grid">
                        ${channel.videos.slice(0, 6).map(video => `
                            <div class="video-thumbnail" onclick="window.open('${video.url}', '_blank')">
                                <img src="${video.thumbnail}" alt="${video.title}" loading="lazy">
                                <div class="video-duration">${video.duration}</div>
                                ${this.isNewVideo(video.publishedAt) ? '<div class="new-video-indicator">New</div>' : ''}
                                <div class="video-overlay">
                                    <div class="video-title-thumb">${video.title}</div>
                                    <div class="video-date-thumb">${this.formatDate(video.publishedAt)}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="channel-actions">
                    <button class="btn btn-primary" onclick="tracker.refreshChannel(${channel.id})">
                        Refresh
                    </button>
                    <a href="${channel.url}" target="_blank" class="btn btn-primary">
                        Visit Channel
                    </a>
                    <button class="btn btn-danger" onclick="tracker.removeChannel(${channel.id})">
                        Remove
                    </button>
                </div>
            </div>
        `).join('');
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
            } else {
                console.log('No saved channels found in localStorage');
            }
        } catch (error) {
            console.error('Error loading channels from localStorage:', error);
            this.channels = [];
        }
    }

    saveApiKey(apiKey) {
        try {
            localStorage.setItem(this.apiKeyStorageKey, apiKey);
            console.log('API key saved to localStorage');
        } catch (error) {
            console.error('Error saving API key to localStorage:', error);
        }
    }

    loadApiKey() {
        try {
            const savedApiKey = localStorage.getItem(this.apiKeyStorageKey);
            if (savedApiKey) {
                const apiKeyInput = document.getElementById('apiKey');
                if (apiKeyInput) {
                    apiKeyInput.value = savedApiKey;
                }
                console.log('API key loaded from localStorage');
            }
        } catch (error) {
            console.error('Error loading API key from localStorage:', error);
        }
    }

    // Additional utility methods for localStorage management
    clearAllData() {
        if (confirm('Are you sure you want to clear all saved data? This cannot be undone.')) {
            try {
                localStorage.removeItem(this.storageKey);
                localStorage.removeItem(this.apiKeyStorageKey);
                this.channels = [];
                this.renderChannels();
                
                // Clear the API key input field
                const apiKeyInput = document.getElementById('apiKey');
                if (apiKeyInput) {
                    apiKeyInput.value = '';
                }
                
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