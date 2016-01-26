var program = require('commander'),
    Zlo = require('./zlo'),
    zlo = new Zlo();

program
   .option('--kill', 'Clear current md5-cache from local storage and svn')
   .option('--kill-all', 'Clear all md5-caches from local storage and svn')
   .option('--create-config', 'Create bower.json and package.json')
   .parse(process.argv);

if (program.kill) {
    zlo.killMD5();
} else if (program.killAll) {
    zlo.killAll();
} else if (program.createConfig) {
    zlo.createLoadingConfigs();
} else {
    zlo.loadDependencies();
}
