var program = require('commander'),
    Zlo = require('./zlo'),
    fs = require('fs-extra');


program
   .option('-t, --target [target]', 'Target for kill command')
   .option('--kill', 'Clear current md5-cache from target')
   .option('--kill-all', 'Clear all md5-caches from target')
   .option('--create-config', 'Create bower.json and package.json')
   .option('--verbose', 'Verbose debug messages')
   .option('--dev', 'Load dev dependencies')
   .parse(process.argv);

var config = fs.readJsonSync('zlo-config.json'),
    target = {},
    packageData = fs.readJsonSync('package.json'),
    zlo = new Zlo(config, packageData, { verbose: program.verbose, dev: program.dev, loadingTimeout: config.loadingTimeout });

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
} else {
    zlo.loadDependencies();
}
