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
    path = require('path'),
    SvnClient = require('svn-spawn'),
    tar = require('tar-fs');

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
        cacheFileName = mdHash + '.tar';

    this._postinstall = [];

    if (!configJSON.storage || !configJSON.storage.local) {
        console.error('Empty local storage path');
        process.exit(0);
    } else {
        this.config = {
            json: configJSON,
            mdHash: mdHash,
            cacheDirectory: path.resolve(cwd, configJSON.storage.local),
            paths: [
                {
                    type: 'npm',
                    folderPath: NPM_STORAGE,
                    cachePath: path.resolve(configJSON.storage.local, NPM_STORAGE + '_' + cacheFileName),
                    cacheName: NPM_STORAGE + '_' + cacheFileName
                },
                {
                    type: 'bower',
                    folderPath: BOWER_STORAGE,
                    cachePath: path.resolve(configJSON.storage.local, BOWER_STORAGE + '_' + cacheFileName),
                    cacheName: BOWER_STORAGE + '_' + cacheFileName
                }
            ],
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

    console.log('archiveDependencies: start');

    var config = this.config,
        cwd = process.cwd(),
        paths = config.paths,
        self = this;

    return new Promise(function(resolve) {
        var promisesArray = paths.map(function(currentPath) {
            return new Promise(function(resolve) {
                tar.pack(path.resolve(cwd, currentPath.folderPath)).pipe(fs.createWriteStream(currentPath.cachePath))
                    .on('finish', function() {
                        console.log('archiveDependencies: finish ' + currentPath.folderPath);
                        resolve()
                    });
            })
        });

        Promise.all(promisesArray).then(function() {
            console.log('archiveDependencies: finish all');
            self.putToSvn().then(resolve);
        });
    });
};


/**
 * Извлекаем зависимости из архива
 */
Zlo.prototype.extractDependencies = function() {
    var config = this.config,
        paths = config.paths;

    console.log('extractDependencies - starts');

    return new Promise(function(resolve) {
        var promisesArray = paths.map(function(currentPath) {
            return new Promise(function(resolve) {
                fs.createReadStream(currentPath.cachePath).pipe(tar.extract(currentPath.folderPath))
                    .on('finish', function() {
                        console.log('extractDependencies: finish ' + currentPath.folderPath);
                        resolve();
                    })
            })
        });

        Promise.all(promisesArray).then(function() {
            console.log('extractDependencies: finish all');
            resolve();
        });
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

    fs.remove(path.resolve(cwd, '.bowerrc'), function(err) {
        if (err) console.error(err);
    });
    fs.remove(path.resolve(cwd, NPM_CONFIG_NAME), function(err) {
        if (err) console.error(err);
    });
    fs.remove(path.resolve(cwd, BOWER_CONFIG_NAME), function(err) {
        if (err) console.error(err);
    });

    console.log('this._postinstall', this._postinstall);

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
                if (fs.existsSync(config.paths[0].cachePath) && fs.existsSync(config.paths[1].cachePath)) {
                    console.log('----EXTRACT FROM SVN CACHE----');
                    Promise.all(self.putToSvn(), self.extractDependencies()).then(function() {
                        self.onLoadSuccess();
                    });
                } else {
                    //идем за данными  в сеть
                    self.loadFromNet().then(function() {
                        self.onLoadSuccess();
                    });
                }
            } else {
                self.svnClient.update([config.paths[0].cacheName, config.paths[1].cacheName], function(err, data) {
                    if (err) {
                        console.error(err);
                    }
                    if (fs.existsSync(config.paths[0].cachePath) && fs.existsSync(config.paths[1].cachePath)) {
                        console.log('------EXTRACT FROM SVN CACHE------');
                        self.extractDependencies().then(function() {
                            self.onLoadSuccess();
                        });
                    } else {
                        //идем за данными  в сеть
                        self.loadFromNet().then(function() {
                            self.onLoadSuccess();
                        });
                    }
                });
            }

        }
    );
};
