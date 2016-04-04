var program = require('commander'),
    Zlo = require('./zlo'),
    fs = require('fs-extra');


program
   .option('-t, --target [target]', 'Target for kill command')
   .option('--kill', 'Clear current md5-cache from target')
   .option('--kill-all', 'Clear all md5-caches from target')
   .option('--create-config', 'Create bower.json and package.json')
   .option('--verbose', 'Verbose debug messages')
   .parse(process.argv);

var configJSON = fs.readJsonSync('zlo.json'),
    zlo = new Zlo(configJSON, { verbose: program.verbose }),
    target = {};

//если target === svn - чистим svn-кэш
if (program.target === 'svn') {
    target.svn = true;
}
//если target == local - чистим локальный кэш
if (program.target === 'local') {
    target.local = true;
}
//если не указан target то чистим весь кэш
if (program.target !== 'svn' && program.target !== 'local') {
    target = { svn: true, local: true };
}

if (program.kill) {
    zlo.killMD5(target);
} else if (program.killAll) {
    zlo.killAll(target);
}  else if (program.createConfig) {
    zlo.createConfigs();
} else {
    zlo.loadDependencies();
}
