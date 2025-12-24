const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve dashboard as homepage
app.get('/', (req, res) => {
  // Check if requesting JSON API
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({ 
      status: 'ok', 
      service: 'BLS Applicant Manager Sync API',
      version: '1.0.0'
    });
  }
  
  // Otherwise serve the dashboard
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

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
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'BLS Applicant Manager Sync API',
    version: '1.0.0'
  });
});

// Register/Login
app.post('/api/auth/register', (req, res) => {
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
});

// Get all applicants
app.get('/api/applicants', verifyApiKey, (req, res) => {
  const data = applicantData.get(req.userId) || { applicants: [], groups: [] };
  res.json(data);
});

// Sync applicants (merge strategy)
app.post('/api/applicants/sync', verifyApiKey, (req, res) => {
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
    if (app.PassportNo) {
      mergedApplicants.set(app.PassportNo, app);
    }
  });
  
  applicants.forEach(app => {
    if (app.PassportNo) {
      mergedApplicants.set(app.PassportNo, app);
    }
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
});

// Replace all applicants (full sync)
app.put('/api/applicants', verifyApiKey, (req, res) => {
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
});

// Delete all applicants
app.delete('/api/applicants', verifyApiKey, (req, res) => {
  applicantData.delete(req.userId);
  
  res.json({
    success: true,
    message: 'All applicants deleted'
  });
});

// Get sync status
app.get('/api/sync/status', verifyApiKey, (req, res) => {
  const data = applicantData.get(req.userId);
  
  res.json({
    hasSyncedData: !!data,
    lastModified: data?.lastModified || null,
    applicantCount: data?.applicants?.length || 0,
    groupCount: data?.groups?.length || 0
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Get port from Railway's environment
const PORT = parseInt(process.env.PORT || '3000', 10);

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BLS Sync API running on 0.0.0.0:${PORT}`);
});

// Handle graceful shutdown
const shutdown = () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  
  setTimeout(() => {
    console.error('Forcing shutdown');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
