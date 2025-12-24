// BLS Applicant Manager - Background Service Worker
// Fixed to work with BOTH old and new storage formats

const API_URL = 'https://bls-sync-api-production.up.railway.app';
const STORAGE_KEY = 'bls_applicants_data'; // New format
const CONFIG_KEY = 'bls_api_config';
const SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutes

let apiConfig = {
    apiUrl: API_URL,
    syncEnabled: true,
    lastSync: null
};

console.log('🚀 BLS Background Service Worker starting...');

// Initialize
chrome.runtime.onInstalled.addListener(async () => {
    console.log('📦 Extension installed/updated');
    
    const config = await chrome.storage.local.get(CONFIG_KEY);
    if (config[CONFIG_KEY]) {
        apiConfig = config[CONFIG_KEY];
    }
    
    await pullFromAPI();
    startAutoSync();
    
    console.log('✅ Initialization complete');
});

// Start auto-sync timer
function startAutoSync() {
    console.log('⏰ Starting auto-sync (every 2 minutes)');
    
    setInterval(async () => {
        console.log('🔄 Auto-sync triggered');
        await pullFromAPI();
    }, SYNC_INTERVAL);
}

// Listen for storage changes
chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'local' && (changes[STORAGE_KEY] || changes['bls_applicants'])) {
        console.log('📝 Local data changed, pushing to API...');
        await pushToAPI();
    }
});

// Pull data from API
async function pullFromAPI() {
    if (!apiConfig.syncEnabled) {
        console.log('⏸️ Sync disabled');
        return;
    }

    try {
        console.log('⬇️ Pulling from API...');
        
        const response = await fetch(`${apiConfig.apiUrl}/api/applicants`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        console.log('📡 Response status:', response.status);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('📊 Received:', data.applicants?.length || 0, 'applicants');
        
        // Save in BOTH formats for compatibility
        await chrome.storage.local.set({
            // New format (for popup/sync)
            [STORAGE_KEY]: {
                applicants: data.applicants || [],
                groups: data.groups || []
            },
            // Old format (for content.js)
            'bls_applicants': data.applicants || [],
            'bls_groups': data.groups || []
        });

        apiConfig.lastSync = new Date().toISOString();
        await chrome.storage.local.set({ [CONFIG_KEY]: apiConfig });

        console.log('✅ Pull successful! Saved in both formats');
        showBadge('✓', '#27ae60');

    } catch (error) {
        console.error('❌ Pull failed:', error.message);
        showBadge('✗', '#e74c3c');
    }
}

// Push data to API
async function pushToAPI() {
    if (!apiConfig.syncEnabled) {
        console.log('⏸️ Sync disabled');
        return;
    }

    try {
        console.log('⬆️ Pushing to API...');
        
        // Try to get data from either format
        const result = await chrome.storage.local.get([STORAGE_KEY, 'bls_applicants', 'bls_groups']);
        
        let applicants, groups;
        
        // Check new format first
        if (result[STORAGE_KEY]) {
            applicants = result[STORAGE_KEY].applicants || [];
            groups = result[STORAGE_KEY].groups || [];
        } 
        // Fall back to old format
        else {
            applicants = result.bls_applicants || [];
            groups = result.bls_groups || [];
        }

        console.log('📤 Pushing:', applicants.length, 'applicants');

        const response = await fetch(`${apiConfig.apiUrl}/api/applicants/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                applicants: applicants,
                groups: groups
            })
        });

        console.log('📡 Response status:', response.status);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const resultData = await response.json();
        console.log('📊 Synced:', resultData.data?.applicants?.length || 0, 'applicants');
        
        // Save in BOTH formats
        await chrome.storage.local.set({
            [STORAGE_KEY]: {
                applicants: resultData.data.applicants || [],
                groups: resultData.data.groups || []
            },
            'bls_applicants': resultData.data.applicants || [],
            'bls_groups': resultData.data.groups || []
        });

        apiConfig.lastSync = new Date().toISOString();
        await chrome.storage.local.set({ [CONFIG_KEY]: apiConfig });

        console.log('✅ Push successful!');
        showBadge('✓', '#27ae60');

    } catch (error) {
        console.error('❌ Push failed:', error.message);
        showBadge('✗', '#e74c3c');
    }
}

// Show badge
function showBadge(text, color) {
    try {
        chrome.action.setBadgeBackgroundColor({ color });
        chrome.action.setBadgeText({ text });
        setTimeout(() => {
            chrome.action.setBadgeText({ text: '' });
        }, 2000);
    } catch (e) {
        // Ignore
    }
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📨 Message:', request.action);
    
    if (request.action === 'syncNow') {
        (async () => {
            console.log('🔄 Manual sync triggered');
            await pullFromAPI();
            await pushToAPI();
            sendResponse({ success: true });
        })();
        return true;
    }
    
    if (request.action === 'pullFromAPI') {
        pullFromAPI().then(() => {
            sendResponse({ success: true });
        }).catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }
    
    if (request.action === 'pushToAPI') {
        pushToAPI().then(() => {
            sendResponse({ success: true });
        }).catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }
});

// Initial pull
setTimeout(() => {
    console.log('🔄 Initial pull');
    pullFromAPI();
    startAutoSync();
}, 3000);

console.log('✅ Background Service Worker loaded!');
