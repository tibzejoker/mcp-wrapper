const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = {
  mode: 'production',
  target: 'node',
  externals: [nodeExternals()],
  entry: './ping_server.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'ping_server.bundle.js'
  }
}; 