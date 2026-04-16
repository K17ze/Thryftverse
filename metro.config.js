const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Ensure transitive CJS helpers are resolvable from all packages.
config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  tslib: path.resolve(__dirname, 'node_modules/tslib'),
};

module.exports = config;
