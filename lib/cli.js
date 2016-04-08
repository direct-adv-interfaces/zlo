var program = require('commander'),
    Zlo = require('./zlo'),
    fs = require('fs-extra');


program
   .option('--kill', 'Clear current md5-cache from local storage and svn')
   .option('--kill-svn', 'Clear current md5-cache from svn only')
   .option('--kill-all', 'Clear all md5-caches from local storage and svn')
   .option('--kill-all-svn', 'Clear all md5-caches from svn only')
   .option('--verbose', 'Verbose debug messages')
   .option('--dev', 'Load dev dependencies')
   .parse(process.argv);

var config = fs.readJsonSync('zlo-config.json'),
    packageData = fs.readJsonSync('package.json'),
    zlo = new Zlo(config, packageData, { verbose: program.verbose, dev: program.dev });


if (program.kill) {
    zlo.killMD5();
} else if (program.killSvn) {
    zlo.killMD5({ svnOnly: true });
} else if (program.killAll) {
    zlo.killAll();
} else if (program.killAllSvn) {
    zlo.killAll({ svnOnly: true });
} else {
    zlo.loadDependencies();
}
