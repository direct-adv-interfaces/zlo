'use strict';

var colors = require('colors'),
    fs = require('fs-extra');

function Logger(options) {
    return require('tracer').colorConsole({
        methods: [ 'debug', 'info', 'warn', 'success', 'error'],
        level: options.verbose ? 'debug' : 'info',
        filters: {
            debug: colors.blue,
            warn: colors.yellow,
            success: [colors.green, colors.bold],
            error: [colors.red, colors.bold]
        },
        transport: [
            function (data) {
                fs.appendFile('zlo-debug.log', data.output + '\n', function(err) {
                    if (err) throw err;
                });
            },
            function(data) {
                console.log(data.output);
            }
        ]
    });
}

module.exports = Logger;
