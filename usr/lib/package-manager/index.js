'use strict';

var Yarn = require('./yarn'),
    NPM = require('./npm');

module.exports = function (options) {
    if (options.useYarn) {
        return new Yarn(options);
    } else {
        return new NPM(options);
    }
};
