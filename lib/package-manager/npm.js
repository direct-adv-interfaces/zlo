'use strict';

var fs = require('fs-extra'),
    util = require('util'),
    md5 = require('md5'),
    Promise = require('promise'),
    PackageManager = require('./package-manager'),
    spawn = require('child_process').spawn;

function NPM(options) {
    NPM.super_.apply(this, arguments);
    this.type = 'npm';
}

util.inherits(NPM, PackageManager);

NPM.prototype.load = function(onTimeEnds) {
    this.logger.info('npm install');

    var timer,
        spawnCmd;

    return new Promise(function(resolve, reject) {
        timer = setTimeout(function() {
            onTimeEnds('Time is up', null, true);
            reject();
        }.bind(this), this.TIMEOUT);

        spawnCmd = spawn('npm', ['install']);

        spawnCmd.stdout.on('data', function(data) {
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
                this.logger.info('npm install finished');
                resolve();
            }

        }.bind(this));
    }.bind(this));
};

NPM.prototype.getHashSum = function() {
    var packageContent = fs.existsSync('npm-shrinkwrap.json') ? fs.readJsonSync('npm-shrinkwrap.json') : fs.readJsonSync('package.json');

    return md5(JSON.stringify(packageContent))
};

module.exports = NPM;
