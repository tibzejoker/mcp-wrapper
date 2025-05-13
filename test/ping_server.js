const http = require('http');
const { exec } = require('child_process');

// Helper function to get formatted timestamp
function getTimestamp() {
  const now = new Date();
  return `[${now.toISOString()}]`;
}

// Create a simple HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Ping server running. Check console for ping results.\n');
});

// Function to ping the IP address
function pingIP() {
  const command = process.platform === 'win32' 
    ? 'ping -n 1 192.168.1.1' 
    : 'ping -c 1 192.168.1.1';
  
  console.log(`${getTimestamp()} Executing ping request to 192.168.1.1...`);
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`${getTimestamp()} Ping error: ${error.message}`);
      return;
    }
    
    if (stderr) {
      console.error(`${getTimestamp()} Ping stderr: ${stderr}`);
      return;
    }
    
    console.log(`${getTimestamp()} Ping result: ${stdout}`);
  });
}

// Start the server
const PORT = 3001;
server.listen(PORT, () => {
  console.log(`${getTimestamp()} Server running at http://localhost:${PORT}/`);
  console.log(`${getTimestamp()} Starting ping loop to 192.168.1.1 every second`);
  
  // Ping every second
  setInterval(pingIP, 1000);
  
  // Execute first ping immediately
  pingIP();
});

// Handle server shutdown
process.on('SIGINT', () => {
  console.log(`${getTimestamp()} Server shutting down`);
  server.close(() => {
    console.log(`${getTimestamp()} Server closed`);
    process.exit(0);
  });
}); 