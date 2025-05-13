const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = {
  mode: 'production',
  target: 'node',
  externals: [nodeExternals()],
  entry: {
    ping: './ping_server.js',
    http: './http_ping_server.js',
    network: './network_test_server.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name]_server.bundle.js'
  }
}; 