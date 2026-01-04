const express = require('express');
const app = express();

const requestCounts = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60000;

const TOKEN_EXPIRY_TIME = 3600;
let tokenIssuedAt = Date.now();

let requestCounter = 0;

app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.post('/auth/token', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header. Expected: Basic <base64>' 
    });
  }
  
  const base64Creds = authHeader.replace('Basic ', '');
  let decoded;
  
  try {
    decoded = Buffer.from(base64Creds, 'base64').toString('utf-8');
  } catch (error) {
    return res.status(401).json({ 
      error: 'Invalid base64 encoding' 
    });
  }
  
  const [email, password] = decoded.split(':');
  
  if (email === 'admin@mixoads.com' && password === 'SuperSecret123!') {
    tokenIssuedAt = Date.now();
    
    console.log('Token issued successfully');
    
    return res.json({
      access_token: 'mock_access_token_' + Date.now(),
      token_type: 'Bearer',
      expires_in: TOKEN_EXPIRY_TIME,
      issued_at: Math.floor(tokenIssuedAt / 1000)
    });
  }
  
  console.log('Invalid credentials');
  res.status(401).json({ 
    error: 'Invalid credentials',
    message: 'Email or password is incorrect'
  });
});

function rateLimitMiddleware(req, res, next) {
  const clientId = req.headers['x-client-id'] || 'default';
  const now = Date.now();
  
  if (!requestCounts.has(clientId)) {
    requestCounts.set(clientId, []);
  }
  
  const requests = requestCounts.get(clientId);
  
  const recentRequests = requests.filter(time => now - time < RATE_WINDOW);
  
  if (recentRequests.length >= RATE_LIMIT) {
    console.log(`Rate limit exceeded for client: ${clientId}`);
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: `Too many requests. Limit: ${RATE_LIMIT} per minute`,
      retry_after: 60
    });
  }
  
  recentRequests.push(now);
  requestCounts.set(clientId, recentRequests);
  
  next();
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Missing or invalid Bearer token'
    });
  }
  
  const token = authHeader.replace('Bearer ', '');
  
  const tokenAge = Date.now() - tokenIssuedAt;
  if (tokenAge > TOKEN_EXPIRY_TIME * 1000) {
    console.log('Token expired');
    return res.status(401).json({ 
      error: 'Token expired',
      message: 'Access token has expired. Please obtain a new token.',
      expired_at: new Date(tokenIssuedAt + TOKEN_EXPIRY_TIME * 1000).toISOString()
    });
  }
  
  next();
}

app.get('/api/campaigns', authMiddleware, rateLimitMiddleware, (req, res) => {
  requestCounter++;
  
  if (requestCounter % 10 === 0) {
    console.log('Simulating timeout (no response)');
    return;
  }
  
  if (requestCounter % 5 === 0) {
    console.log('Simulating 503 Service Unavailable');
    return res.status(503).json({
      error: 'Service temporarily unavailable',
      message: 'The service is experiencing issues. Please retry after a short delay.'
    });
  }
  
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  
  const campaigns = [];
  for (let i = 0; i < limit; i++) {
    const id = (page - 1) * limit + i + 1;
    campaigns.push({
      id: `campaign_${id}`,
      name: `Campaign ${id}`,
      status: 'active',
      budget: 1000 + id * 100,
      impressions: Math.floor(Math.random() * 10000),
      clicks: Math.floor(Math.random() * 500),
      conversions: Math.floor(Math.random() * 50),
      created_at: new Date(Date.now() - id * 86400000).toISOString()
    });
  }
  
  console.log(`Returning ${campaigns.length} campaigns (page ${page})`);
  
  res.json({
    data: campaigns,
    pagination: {
      page,
      limit,
      total: 100,
      has_more: page < 10
    }
  });
});

app.post('/api/campaigns/:id/sync', authMiddleware, rateLimitMiddleware, (req, res) => {
  const { id } = req.params;
  
  console.log(`Syncing campaign: ${id}`);
  
  setTimeout(() => {
    res.json({
      success: true,
      campaign_id: id,
      synced_at: new Date().toISOString(),
      message: 'Campaign data synced successfully'
    });
  }, 2000);
});

app.get('/api/error', (req, res) => {
  const error = new Error('Simulated server error');
  console.error(error);
  
  res.status(500).json({
    error: error.message,
    stack: error.stack
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('Mock Ad Platform API Server');
  console.log('='.repeat(60));
  console.log(`Server running on: http://localhost:${PORT}`);
  console.log(`Valid credentials: admin@mixoads.com / SuperSecret123!`);
  console.log(`Token expiry: ${TOKEN_EXPIRY_TIME} seconds (1 hour)`);
  console.log(`Rate limit: ${RATE_LIMIT} requests per minute`);
  console.log('='.repeat(60));
  console.log('\nEndpoints:');
  console.log('  POST /auth/token              - Get access token');
  console.log('  GET  /api/campaigns           - List campaigns (paginated)');
  console.log('  POST /api/campaigns/:id/sync  - Sync campaign data');
  console.log('  GET  /health                  - Health check');
  console.log('='.repeat(60));
});
