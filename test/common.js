global.chai = require('chai');
global.sinon = require('sinon');
global.expect = global.chai.expect;

var Zlo = require('../zlo'),
    clc = require('cli-color'),
    fs = require('fs-extra'),
    path = require('path'),
    Promise = require('promise'),
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
        var writeSpy,
            cwd = process.cwd();

        beforeEach(function() {
            writeSpy = sandbox.spy(fs, 'writeJson');
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
        });

        afterEach(function() {
            zlo = undefined;
            sandbox.restore();
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

describe('Загрузка зависимостей', function() {
    var doCmdStub;

    beforeEach(function() {
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

        doCmdStub = sandbox.stub(Zlo.prototype, '_doCmd', function(path, cmd, callback) {
            console.log(clc.blue(cmd));
            callback(null, {});
        });
    });

    afterEach(function() {
        zlo = undefined;

        sandbox.restore();
    });

    describe('Успешная загрузка из локального кэша', function() {

        // loadDependencies -> loadFromLocalCache().putToSvn
        beforeEach(function() {
            sandbox.stub(Zlo.prototype, 'loadFromLocalCache', function() {
                return new Promise(function(resolve, reject) {
                    resolve();
                });
            });

        });

        afterEach(function() {
            console.log('restore');
            sandbox.restore();
        });

        it('Пытаемся положить зависимости в svn', function(done) {
            var putToSvnSpy = sandbox.spy(Zlo.prototype, 'putToSvn');

            zlo.loadDependencies().then(function() {
                try {
                    expect(putToSvnSpy.called).to.be.true;
                    done()
                } catch(e) {
                    done(e)
                }

            });
        });

        it('Проверяем наличие зависимостей в svn', function(done) {
            var checkCashesInSVNSpy = sandbox.spy(Zlo.prototype, 'checkCashesInSVN');

            zlo.loadDependencies().then(function() {
                try {
                    //doCmd вызывалось строго один раз
                    expect(doCmdStub.callCount).to.be.equal(1);
                    //и этот один раз был для проверки наличия файла
                    expect(doCmdStub.firstCall.args[1]).to.have.string('svn ls');
                    expect(checkCashesInSVNSpy.called).to.be.true;
                    done()
                } catch(e) {
                    done(e)
                }

            });
        });

        it('Если зависимостей нет в svn - кладем', function(done) {
            sandbox.stub(Zlo.prototype, 'copyArchives', function() {
                return new Promise(function(resolve) {
                    resolve();
                })
            });

            //стабим  checkCashesInSVN чтобы копировало в архивную папку
            sandbox.stub(Zlo.prototype, 'checkCashesInSVN', function(callback) {
                callback(null, false);
            });


            zlo.loadDependencies().then(function() {
                try {
                    //счекаутили директорию
                    expect(doCmdStub.firstCall.args[1]).to.have.string('svn checkout');
                    //добавили
                    expect(doCmdStub.secondCall.args[1]).to.have.string('svn add');
                    //закоммитили
                    expect(doCmdStub.thirdCall.args[1]).to.have.string('svn commit');

                    done()
                } catch(e) {
                    done(e)
                }
            });
        });

        it('Если успешно положили в svn - выполняем onLoadSuccess', function(done) {
            var successSpy = sandbox.spy(Zlo.prototype, 'onLoadSuccess');

            sandbox.stub(Zlo.prototype, 'putToSvn', function() {
                return new Promise(function(resolve) {
                    resolve();
                })
            });

            zlo.loadDependencies().then(function() {
                try {
                    expect(successSpy.called).to.be.true;

                    done()
                } catch(e) {
                    done(e)
                }
            });
        });
    });

    it('Не удалось загрузить зависимости из локального кэша - грузим из svn', function(done) {
        sandbox.stub(Zlo.prototype, 'loadFromLocalCache', function() {
            return new Promise(function(resolve, reject) {
                reject();
            });
        });

        var loadFromSvnSpy = sandbox.spy(Zlo.prototype, 'loadFromSVNCache');

        zlo.loadDependencies().then(function() {
            try {
                expect(loadFromSvnSpy.called).to.be.true;

                done()
            } catch(e) {
                done(e)
            }
        });
    });


    describe('Успешная загрузка из svn', function() {
        beforeEach(function() {
            sandbox.stub(Zlo.prototype, 'loadFromLocalCache', function() {
                return new Promise(function(resolve, reject) {
                    reject();
                });
            });
            sandbox.stub(Zlo.prototype, 'loadFromSVNCache', function() {
                return new Promise(function(resolve, reject) {
                    resolve();
                });
            });

        });

        afterEach(function() {
           sandbox.restore();
        });

        it('Кладем зависимости в локальный кэш', function(done) {
            var copyArchivesSpy = sandbox.spy(Zlo.prototype, 'copyArchives');

            zlo.loadDependencies().then(function() {
                try {
                    expect(copyArchivesSpy.called).to.be.true;

                    done()
                } catch(e) {
                    done(e)
                }
            });
        });

        it('Выполняем действия onLoadSuccess', function(done) {
            var onLoadSuccessSpy = sandbox.spy(Zlo.prototype, 'onLoadSuccess');

            sandbox.stub(Zlo.prototype, 'copyArchives', function() {
                return new Promise(function(resolve, reject) {
                    resolve();
                });
            });

            zlo.loadDependencies().then(function() {
                try {
                    expect(onLoadSuccessSpy.called).to.be.true;

                    done()
                } catch(e) {
                    done(e)
                }
            });
        });
    });

    it('Не удалось загрузить зависимости из svn - грузим из сети', function(done) {
        sandbox.stub(Zlo.prototype, 'loadFromLocalCache', function() {
            return new Promise(function(resolve, reject) {
                reject();
            });
        });

        sandbox.stub(Zlo.prototype, 'loadFromSVNCache', function() {
            return new Promise(function(resolve, reject) {
                reject();
            });
        });

        var loadFromNetSpy = sandbox.spy(Zlo.prototype, 'loadFromNet');

        zlo.loadDependencies().then(function() {
            try {
                expect(loadFromNetSpy.called).to.be.true;

                done()
            } catch(e) {
                done(e)
            }
        });
    });

    describe('Успешная загрузка зависимостей из сети', function(done) {
        it('Должна вызваться функция архивирования зависимостей', function() {});
        it('Кладем зависимости в локальный кэш', function(done) {});
        it('Проверяем наличие зависимостей в svn', function(done) {});
        it('Если зависимостей нет в svn - кладем', function(done) {});
        it('Выполняем действия onLoadSuccess', function(done) {});
    });

});
