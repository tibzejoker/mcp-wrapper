const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = {
  mode: 'production',
  target: 'node',
  externals: [nodeExternals()],
  entry: './http_ping_server.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'http_ping_server.bundle.js'
  }
}; 