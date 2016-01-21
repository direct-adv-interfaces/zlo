global.chai = require('chai');
global.expect = global.chai.expect;

var Zlo = require('../zlo'),
    zlo;

var exit = process.exit;

process.exit = function (code) {
  setTimeout(function () {
      exit();
  }, 200);
};

describe('Base API', function() {
    before(function() {
        zlo = new Zlo({
            configJSON: {
                storage: {
                    local: '../test'
                }
            }
        });
    });

    ['killAll', 'createLoadingConfigs', 'killMD5', 'loadDependencies'].forEach(function(name) {
        it(name + ' expect to be a function', function() {
            expect(typeof zlo[name]).to.be.equal('function');
        });
    });
});
