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

switch (program.target) {
    //если target === svn - чистим svn-кэш
    case 'svn':
        target.svn = true;
        break;
    //если target == local - чистим локальный кэш
    case 'local':
        target.local = true;
        break;
    //если не указан target то чистим весь кэш
    default:
        target = { svn: true, local: true };
}

if (program.kill) {
    zlo.killMD5(target);
} else if (program.killAll) {
    zlo.killAll(target);
} else if (program.createConfig) {
    zlo.createConfigs();
} else {
    zlo.loadDependencies();
}
