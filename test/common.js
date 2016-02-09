global.chai = require('chai');
global.sinon = require('sinon');
global.expect = global.chai.expect;

var Zlo = require('../zlo'),
    clc = require('cli-color'),
    sandbox = sinon.sandbox.create({
        properties: ["spy", "stub", "mock", "clock", "server", "requests"],
        useFakeTimers: true
    }),
    zlo;

var exit = process.exit;

process.exit = function (code) {
  setTimeout(function () {
      exit(code);
  }, 200);
};

describe('Base API', function() {
    before(function() {
        zlo = new Zlo({
            configJSON: {
                storage: {
                    local: '../test',
                    svn: 'bla'
                }
            }
        });
    });

    ['killAll', 'killMD5', 'createConfigs', 'loadDependencies'].forEach(function(name) {
        it(name + ' expect to be a function', function() {
            expect(typeof zlo[name]).to.be.equal('function');
        });
    });
});

describe('Выход с ошибкой если в Zlo не переданы параметры при создании', function() {
    var processSpy,
        errorLogSpy;

    beforeEach(function() {
        errorLogSpy = sandbox.spy(console, 'error');
        processSpy = sandbox.spy(process, 'exit');
    });

    afterEach(function() {
        sandbox.restore();
    });

    it('В конфиге не передано поле storage', function() {
        zlo = new Zlo({});

        expect(errorLogSpy.calledWith(clc.red('Empty local storage path'))).to.be.true;
        expect(processSpy.calledWith(0)).to.be.true;
    });


    it('В конфиге не передано поле storage без поля svn - Empty local storage path', function() {
        zlo = new Zlo({ storage: { local: 'local' }});

        expect(errorLogSpy.calledWith(clc.red('Empty local storage path'))).to.be.true;
        expect(processSpy.calledWith(0)).to.be.true;
    });

    it('В конфиге не передано поле storage без поля local - Empty local storage path', function() {
        zlo = new Zlo({ storage: { svn: 'svn' }});

        expect(errorLogSpy.calledWith(clc.red('Empty local storage path'))).to.be.true;
        expect(processSpy.calledWith(0)).to.be.true;
    });

    it('В конфиге не передано поле storage с svn и svn, но не передано dependencies - Empty dependencies', function() {
        zlo = new Zlo({ storage: { svn: 'svn', local: 'local' }});

        expect(errorLogSpy.calledWith(clc.red('Empty dependencies'))).to.be.true;
        expect(processSpy.calledWith(0)).to.be.true;
    });

    it('Если есть local и svn - вызываем createConfigs', function() {
        var createConfigsSpy = sandbox.spy(Zlo.prototype, 'createConfigs');

        zlo = new Zlo({ storage: { svn: 'svn', local: 'local' }});

        expect(createConfigsSpy.called).to.be.true;

    });

    it('Если есть local и svn - должны создаться файлы с зависимостями', function() {
        var writeSpy = sandbox.spy(fs, 'writeJson');

        zlo = new Zlo({
            storage: { svn: 'svn', local: 'local' },
            dependencies: [
                { type: 'git', name: 'bla' },
                { name: 'bla1' }
            ]
        });

        expect(writeSpy.called).to.be.true;
    });

});
