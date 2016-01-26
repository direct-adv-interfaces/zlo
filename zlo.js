'use strict';

var CONFIG_NAME = 'zlo.json',
    NPM_CONFIG_NAME = 'package.json',
    BOWER_CONFIG_NAME = 'bower.json',

    NPM_STORAGE = 'node_modules',
    BOWER_STORAGE = 'libs',

    md5 = require('md5'),
    Promise = require('promise'),
    fs = require('fs-extra'),
    exec = require('child_process').exec,
    targz = require('tar.gz'),
    path = require('path'),
    SvnClient = require('svn-spawn'),
    Decompress = require('decompress');

module.exports = Zlo;

/**
 *
 * @param params
 * @param params.configJSON {JSON} config json
 * @param params.configPath {String} path to config json
 * @constructor
 */
function Zlo(params) {
    params = params || {};

    var cwd = process.cwd(),
        configJSON = params.configJSON ?
            params.configJSON :
            fs.readJsonSync(path.resolve(cwd, params.configName || CONFIG_NAME)),
        mdHash = md5(JSON.stringify(configJSON)),
        cacheFileName = mdHash + '.tar.gz';

    this._postinstall = [];

    if (!configJSON.storage || !configJSON.storage.local) {
        console.error('Empty local storage path');
        process.exit(0);
    } else {
        this.config = {
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

    this.createConfigs();
}

/**
 * Сreate bower config - .bowerrc
 */
Zlo.prototype.createBowerRC = function() {
    var cwd = process.cwd(),
        bowerrc = {
            directory: BOWER_STORAGE
        };

    fs.writeJson(path.resolve(cwd, '.bowerrc'), bowerrc);
};

/**
 * Создаем json-файлы для работы bower и npm
 */
Zlo.prototype.createConfigs = function() {
    var self = this,
        cwd = process.cwd(),
        config = this.config,
        bowerJSON = { dependencies: {}, name: 'zlo' },
        npmJSON = { dependencies: {} };

    config.json.dependencies.forEach(function(dep) {
        if (dep.type == 'git' || dep.type == 'svn') {
            bowerJSON.dependencies[dep.name] = dep.repo + '#' + dep.commit;
            if (dep.postinstall) {
                self._postinstall.push({ path: path.resolve(cwd, BOWER_STORAGE, dep.name), command: dep.postinstall });
            }
        } else {
            npmJSON.dependencies[dep.name] = dep.version;
            if (dep.postinstall) {
                self._postinstall.push({ path: path.resolve(cwd, NPM_STORAGE, dep.name), command: dep.postinstall });
            }
        }
    });

    bowerJSON.resolutions = config.json.resolutions;

    this.createBowerRC();

    fs.writeJson(path.resolve(cwd, NPM_CONFIG_NAME), npmJSON);
    fs.writeJson(path.resolve(cwd, BOWER_CONFIG_NAME), bowerJSON);
};

/**
 * Установка зависимостей через bower и npm
 * @returns {*}
 */
Zlo.prototype.loadFromNet = function () {
    var self = this;

    console.log('------LOAD FROM NET------ ');
    console.log('npm install');
    return new Promise(function(resolve, reject) {
        exec('npm install', function(err, stdout) {
            if (err) {
                console.error(err);
                reject();
                process.exit(0);
            }
            console.log('------NPM INSTALL FINISHED ------');

            var bowerPath = path.resolve(__dirname, 'node_modules/bower/bin/bower');
            console.log(bowerPath + ' install');
            exec(bowerPath + ' install', function(err, stdout) {
                if (err) {
                    console.error(err);
                    reject();
                    process.exit(0);
                }
                console.log('------BOWER INSTALL FINISHED------');
                self.archiveDependencies().then(function() {
                    resolve();
                });
            });
        });
    });
};

Zlo.prototype.killMD5 = function () {
    var config = this.config,
        client = this.svnClient;

    client.del([config.svn + '/' + config.cacheFileName, '-m', '"zlo: remove direct cache"'], function(err, data) {
        if (err) {
            console.log(err);
        } else {
            console.log(data);
            fs.removeSync(config.cacheDirectory);
        }
    });
};

Zlo.prototype._checkoutSVN = function(depth, callback) {
    var client = this.svnClient,
        config = this.config;

    client.checkout([config.svn, '.', '--depth', depth], function(err, data) {
        if (err) {
            console.error(err);
            callback(err, data);
        } else {
            callback(err, data);
        }
    });
};

Zlo.prototype.killAll = function () {
    var client = this.svnClient,
        config = this.config,
        local = this.config.json.storage.local;

    this._checkoutSVN(
        'immediates',
        function(err) {
            if (err) {
                process.exit(0);
            }
            process.chdir(local);
            //client.del не работает корректно с аргументом *
            exec('svn rm *', function(err, stout) {
                if (err) {
                    console.error(err);
                } else {
                    exec('svn commit -m "zlo: remove all direct cache"', function(err, stout) {
                        if (err) {
                            console.error(err);
                            process.exit(0);
                        }
                        console.log('local changes has been committed!');
                        fs.removeSync(config.cacheDirectory);
                    });
                }
            });
        }
    );
};

Zlo.prototype._getArchiveFolderPath = function() {
    return 'archive-' + this.config.mdHash;
};


/**
 * Архивирование зависимостей
 */
Zlo.prototype.archiveDependencies = function() {
    var config = this.config,
        tmpPath = this._getArchiveFolderPath(),
        self = this,
        promises = this.archiveFolderAction('move-to', tmpPath);

    return new Promise(function(resolve, reject) {
        Promise.all(promises).then(function() {
            console.log('--- archiveDependencies --- ');
            new targz().compress(
                tmpPath,
                config.cachePath,
                function onCompressed(compressErr) {
                    fs.removeSync(tmpPath);
                    if (compressErr) {
                        reject();
                        console.error('archiveDependencies: error - ' + compressErr);
                    } else {
                        console.log('archiveDependencies: success');
                        self.putToSvn().then(resolve);
                    }
                }
            );
        });
    });

};

Zlo.prototype.archiveFolderAction = function(action, tmpPath) {
    var promises = [],
        cwd = process.cwd();


    if (action == 'move-to') {
        //убеждаемся что искомая папка есть, если надо - чистим ее
        fs.emptydirSync(tmpPath);
    } else {
        //убеждаемся что искомая папка есть
        if (!fs.existsSync(tmpPath)) {
            console.error('folder ' + tmpPath + ' not found');
            process.exit(0);
        }
    }

    try {
        [NPM_STORAGE, BOWER_STORAGE].forEach(function(name) {
            promises.push(new Promise(function(resolve, reject) {
                var filePath = action == 'move-to' ? path.resolve(cwd, name) : path.resolve(tmpPath, name),
                    toPath =  action == 'move-to' ? path.resolve(tmpPath, name) : path.resolve(cwd, name);

                console.log(filePath + ' copy to ' + toPath);
                if (!fs.existsSync(filePath)) {
                    console.error(filePath + ' not found');
                    reject();
                    process.exit(0);
                } else {
                    fs.copy(filePath, toPath, function(err) {
                        if (err) {
                            console.error('File copy error', err);
                            reject();
                        } else {
                            console.log('copy ' + filePath + ' to ' + toPath + ' success');
                            resolve();
                        }
                    });
                }
            }));

        });
    } catch (e) {
        console.error('archiveFolderAction: file copy error ' + e);
    }

    return promises;
};

/**
 * Извлекаем зависимости из архива
 */
Zlo.prototype.extractDependencies = function() {
    var config = this.config,
        self = this;

    console.log('------EXTRACT DEPENDENCIES------' + config.cacheFileName + ' to ' + process.cwd());

    return new Promise(function(resolve, reject) {
        new Decompress()
            .src(config.cachePath)
            .dest(process.cwd())
            .use(Decompress.targz())
            .run(
                function onExtracted(extractErr) {
                    if (extractErr) {
                        console.error('extractDependencies: error ' + config.cachePath + ': ' + extractErr);
                        reject();
                    } else {
                        var tmpPath = self._getArchiveFolderPath(),
                            promises = self.archiveFolderAction('move-from', tmpPath);

                        Promise.all(promises).then(function() {
                            console.log('extractDependencies: done ' + config.cachePath);
                            fs.removeSync(tmpPath);
                            resolve();
                        });
                    }
                }
            );
    });

};

/**
 * Записываем свежесозданный архив в svn
 */
Zlo.prototype.putToSvn = function() {
    var client = this.svnClient;

    return new Promise(function(resolve, reject) {
        client.addLocal(function(err, data) {
            if (err) {
                console.error(err);
                reject();
                process.exit(0);
            }
            console.log('all local changes has been added for commit');

            client.commit('zlo: add direct cache', function(err, data) {
                if (err) {
                    console.error(err);
                    reject();
                    process.exit(0);
                }
                resolve();
                console.log('local changes has been committed!');
            });
        });
    });
};

Zlo.prototype.onLoadSuccess = function() {
    console.log('onLoadSuccess');
    var cwd = process.cwd();

    fs.removeSync(path.resolve(cwd, '.bowerrc'));
    fs.removeSync(path.resolve(cwd, NPM_CONFIG_NAME));
    fs.removeSync(path.resolve(cwd, BOWER_CONFIG_NAME));
    console.log(this._postinstall);
    if (this._postinstall && this._postinstall.length > 0) {
        Promise.all(this._postinstall.map(function(postinstall) {
            return new Promise(function(resolve, reject) {
                process.chdir(postinstall.path);
                console.log('posintall: ' + postinstall.command);
                exec(postinstall.command, function(err, stdout) {
                    if (err) {
                        console.log(err);
                        reject();
                    } else {
                        console.log(stdout);
                        resolve();
                    }
                });
            });
        })).then(function() {
            console.log('postinstall done');
        })
    }
};


/**
 * Заргрузка зависимостей всеми доступными способами
 */
Zlo.prototype.loadDependencies = function() {
    var self = this,
        config = this.config;

    //т.к. чекаутим только один файл (или вообще ни одного, если файла с данным md5 нет) то нет смысла отдельно проверять
    //существование локального кэша
    console.log('------CHECKOUT SVN------');

    this._checkoutSVN(
        'empty',
        function(err, data) {
            if (err) {
                if (err) {
                    console.error(err);
                }
                if (fs.existsSync(config.cachePath)) {
                    console.log('----EXTRACT FROM SVN CACHE----');
                    Promise.all(self.putToSvn(), self.extractDependencies()).then(self.onLoadSuccess);
                } else {
                    //идем за данными  в сеть
                    self.loadFromNet().then(self.onLoadSuccess);
                }
            } else {
                self.svnClient.update([config.cacheFileName], function(err, data) {
                    if (err) {
                        console.error(err);
                    }
                    if (fs.existsSync(config.cachePath)) {
                        console.log('------EXTRACT FROM SVN CACHE------');
                        self.extractDependencies().then(self.onLoadSuccess);
                    } else {
                        //идем за данными  в сеть
                        self.loadFromNet().then(self.onLoadSuccess);
                    }
                });
            }

        }
    );
};
