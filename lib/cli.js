var program = require('commander'),
    Zlo = require('./zlo'),
    fs = require('fs-extra');


program
   .option('--kill', 'Clear current md5-cache from local storage and svn')
   .option('--kill-svn', 'Clear current md5-cache from svn only')
   .option('--kill-all', 'Clear all md5-caches from local storage and svn')
   .option('--kill-all-svn', 'Clear all md5-caches from svn only')
   .option('--create-config', 'Create bower.json and package.json')
   .option('--verbose', 'Verbose debug messages')
   .parse(process.argv);

var configJSON = fs.readJsonSync('zlo.json'),
    zlo = new Zlo(configJSON, { verbose: program.verbose });


if (program.kill) {
    zlo.killMD5();
} else if (program.killSvn) {
    zlo.killMD5({ svnOnly: true });
} else if (program.killAll) {
    zlo.killAll();
} else if (program.killAllSvn) {
    zlo.killAll({ svnOnly: true });
} else if (program.createConfig) {
    zlo.createConfigs();
} else {
    zlo.loadDependencies();
}
