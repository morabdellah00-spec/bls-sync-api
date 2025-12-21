const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// In-memory storage
const users = new Map();
const applicantData = new Map();

// Generate API key
function generateApiKey() {
  return crypto.randomBytes(32).toString('hex');
}

// Middleware to verify API key
function verifyApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  
  const user = Array.from(users.values()).find(u => u.apiKey === apiKey);
  if (!user) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  req.userId = user.id;
  next();
}

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'BLS Applicant Manager Sync API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Register/Login
app.post('/api/auth/register', (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    let user = Array.from(users.values()).find(u => u.email === email);
    
    if (user) {
      if (user.passwordHash !== passwordHash) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    } else {
      const userId = crypto.randomUUID();
      const apiKey = generateApiKey();
      
      user = {
        id: userId,
        email,
        passwordHash,
        apiKey,
        createdAt: new Date().toISOString()
      };
      
      users.set(userId, user);
    }
    
    res.json({
      apiKey: user.apiKey,
      userId: user.id,
      email: user.email
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all applicants
app.get('/api/applicants', verifyApiKey, (req, res) => {
  try {
    const data = applicantData.get(req.userId) || { applicants: [], groups: [] };
    res.json(data);
  } catch (error) {
    console.error('Get applicants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sync applicants
app.post('/api/applicants/sync', verifyApiKey, (req, res) => {
  try {
    const { applicants, groups } = req.body;
    
    if (!Array.isArray(applicants)) {
      return res.status(400).json({ error: 'Applicants must be an array' });
    }
    
    const existingData = applicantData.get(req.userId) || { 
      applicants: [], 
      groups: [],
      lastModified: new Date().toISOString()
    };
    
    const mergedApplicants = new Map();
    existingData.applicants.forEach(app => {
      if (app.PassportNo) mergedApplicants.set(app.PassportNo, app);
    });
    
    applicants.forEach(app => {
      if (app.PassportNo) mergedApplicants.set(app.PassportNo, app);
    });
    
    const mergedGroups = Array.from(new Set([
      ...(existingData.groups || []),
      ...(groups || [])
    ]));
    
    const updatedData = {
      applicants: Array.from(mergedApplicants.values()),
      groups: mergedGroups,
      lastModified: new Date().toISOString()
    };
    
    applicantData.set(req.userId, updatedData);
    
    res.json({
      success: true,
      data: updatedData,
      stats: {
        totalApplicants: updatedData.applicants.length,
        totalGroups: updatedData.groups.length
      }
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Replace all applicants
app.put('/api/applicants', verifyApiKey, (req, res) => {
  try {
    const { applicants, groups } = req.body;
    
    if (!Array.isArray(applicants)) {
      return res.status(400).json({ error: 'Applicants must be an array' });
    }
    
    const data = {
      applicants,
      groups: groups || [],
      lastModified: new Date().toISOString()
    };
    
    applicantData.set(req.userId, data);
    
    res.json({
      success: true,
      data,
      stats: {
        totalApplicants: data.applicants.length,
        totalGroups: data.groups.length
      }
    });
  } catch (error) {
    console.error('Put applicants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete all applicants
app.delete('/api/applicants', verifyApiKey, (req, res) => {
  try {
    applicantData.delete(req.userId);
    res.json({
      success: true,
      message: 'All applicants deleted'
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get sync status
app.get('/api/sync/status', verifyApiKey, (req, res) => {
  try {
    const data = applicantData.get(req.userId);
    
    res.json({
      hasSyncedData: !!data,
      lastModified: data?.lastModified || null,
      applicantCount: data?.applicants?.length || 0,
      groupCount: data?.groups?.length || 0
    });
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Get port from environment or use 3000
const PORT = process.env.PORT || 3000;

// Start server - bind to 0.0.0.0 for Railway
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BLS Sync API running on 0.0.0.0:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});
