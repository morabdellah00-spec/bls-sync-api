// server.js - Complete Railway Backend with Dashboard + Broadcast
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// ==================== DATA STORAGE ====================
// In-memory storage for applicant data
let applicantsData = {};

// In-memory storage for broadcast commands
let currentCommand = {
    location: '',
    visaType: '',
    timestamp: Date.now()
};

// ==================== BROADCAST ENDPOINTS ====================

// POST /api/broadcast - Set new command (Master browser sends)
app.post('/api/broadcast', (req, res) => {
    try {
        const { location, visaType, timestamp } = req.body;

        if (!location || !visaType) {
            return res.status(400).json({
                success: false,
                error: 'Missing location or visaType'
            });
        }

        currentCommand = {
            location,
            visaType,
            timestamp: timestamp || Date.now()
        };

        console.log('📢 Broadcast command updated:', currentCommand);

        res.json({
            success: true,
            command: currentCommand,
            message: 'Command broadcasted successfully'
        });
    } catch (error) {
        console.error('Error broadcasting command:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/broadcast - Get current command (Slave browsers poll)
app.get('/api/broadcast', (req, res) => {
    try {
        res.json({
            success: true,
            ...currentCommand
        });
    } catch (error) {
        console.error('Error getting command:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== SYNC ENDPOINTS (Your existing endpoints) ====================

// Sync endpoint - Store applicant data
app.post('/api/sync', (req, res) => {
    try {
        const { userId, applicants } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'Missing userId'
            });
        }

        applicantsData[userId] = {
            applicants: applicants || [],
            lastUpdated: new Date().toISOString()
        };

        console.log(`✅ Synced data for user: ${userId}`);
        
        res.json({
            success: true,
            message: 'Data synced successfully',
            timestamp: applicantsData[userId].lastUpdated
        });
    } catch (error) {
        console.error('Error syncing data:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get endpoint - Retrieve applicant data
app.get('/api/sync/:userId', (req, res) => {
    try {
        const { userId } = req.params;
        
        const userData = applicantsData[userId];
        
        if (!userData) {
            return res.json({
                success: true,
                applicants: [],
                lastUpdated: null
            });
        }

        res.json({
            success: true,
            applicants: userData.applicants,
            lastUpdated: userData.lastUpdated
        });
    } catch (error) {
        console.error('Error getting data:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== DASHBOARD HTML ====================

// Dashboard route - Serves HTML interface
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BLS Sync Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .header {
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            margin-bottom: 30px;
            text-align: center;
        }
        
        .header h1 {
            color: #667eea;
            font-size: 36px;
            margin-bottom: 10px;
        }
        
        .header p {
            color: #666;
            font-size: 16px;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: white;
            border-radius: 12px;
            padding: 25px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        }
        
        .stat-card h3 {
            color: #666;
            font-size: 14px;
            font-weight: 600;
            text-transform: uppercase;
            margin-bottom: 10px;
        }
        
        .stat-card .value {
            color: #667eea;
            font-size: 32px;
            font-weight: bold;
            margin-bottom: 5px;
        }
        
        .stat-card .label {
            color: #999;
            font-size: 12px;
        }
        
        .broadcast-section {
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            margin-bottom: 30px;
        }
        
        .broadcast-section h2 {
            color: #667eea;
            font-size: 24px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .current-command {
            background: #f8f9fa;
            border-left: 4px solid #667eea;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        
        .current-command h3 {
            color: #333;
            font-size: 16px;
            margin-bottom: 10px;
        }
        
        .command-details {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        
        .command-item {
            background: white;
            padding: 12px;
            border-radius: 6px;
            border: 1px solid #e0e0e0;
        }
        
        .command-item .key {
            color: #999;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            margin-bottom: 5px;
        }
        
        .command-item .value {
            color: #333;
            font-size: 16px;
            font-weight: 600;
        }
        
        .info-section {
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        }
        
        .info-section h2 {
            color: #667eea;
            font-size: 24px;
            margin-bottom: 20px;
        }
        
        .endpoint {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 15px;
            border-left: 4px solid #28a745;
        }
        
        .endpoint .method {
            display: inline-block;
            background: #28a745;
            color: white;
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            margin-right: 10px;
        }
        
        .endpoint .method.post {
            background: #ff6b6b;
        }
        
        .endpoint .path {
            color: #333;
            font-family: 'Courier New', monospace;
            font-size: 14px;
        }
        
        .endpoint .description {
            color: #666;
            font-size: 13px;
            margin-top: 8px;
        }
        
        .refresh-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            margin-top: 20px;
        }
        
        .refresh-btn:hover {
            background: #5568d3;
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
        }
        
        .status-badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            margin-top: 10px;
        }
        
        .status-badge.active {
            background: #d4edda;
            color: #155724;
        }
        
        .status-badge.idle {
            background: #fff3cd;
            color: #856404;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📡 BLS Sync Dashboard</h1>
            <p>Real-time monitoring and control center for multi-browser automation</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <h3>Total Users</h3>
                <div class="value" id="total-users">-</div>
                <div class="label">Connected browsers</div>
            </div>
            
            <div class="stat-card">
                <h3>Total Applicants</h3>
                <div class="value" id="total-applicants">-</div>
                <div class="label">Synced records</div>
            </div>
            
            <div class="stat-card">
                <h3>Server Status</h3>
                <div class="value">🟢</div>
                <div class="label">Online and running</div>
            </div>
        </div>
        
        <div class="broadcast-section">
            <h2>📢 Broadcast Command Center</h2>
            
            <div class="current-command">
                <h3>Current Broadcast Command</h3>
                <div id="command-status" class="status-badge idle">No command set</div>
                
                <div class="command-details">
                    <div class="command-item">
                        <div class="key">Location</div>
                        <div class="value" id="broadcast-location">-</div>
                    </div>
                    <div class="command-item">
                        <div class="key">Visa Type</div>
                        <div class="value" id="broadcast-visa">-</div>
                    </div>
                    <div class="command-item">
                        <div class="key">Timestamp</div>
                        <div class="value" id="broadcast-time">-</div>
                    </div>
                </div>
            </div>
            
            <button class="refresh-btn" onclick="loadBroadcastCommand()">
                🔄 Refresh Command Status
            </button>
        </div>
        
        <div class="info-section">
            <h2>📚 API Endpoints</h2>
            
            <div class="endpoint">
                <span class="method post">POST</span>
                <span class="path">/api/broadcast</span>
                <div class="description">Broadcast a new command to all listening browsers</div>
            </div>
            
            <div class="endpoint">
                <span class="method">GET</span>
                <span class="path">/api/broadcast</span>
                <div class="description">Get the current broadcast command</div>
            </div>
            
            <div class="endpoint">
                <span class="method post">POST</span>
                <span class="path">/api/sync</span>
                <div class="description">Sync applicant data to server</div>
            </div>
            
            <div class="endpoint">
                <span class="method">GET</span>
                <span class="path">/api/sync/:userId</span>
                <div class="description">Retrieve synced applicant data for a user</div>
            </div>
        </div>
    </div>
    
    <script>
        // Load statistics
        async function loadStats() {
            try {
                const response = await fetch('/api/stats');
                const data = await response.json();
                
                document.getElementById('total-users').textContent = data.totalUsers || 0;
                document.getElementById('total-applicants').textContent = data.totalApplicants || 0;
            } catch (error) {
                console.error('Error loading stats:', error);
            }
        }
        
        // Load broadcast command
        async function loadBroadcastCommand() {
            try {
                const response = await fetch('/api/broadcast');
                const data = await response.json();
                
                if (data.location && data.visaType) {
                    document.getElementById('broadcast-location').textContent = data.location;
                    document.getElementById('broadcast-visa').textContent = data.visaType;
                    
                    const date = new Date(data.timestamp);
                    document.getElementById('broadcast-time').textContent = date.toLocaleString();
                    
                    const statusBadge = document.getElementById('command-status');
                    statusBadge.textContent = 'Active broadcast';
                    statusBadge.className = 'status-badge active';
                } else {
                    document.getElementById('broadcast-location').textContent = '-';
                    document.getElementById('broadcast-visa').textContent = '-';
                    document.getElementById('broadcast-time').textContent = '-';
                    
                    const statusBadge = document.getElementById('command-status');
                    statusBadge.textContent = 'No command set';
                    statusBadge.className = 'status-badge idle';
                }
            } catch (error) {
                console.error('Error loading broadcast command:', error);
            }
        }
        
        // Load data on page load
        loadStats();
        loadBroadcastCommand();
        
        // Auto-refresh broadcast command every 5 seconds
        setInterval(loadBroadcastCommand, 5000);
    </script>
</body>
</html>
    `);
});

// Stats endpoint for dashboard
app.get('/api/stats', (req, res) => {
    const totalUsers = Object.keys(applicantsData).length;
    let totalApplicants = 0;
    
    for (const userId in applicantsData) {
        totalApplicants += applicantsData[userId].applicants.length;
    }
    
    res.json({
        success: true,
        totalUsers,
        totalApplicants,
        currentCommand
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        totalUsers: Object.keys(applicantsData).length,
        currentCommand: currentCommand
    });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`📡 Broadcast API ready`);
    console.log(`🔄 Sync API ready`);
});
