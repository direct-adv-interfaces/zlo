var program = require('commander'),
    fs = require('fs-extra'),
    path = require('path'),
    Zlo = require('./zlo');

program
   .option('--kill', 'Clear current md5-cache from local storage and svn')
   .option('--kill-all', 'Clear all md5-caches from local storage and svn')
   .option('--create-config', 'Create bower.json and package.json')
   .option('--test', 'Test')
   .parse(process.argv);

var cwd = process.cwd(),
    configJSON = fs.readJsonSync(path.resolve(cwd, 'zlo.json')),
    zlo = new Zlo(configJSON);
if (program.test) {
    zlo.onLoadSuccess('local');
} else if (program.kill) {
    zlo.killMD5();
} else if (program.killAll) {
    zlo.killAll();
} else if (program.createConfig) {
    zlo.createLoadingConfigs();
} else {
    zlo.loadDependencies();
}
