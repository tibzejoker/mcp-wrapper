const http = require('http');
const { exec } = require('child_process');
const dns = require('dns');

// Helper function to get formatted timestamp
function getTimestamp() {
  const now = new Date();
  return `[${now.toISOString()}]`;
}

// Create a simple HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Network test server running. Check console for results.\n');
});

// Function to ping the IP address
function pingIP() {
  const command = process.platform === 'win32' 
    ? 'ping -n 1 192.168.1.1' 
    : 'ping -c 1 192.168.1.1';
  
  console.log(`\n${getTimestamp()} --- PING TEST ---`);
  console.log(`${getTimestamp()} Executing ping to 192.168.1.1...`);
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`${getTimestamp()} Ping error: ${error.message}`);
      return;
    }
    
    if (stderr) {
      console.error(`${getTimestamp()} Ping stderr: ${stderr}`);
      return;
    }
    
    console.log(`${getTimestamp()} Ping success`);
  });
}

// Function to perform DNS lookup
function dnsLookup() {
  console.log(`\n${getTimestamp()} --- DNS TEST ---`);
  console.log(`${getTimestamp()} Performing DNS lookup for google.com...`);
  
  dns.lookup('google.com', (err, address, family) => {
    if (err) {
      console.error(`${getTimestamp()} DNS lookup error: ${err.message}`);
      return;
    }
    
    console.log(`${getTimestamp()} DNS lookup resolved to: ${address} (IPv${family})`);
  });
}

// Function to make HTTP request
function httpRequest() {
  console.log(`\n${getTimestamp()} --- HTTP TEST ---`);
  console.log(`${getTimestamp()} Executing HTTP request to example.com...`);
  
  const options = {
    hostname: 'example.com',
    port: 80,
    path: '/',
    method: 'GET',
    timeout: 3000 // 3 second timeout
  };
  
  const req = http.request(options, (res) => {
    console.log(`${getTimestamp()} HTTP Request Status: ${res.statusCode}`);
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log(`${getTimestamp()} HTTP Request Complete (${data.length} bytes)`);
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

// Run all network tests
function runNetworkTests() {
  console.log(`\n${getTimestamp()} ========== RUNNING NETWORK TESTS ==========`);
  pingIP();
  dnsLookup();
  httpRequest();
  console.log(`${getTimestamp()} ==========================================`);
}

// Start the server
const PORT = 3003;
server.listen(PORT, () => {
  console.log(`${getTimestamp()} Network Test Server running at http://localhost:${PORT}/`);
  console.log(`${getTimestamp()} Starting network tests every second`);
  
  // Run tests every second
  setInterval(runNetworkTests, 1000);
  
  // Execute first test immediately
  runNetworkTests();
});

// Handle server shutdown
process.on('SIGINT', () => {
  console.log(`${getTimestamp()} Server shutting down`);
  server.close(() => {
    console.log(`${getTimestamp()} Server closed`);
    process.exit(0);
  });
}); 