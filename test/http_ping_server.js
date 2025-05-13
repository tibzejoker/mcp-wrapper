const http = require('http');

// Helper function to get formatted timestamp
function getTimestamp() {
  const now = new Date();
  return `[${now.toISOString()}]`;
}

// Create a simple HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('HTTP Ping server running. Check console for request results.\n');
});

// Function to make HTTP request to the IP
function httpRequestIP() {
  console.log(`${getTimestamp()} Executing HTTP request to 192.168.1.1...`);
  
  const options = {
    hostname: '192.168.1.1',
    port: 80,
    path: '/',
    method: 'GET',
    timeout: 3000 // 3 second timeout
  };
  
  const req = http.request(options, (res) => {
    console.log(`${getTimestamp()} HTTP Request Status: ${res.statusCode}`);
    console.log(`${getTimestamp()} HTTP Request Headers: ${JSON.stringify(res.headers)}`);
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log(`${getTimestamp()} HTTP Request Response length: ${data.length} bytes`);
    });
  });
  
  req.on('error', (error) => {
    console.error(`${getTimestamp()} HTTP Request Error: ${error.message}`);
  });
  
  req.on('timeout', () => {
    console.error(`${getTimestamp()} HTTP Request timed out`);
    req.destroy();
  });
  
  req.end();
}

// Start the server
const PORT = 3002;
server.listen(PORT, () => {
  console.log(`${getTimestamp()} HTTP Ping Server running at http://localhost:${PORT}/`);
  console.log(`${getTimestamp()} Starting HTTP request loop to 192.168.1.1 every second`);
  
  // Make HTTP requests every second
  setInterval(httpRequestIP, 1000);
  
  // Execute first request immediately
  httpRequestIP();
});

// Handle server shutdown
process.on('SIGINT', () => {
  console.log(`${getTimestamp()} Server shutting down`);
  server.close(() => {
    console.log(`${getTimestamp()} Server closed`);
    process.exit(0);
  });
}); 