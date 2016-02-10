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
    var doCmdStub,
        putToSvnStub,
        copyArchStub;

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

        //стабим методы, успешное выполнение которых нам необходимо для продолжения тестирования
        doCmdStub = sandbox.stub(Zlo.prototype, '_doCmd', function(path, cmd, callback) {
            console.log(clc.blue('-- stub ---> doCmd: ' + cmd));

            return callback(null, {});
        });

        copyArchStub = sandbox.stub(Zlo.prototype, 'copyArchives', function(path, cmd, callback) {
            console.log(clc.blue('-- stub ---> copyArchives'));

            return Promise.resolve();
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
                console.log(clc.blue('-- stub --->loadFromLocalCache'));
                return Promise.resolve();
            });

        });

        afterEach(function() {
            console.log('restore');
            sandbox.restore();
        });

        it('Пытаемся положить зависимости в svn', function(done) {
            putToSvnStub = sandbox.stub(Zlo.prototype, 'putToSvn', function() {
                console.log(clc.blue('-- stub --->putToSvn'));
                return Promise.resolve();
            });

            zlo.loadDependencies().then(function() {
                try {
                    console.log(putToSvnStub);
                    expect(putToSvnStub.called).to.be.true;
                    done()
                } catch(e) {
                    done(e)
                }
            });
        });

        it('Проверяем наличие зависимостей в svn', function(done) {
            var checkCashesInSVNStub = sandbox.stub(Zlo.prototype, 'checkCashesInSVN', function(callback) {
                console.log(clc.blue('-- stub --->checkCashesInSVN'));
                callback(null, true);
            });

            zlo.loadDependencies().then(function() {
                try {
                    expect(checkCashesInSVNStub.called).to.be.true;
                    done()
                } catch(e) {
                    done(e)
                }

            });
        });

        it('Если зависимостей нет в svn - кладем', function(done) {

            //стабим  checkCashesInSVN чтобы копировало в архивную папку
            sandbox.stub(Zlo.prototype, 'checkCashesInSVN', function(callback) {
                console.log(clc.blue('-- stub --->checkCashesInSVN'));
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
                console.log(clc.blue('-- stub --->putToSvn'));
                return Promise.resolve();
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
            console.log(clc.blue('-- stub --->loadFromLocalCache'));

            return Promise.reject();
        });

        var loadFromSvnStub = sandbox.stub(Zlo.prototype, 'loadFromSVNCache', function() {
            //закругляемся - в этом кейсе проверять больше нечего
            return Promise.reject();
        });

        zlo.loadDependencies().then(function() {
            try {
                expect(loadFromSvnStub.called).to.be.true;
                done()
            } catch(e) {
                done(e)
            }
        });
    });


    describe('Успешная загрузка из svn', function() {
        beforeEach(function() {
            sandbox.stub(Zlo.prototype, 'loadFromLocalCache', function() {
                console.log(clc.blue('-- stub --->loadFromLocalCache'));

                return Promise.reject();
            });
            sandbox.stub(Zlo.prototype, 'loadFromSVNCache', function() {
                console.log(clc.blue('-- stub --->loadFromSVNCache'));

                return Promise.resolve();
            });

        });

        afterEach(function() {
           sandbox.restore();
        });

        it('Кладем зависимости в локальный кэш', function(done) {
            zlo.loadDependencies().then(function() {
                try {
                    expect(copyArchStub.called).to.be.true;
                    done()
                } catch(e) {
                    done(e)
                }
            });
        });

        it('Выполняем действия onLoadSuccess', function(done) {
            var onLoadSuccessSpy = sandbox.spy(Zlo.prototype, 'onLoadSuccess');


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
            console.log(clc.blue('-- stub --->loadFromLocalCache'));

            return Promise.reject();
        });

        sandbox.stub(Zlo.prototype, 'loadFromSVNCache', function() {
            console.log(clc.blue('-- stub --->loadFromSVNCache'));

            return Promise.reject();
        });

        var loadFromNetStub = sandbox.stub(Zlo.prototype, 'loadFromNet', function() {
            //закругляемся - в этом кейсе проверять больше нечего
            return Promise.reject();
        });

        zlo.loadDependencies().then(function() {
            try {
                expect(loadFromNetStub.called).to.be.true;

                done()
            } catch(e) {
                done(e)
            }
        });
    });

    describe('Успешная загрузка зависимостей из сети', function() {
        var archiveDependenciesStub;

        beforeEach(function() {
            sandbox.stub(Zlo.prototype, 'loadFromLocalCache', function() {
                console.log(clc.blue('-- stub --->loadFromLocalCache'));

                return Promise.reject();
            });
            sandbox.stub(Zlo.prototype, 'loadFromSVNCache', function() {
                console.log(clc.blue('-- stub --->loadFromSVNCache'));

                return Promise.reject();
            });

            sandbox.stub(Zlo.prototype, 'loadFromNet', function() {
                console.log(clc.blue('-- stub --->loadFromNet'));

                return Promise.resolve();
            });

            archiveDependenciesStub = sandbox.stub(Zlo.prototype, 'archiveDependencies', function() {
                return Promise.resolve();
            })

        });

        afterEach(function() {
            sandbox.restore();
        });

        it('Должна вызваться функция архивирования зависимостей', function(done) {
            zlo.loadDependencies().then(function() {
                try {
                    //функция сразу архивирует в локальных кэш, так что проверять отдельно формирование локального кэша не надо
                    expect(archiveDependenciesStub.called).to.be.true;

                    done()
                } catch(e) {
                    done(e)
                }
            });
        });

        it('Проверяем наличие зависимостей в svn', function(done) {
            var checkCashesInSVNStub = sandbox.stub(Zlo.prototype, 'checkCashesInSVN', function(callback) {
                console.log(clc.blue('-- stub --->checkCashesInSVN'));
                callback(null, true);
            });

            zlo.loadDependencies().then(function() {
                try {
                    expect(checkCashesInSVNStub.called).to.be.true;
                    done()
                } catch(e) {
                    done(e)
                }

            });
        });

        it('Если зависимостей нет в svn - кладем', function(done) {

            //стабим  checkCashesInSVN чтобы копировало в архивную папку
            sandbox.stub(Zlo.prototype, 'checkCashesInSVN', function(callback) {
                console.log(clc.blue('-- stub --->checkCashesInSVN'));
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
                console.log(clc.blue('-- stub --->putToSvn'));
                return Promise.resolve();
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

});
