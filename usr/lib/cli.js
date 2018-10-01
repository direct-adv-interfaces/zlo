var program = require('commander'),
    Zlo = require('./zlo'),
    fs = require('fs-extra'),
    _ = require('lodash'),
    initLogger = require('./logger');


program
   .option('-t, --target [target]', 'Target for kill command')
   .option('--kill', 'Clear current md5-cache from target')
   .option('--kill-all', 'Clear all md5-caches from target')
   .option('--kill-all-except-current', 'Clear all md5-caches from target except current')
   .option('--verbose', 'Verbose debug messages')
   .option('--dev', 'Load dev dependencies')
   .option('--disable-svn', 'Disable svn cache')
   .parse(process.argv);

var config = fs.readJsonSync('zlo-config.json'),
    target = {},
    packageData = fs.readJsonSync('package.json'),
    zlo = new Zlo(config, packageData, {
        verbose: program.verbose,
        dev: program.dev,
        loadTimeout: config.loadTimeout ,
        disableSvn: program.disableSvn
    }),
    logger = initLogger({
        verbose: program.verbose
    });

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
} else if (program.killAllExceptCurrent) {
    zlo.killAllExceptCurrent(target);
} else {
    new Promise(function(resolve, reject) {
        var beforeLoad = config.beforeLoad;

        if (_.isObject(beforeLoad)) {
             if (beforeLoad.killAllExceptCurrent) {
                 var target = _.get(beforeLoad.killAllExceptCurrent, 'target', { svn: true, local: true });

                 return zlo.killAllExceptCurrent(target, { continueProcess: true, skipCleanup: true })
                     .then(resolve)
                     .catch(reject)
             } else if (beforeLoad.killAll) {
                 var target = _.get(beforeLoad.killAll, 'target', { svn: true, local: true });

                 return zlo.killAll(target, { continueProcess: true, skipCleanup: true })
                     .then(resolve)
                     .catch(reject)
             }
        } else {
            return resolve();
        }
    })
        .then(function() {
            return zlo.loadDependencies();
        })
        .catch(function(e) {
            logger.error(e);
        });
}
