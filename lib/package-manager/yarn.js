'use strict';

var fs = require('fs-extra'),
    util = require('util'),
    md5 = require('md5'),
    Promise = require('promise'),
    PackageManager = require('./package-manager'),
    spawn = require('child_process').spawn,
    path = require('path');

function Yarn(options) {
    Yarn.super_.apply(this, arguments);
    this.type = 'yarn';
}

util.inherits(Yarn, PackageManager);

Yarn.prototype.load = function(onTimeEnds) {
    this.logger.info('yarn install');

    var timer,
        spawnCmd,
        yarnPath = path.resolve('/', __dirname, '../../node_modules/yarn/bin/yarn.js');

    return new Promise(function(resolve, reject) {
        timer = setTimeout(function() {
            onTimeEnds('Time is up', null, true);
            reject();
        }.bind(this), this.TIMEOUT);
        spawnCmd = spawn(process.argv[0], [yarnPath, 'install']);

        spawnCmd.stdout.on('data', function(data, e) {
            this.logger.debug('stdout: ' + data);
        }.bind(this));

        spawnCmd.stderr.on('data', function(data) {
            data  = data + '';
            if (data && data.match('ERR!')) {
                //ошибки показываем в любом режиме
                this.logger.error(data);
            } else {
                //предупреждения - только в verbose-режиме
                this.logger.debug('stderr: ' + data);
            }
        }.bind(this));

        spawnCmd.on('error', function(err) {
            this.logger.error(err);
            clearTimeout(timer);
            reject();
        }.bind(this));

        spawnCmd.on('exit', function(code) {
            clearTimeout(timer);

            if (code) {
                reject();
            } else {
                this.logger.info('yarn install finished');
                resolve();
            }

        }.bind(this));
    }.bind(this));
};


Yarn.prototype.getHashSum = function() {
    var packageContent = fs.existsSync('yarn.lock') ? fs.readJsonSync('yarn.lock') : fs.readJsonSync('package.json');

    return md5(JSON.stringify(packageContent))
};

module.exports = Yarn;

