global.chai = require('chai');
global.sinon = require('sinon');
global.expect = global.chai.expect;
var Zlo = require('../lib/zlo'),
    chaiAsPromised = require('chai-as-promised'),
    colors = require('colors'),
    logger = require('tracer').colorConsole({
        methods: ['debug', 'info', 'warn', 'success', 'error'],
        level: 'debug',
        filters: {
            debug: colors.blue,
            warn: colors.yellow,
            success: [colors.green, colors.bold],
            error: [colors.red, colors.bold]
        }
    }),
    fs = require('fs-extra'),
    path = require('path'),
    Promise = require('promise'),
    sandbox = sinon.sandbox.create({
        properties: ["spy", "stub", "mock", "clock", "server", "requests"],
        useFakeTimers: true
    }),
    zlo,
    finishStub,
    removeOldDependenciesStub;

chai.use(chaiAsPromised);

describe('Вывод ошибок при ошибках входных данных', function() {
    var endFailStub,
        endSuccessStub;

    beforeEach(function() {
        removeOldDependenciesStub = sandbox.stub(Zlo.prototype, '_removeOldDependencies').callsFake(function() {});
        endFailStub = sandbox.stub(Zlo.prototype, '_endFail').callsFake(function() {});
        endSuccessStub = sandbox.stub(Zlo.prototype, '_endSuccess').callsFake(function() {});
    });

    afterEach(function() {
        sandbox.restore();
    });

    it('В конфиге не передано поле localCachePath - выходим c ошибкой', function() {
        zlo = new Zlo({ svnCachePath: 'bla' });

        expect(endFailStub.calledWith('Empty local storage path')).to.be.true;
    });

    it('В конфиге не передано поле svnCachePath - выходим c ошибкой', function() {
        zlo = new Zlo({ localCachePath: 'bla'});

        expect(endFailStub.calledWith('Empty svn storage path')).to.be.true;
    });

    it('Если передан пустой файл с зависимостями - выходим c ошибкой', function() {
        zlo = new Zlo({ localCachePath: 'bla', svnCachePath: 'bla' });

        expect(endFailStub.calledWith('Empty dependencies')).to.be.true;
    });

});


describe('Загрузка зависимостей', function() {
    function initZlo(options) {
        options = options || {};

        zlo = new Zlo(
            {
                localCachePath: 'local',
                svnCachePath: 'svn'
            },
            {
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
            },
            { verbose: true, dev: false, loadTimeout: 10, disableSvn: options.disableSvn || false });

        //стабим функции, которые работают с svn и файловой системой
        sandbox.stub(Zlo.prototype, '_doCmd').resolves();

        sandbox.stub(Zlo.prototype, '_doCleanup').resolves();

        finishStub = sandbox.stub(Zlo.prototype, '_onLoadingFinished').resolves();

        removeOldDependenciesStub = sandbox.stub(Zlo.prototype, '_removeOldDependencies').callsFake(function() {});
    }

    afterEach(function() {
        zlo = undefined;
        sandbox.restore();
    });

    describe('Если данные загрузились из кэша', function() {
        beforeEach(function() {
            initZlo();
            sandbox.stub(Zlo.prototype, '_loadFromLocalCache').resolves();
        });

        afterEach(function() {
            sandbox.restore();
        });

        it('_onLoadingFinished вызовется с аргументом "local"', function() {
            return zlo.loadDependencies().then(function() {
                expect(finishStub.calledWith('local')).to.be.true;
            });
        });
    });

    describe('Если невозможно загрузить данные из кэша', function(done) {
        var svnStub,
            loadFromExternalStorageStub;

        beforeEach(function() {
            sandbox.stub(Zlo.prototype, '_loadFromLocalCache').rejects('Error');
        });

        it('Пытаемся загрузить данные из svn если не передано disableSvn в опциях', function() {
            initZlo();
            svnStub = sandbox.stub(Zlo.prototype, '_loadFromSVNCache').resolves();

            return zlo.loadDependencies().then(function() {
                expect(svnStub.called).to.be.true;
            });
        });

        it('Сразу пытаемся загрузить данные из npm если передано disableSvn в опциях', function() {
            initZlo({ disableSvn: true });
            loadFromExternalStorageStub = sandbox.stub(Zlo.prototype, '_loadFromExternalStorage').resolves();

            svnStub = sandbox.stub(Zlo.prototype, '_loadFromSVNCache').resolves();

            return zlo.loadDependencies().then(function() {
                expect(svnStub.called).to.be.false;
                expect(loadFromExternalStorageStub.called).to.be.true;
            });
        });

        describe('Если данные из svn загрузились', function() {
            beforeEach(function() {
                initZlo();
                sandbox.stub(Zlo.prototype, '_loadFromSVNCache').resolves();
            });

            it('_onLoadingFinished вызовется с аргументом "svn"', function() {

                return zlo.loadDependencies().then(function() {
                    expect(finishStub.calledWith('svn')).to.be.true;
                });
            });
        });

        describe('Если данные из svn не загрузились', function() {
            beforeEach(function() {
                initZlo();
                sandbox.stub(Zlo.prototype, '_loadFromSVNCache').rejects('Error');
            });

            it('Пытаемся загрузить данные из npm', function() {
                var npmStub = sandbox.stub(Zlo.prototype, '_loadFromExternalStorage').resolves();

                return zlo.loadDependencies().then(function() {
                    expect(npmStub.called).to.be.true;
                });
            });

            describe('Если данные из npm загрузились', function() {
                beforeEach(function() {
                    sandbox.stub(Zlo.prototype, '_loadFromExternalStorage').resolves();
                });

                it('_onLoadingFinished вызовется с аргументом "npm"', function() {
                    return zlo.loadDependencies().then(function() {
                        expect(finishStub.calledWith('npm')).to.be.true;
                    });
                });
            });

            describe('Если данные из npm не загрузились', function() {
                var endFailStub;

                beforeEach(function() {
                    sandbox.stub(Zlo.prototype, '_loadFromExternalStorage').rejects();

                    endFailStub = sandbox.stub(Zlo.prototype, '_endFail').callsFake(function(data) {});
                });

                it('Показываем ошибку', function() {
                    return zlo.loadDependencies().then(function() {
                        expect(endFailStub.calledWith('Dependencies loading error')).to.be.true;
                    });
                })
            })
        });
    });
});



