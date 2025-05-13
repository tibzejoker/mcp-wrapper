const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = {
  mode: 'production',
  target: 'node',
  externals: [nodeExternals()],
  entry: './network_test_server.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'network_test_server.bundle.js'
  }
}; 