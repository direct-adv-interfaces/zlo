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
    zlo = new Zlo(configJSON, { verbose: program.verbose });


if (program.kill) {
    zlo.killMD5({ svn: !program.target || program.target == 'svn', local: !program.target || program.target == 'local' });
} else if (program.killAll) {
    zlo.killAll({ svn: !program.target || program.target == 'svn', local: !program.target || program.target == 'local' });
}  else if (program.createConfig) {
    zlo.createConfigs();
} else {
    zlo.loadDependencies();
}
