'use strict';

var initLogger = require('../logger');

function PackageManager(options) {
    this.TIMEOUT = options.TIMEOUT;

    this.logger = initLogger({
        verbose: options.verbose
    });
}


PackageManager.prototype.load = function() {

};


module.exports = PackageManager;

