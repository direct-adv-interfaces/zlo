'use strict';

var CONFIG_NAME = 'zlo.json',
    NPM_CONFIG_NAME = 'package.json',
    BOWER_CONFIG_NAME = 'bower.json',

    NPM_STORAGE = 'node_modules',
    BOWER_STORAGE = 'libs',

    md5 = require('md5'),
    fs = require('fs-extra'),
    exec = require('child_process').exec,
    targz = require('tar.gz'),
    path = require('path'),
    SvnClient = require('svn-spawn'),
    Decompress = require('decompress');

module.exports = Zlo;

function Zlo() {
    var cwd = process.cwd(),
        configPath = path.resolve(cwd, CONFIG_NAME),
        configJSON = fs.readJsonSync(configPath),
        mdHash = md5(JSON.stringify(configJSON)),
        cacheFileName = mdHash + '.tar.gz';

    if (!configJSON.storage || !configJSON.storage.local) {
        console.error('Empty local storage path');
        process.exit(0);
    }

    this.config = {
        path: configPath,
        json: configJSON,
        mdHash: mdHash,
        cacheDirectory: path.resolve(cwd, configJSON.storage.local),
        cacheFileName: cacheFileName,
        cachePath: path.resolve(configJSON.storage.local, cacheFileName),
        svn: configJSON.storage.svn
    };

    this.svnClient = new SvnClient({
        cwd: configJSON.storage.local
    });
}

/**
 * Создаем json-файлы для работы bower и npm
 */
Zlo.prototype.createLoadingConfigs = function() {
    var cwd = process.cwd(),
        config = this.config,
        bowerJSON = { dependencies: {}, name: 'zlo' },
        npmJSON = { dependencies: {} };

    config.json.dependencies.forEach(function(dep) {
        if (dep.type == 'git' || dep.type == 'svn') {
            bowerJSON.dependencies[dep.name] = dep.repo + '#' + dep.commit
        } else {
            npmJSON.dependencies[dep.name] = dep.version;
        }
    });

    bowerJSON.resolutions = config.json.resolutions;

    fs.writeJson(path.resolve(cwd, NPM_CONFIG_NAME), npmJSON);
    fs.writeJson(path.resolve(cwd, BOWER_CONFIG_NAME), bowerJSON);
};

/**
 * Установка зависимостей через bower и npm
 * @returns {*}
 */
Zlo.prototype.loadFromNet = function () {
    var self = this;

    this.createLoadingConfigs();

    console.log('------LOAD FROM NET--- ');
    exec('npm install', function() {
        console.log('--- NPM INSTALL FINISHED ----- ');
        exec('bower install', function() {
            console.log('--- BOWER INSTALL FINISHED ----- ');
            self.archiveDependencies()
        })
    });
};

Zlo.prototype.killMD5 = function () {
    var config = this.config,
        client = this.svnClient;

    console.log('Clear  ' + config.cacheFileName + ' cache from svn');
    fs.removeSync(config.cacheDirectory);

    client.checkout([config.svn, '.', '--depth', 'empty'], function(err, data) {
        if (err) {
            console.error(err);
            process.exit(0);
        } else {
            client.update([config.cacheFileName], function(err, data) {
                if (err) {
                    console.error(err);
                    process.exit(0);
                }
                if (fs.existsSync(config.cachePath)) {
                    client.cmd(['rm', config.cacheFileName], function(err, data) {
                        if (err) {
                            console.error(err);
                            process.exit(0);
                        }
                        client.commit('zlo: remove direct cache', function(err, data) {
                            if (err) {
                                console.error(err);
                                process.exit(0);
                            }
                            fs.removeSync(config.cacheDirectory);
                        });
                    });
                } else {
                    console.log('nothing to remove')
                }
            });
        }
    });
};

Zlo.prototype.killAll = function () {
    var client = this.svnClient;

    fs.removeSync(config.cacheDirectory);

    client.checkout([config.svn, '.'], function(err, data) {
        if (err) {
            console.error(err);
            process.exit(0);
        } else {
            client.cmd(['rm', '*'], function(err, data) {
                if (err) {
                    console.error(err);
                    process.exit(0);
                }
                client.commit('zlo: remove all direct cache', function(err, data) {
                    if (err) {
                        console.error(err);
                        process.exit(0);
                    }
                    console.log('local changes has been committed!');
                    fs.removeSync(config.cacheDirectory);
                });
            });
        }
    });
};

/**
 * Архивирование зависимостей
 */
Zlo.prototype.archiveDependencies = function() {
    var cwd = process.cwd(),
        config = this.config,
        tmpPath = 'tmp-' + config.mdHash,
        self = this;

    fs.mkdirsSync(tmpPath);
    console.log('--- create folder for archive --- ');
    try {
        [NPM_STORAGE, BOWER_STORAGE].forEach(function(name) {
            var filePath = path.resolve(cwd, name),
                toPath = path.resolve(tmpPath, name);
            console.log(filePath + ' copy to ' + toPath);
            if (!fs.existsSync(filePath)) {
                console.error(filePath + ' not found');
                process.exit(0);
            } else {
                fs.copySync(filePath, toPath);
            }
        });
    } catch (e) {
        console.error('archiveDependencies: file copy error ' + e);
    }
    console.log('--- archiveDependencies --- ');
    new targz().compress(
        tmpPath,
        config.cachePath,
        function onCompressed(compressErr) {
            fs.removeSync(tmpPath);

            if (compressErr) {
                console.error('archiveDependencies: error - ' + compressErr);
            } else {
                console.log('archiveDependencies: success');
                self.putToSvn();
            }
        }
    );
};

Zlo.prototype.extractDependencies = function() {
    var config = this.config;

    console.log('---EXTRACT DEPENDENCIES-- ' + config.cacheFileName);

    new Decompress()
        .src(config.cachePath)
        .dest(process.cwd())
        .use(Decompress.targz())
        .run(
            function onExtracted(extractErr) {
                if (extractErr) {
                    console.error('extractDependencies: error ' + config.cachePath + ': ' + extractErr);
                } else {
                    console.log('extractDependencies: done ' + config.cachePath);
                }
            }
        );
};

/**
 * Записываем свежесозданный архив в svn
 */
Zlo.prototype.putToSvn = function() {
    var client = this.svnClient;

    client.addLocal(function(err, data) {
        if (err) {
            console.error(err);
            process.exit(0);
        }
        console.log('all local changes has been added for commit');

        client.commit('zlo: add direct cache', function(err, data) {
            if (err) {
                console.error(err);
                process.exit(0);
            }

            console.log('local changes has been committed!');
        });
    });
};

/**
 * Заргрузка зависимостей всеми доступными способами
 */
Zlo.prototype.loadDependencies = function() {
    var self = this,
        config = this.config;

    //т.к. чекаутим только один файл (или вообще ни одного, если файла с данным md5 нет) то нет смысла отдельно проверять
    //существование локального кэша
    console.log('--------CHECKOUT SVN ----- ');
    this.svnClient.checkout([config.svn, '.', '--depth', 'empty'], function(err, data) {
        if (err) {
            console.error(err);
            process.exit(0);
        } else {
            self.svnClient.update([config.cacheFileName], function(err, data) {
                if (err) {
                    console.error(err);
                    process.exit(0);
                }
                if (fs.existsSync(config.cachePath)) {
                    console.log('----EXTRACT FROM SVN CACHE----');
                    self.extractDependencies();
                } else {
                    //идем за данными  в сеть
                    self.loadFromNet();
                }
            });
        }
    });
};
