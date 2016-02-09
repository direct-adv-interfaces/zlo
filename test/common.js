global.chai = require('chai');
global.sinon = require('sinon');
global.expect = global.chai.expect;

var Zlo = require('../zlo'),
    clc = require('cli-color'),
    fs = require('fs-extra'),
    path = require('path'),
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

        zlo = new Zlo({ storage: { svn: 'svn', local: 'local'}, dependencies: [ { name: 'bla' } ] });

        expect(createConfigsSpy.called).to.be.true;

    });

    describe('Если есть local и svn - должны создаться файлы с зависимостями', function() {
        var writeSpy = sandbox.spy(fs, 'writeJson'),
            cwd = process.cwd();

        zlo = new Zlo({
            storage: { svn: 'svn', local: 'local' },
            dependencies: [
                {
                    "name": "bem",
                    "version": "0.6.16"
                },
                {
                    "type": "git",
                    "dest": ".",
                    "name": "schema-docs",
                    "repo": "git://github.yandex-team.ru/belyanskii/schema-docs.git",
                    "commit": "92a93b4360f8bf0e08a0790d23e68ae47e432347"
                }
            ]
        });

        it('Проверка создания .bowerrc', function() {
            expect(writeSpy.firstCall.args[0]).to.be.equal(path.resolve(cwd, '.bowerrc'));
            expect(writeSpy.firstCall.args[1]).to.deep.equal({ directory: 'libs' });
        });

        it('Проверка создания package.json', function() {
            expect(writeSpy.secondCall.args[0]).to.be.equal(path.resolve(cwd, 'package.json'));
            expect(writeSpy.secondCall.args[1]).to.deep.equal({ dependencies: { bem: '0.6.16' } });
        });

        it('Проверка создания bower.json', function() {
            expect(writeSpy.thirdCall.args[0]).to.be.equal(path.resolve(cwd, 'bower.json'));
            expect(writeSpy.thirdCall.args[1]).to.deep.equal({
                dependencies: {
                    "schema-docs": "git://github.yandex-team.ru/belyanskii/schema-docs.git#92a93b4360f8bf0e08a0790d23e68ae47e432347"
                },
                name: 'zlo',
                resolutions: []
            });
        });
    });

});
