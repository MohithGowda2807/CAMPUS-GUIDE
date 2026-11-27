const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Limit Metro worker processes to 2 so Windows virtual memory / pagefile is not exhausted during Gradle builds
config.maxWorkers = 2;

module.exports = config;
