'use strict';

var CONFIG_NAME = 'zlo.json',
    NPM_CONFIG_NAME = 'package.json',
    BOWER_CONFIG_NAME = 'bower.json',

    NPM_STORAGE = 'node_modules',
    BOWER_STORAGE = 'libs',
    TMP_DIRS = {
        killmd5: '_tmp-kill-md5-dir_',
        killAll: '_tmp-kill-all-dir_',
        svn: '_tmp_svn_'
    },

    md5 = require('md5'),
    json = require('format-json'),
    Promise = require('promise'),
    fs = require('fs-extra'),
    exec = require('child_process').exec,
    path = require('path'),
    clc = require('cli-color'),
    _ = require('lodash'),
    tar = require('tar-fs');

module.exports = Zlo;

function errorLog(code, debugMsg) {
    console.error(clc.red('ERROR: ' + code));
    debugMsg && console.error(debugMsg);
}

/**
 *
 * @param params
 * @param params.configJSON {JSON} config json
 * @param params.configPath {String} path to config json
 * @constructor
 */
function Zlo(configJSON) {
    configJSON = configJSON || {};

    var cwd = process.cwd(),
        mdHash = md5(JSON.stringify(configJSON)),
        cacheFileName = mdHash + '.tar';

    this._postinstall = [];

    if (!configJSON.storage || (!configJSON.storage.local || !configJSON.storage.svn)) {
        errorLog('Empty local storage path');
        process.exit(0);

        return;
    }

    if (!configJSON.dependencies || !configJSON.dependencies.length) {
        errorLog('Empty dependencies');

        process.exit(0);

        return;
    }

    this._localStoragePath = path.resolve(cwd, configJSON.storage.local);

    if (!fs.existsSync(this._localStoragePath)) {
        console.log('create directory: ' + this._localStoragePath);
        fs.mkdirsSync(this._localStoragePath);
    }

    var svnDirPath = path.resolve(cwd, TMP_DIRS.svn);

    if (!fs.existsSync(svnDirPath)) {
        console.log('create directory: ' + svnDirPath);
        fs.mkdirsSync(svnDirPath);
    }

    this._svnData = {
        url: configJSON.storage.svn,
        path: svnDirPath
    };

    this._cacheFileNames = [
        NPM_STORAGE + '_' + cacheFileName,
        BOWER_STORAGE + '_' + cacheFileName
    ];

    this._dependenciesFolders = [
        NPM_STORAGE,
        BOWER_STORAGE
    ];


    this.config = {
        json: configJSON,
        mdHash: mdHash
    };

    this.createConfigs();
}

/**
 * Возвращает имя файла, в который запишется кэш
 * 0 -  node_modules_nnnnn.tar
 * 1 -  libs_nnnnn.tar
 * @param {Number} index
 * @returns {*}
 * @private
 */
Zlo.prototype._getCacheFileName = function(index) {
    return this._cacheFileNames[index];
};

/**
 * Выполняет запрос в svn
 * @param {String} path путь по которому лежит папка с svn-репозиторием
 * @param {String} svncmd команда, например 'svn ls' или 'svn up'
 * @return {Promise}
 * @private
 */
Zlo.prototype._doCmd = function (path, svncmd) {
    console.log(clc.yellow.italic(svncmd));
    var cwd = process.cwd();

    process.chdir(path);

    return new Promise(function(resolve, reject) {
        exec(svncmd, function (err, stdout) {
            process.chdir(cwd);

            if (err) {
                errorLog(clc.red(svncmd + ' error: '), err);
                reject(err);
            } else {
                console.log(clc.green(svncmd + ' success: ') + stdout);
                resolve(stdout);
            }
        });
    });
};


/**
 * Проверяем есть ли имена файлов из _cacheFileNames в потоке вывода stdout
 * @param {String} stdout
 * @returns {Boolean}
 * @private
 */
Zlo.prototype._isFilesNamesInStdout = function(stdout) {
    return _.every(this._cacheFileNames, function (name) {
        var regexp = new RegExp('(^|\\s)(' + name + ')($|\\s)'),
            res = stdout.match(regexp);

        if (res && res[0]) {
            console.log(clc.yellow('Found: '+ res && res[0]));

            return true;
        }
    });
};

/**
 * Проверяет есть ли имена из списка файлов в директории
 * @param {String} dirPath
 * @returns {Boolean}
 * @private
 */
Zlo.prototype._isFilesExistsInDir = function(dirPath) {

    return _.every(this._cacheFileNames, function (name) {
        var filePath = path.resolve(dirPath, name);

        console.log(filePath + ' exists: ' + fs.existsSync(filePath));

        return fs.existsSync(filePath);
    });
};


/**
 * Проверяем есть ли нужные кэши в svn
 * @return {Promise}
 */
Zlo.prototype._checkCashesInSVN = function() {
    var svncmd = 'svn ls '+ this._svnData.url;

    return this._doCmd(this._svnData.path, svncmd)
        .then(function(data) {
            if (this._isFilesNamesInStdout(data)) {
                console.log(clc.green('Files ' + this._cacheFileNames + ' found in svn'));

                return true;
            }

            console.log(clc.yellow('Files ' + this._cacheFileNames + ' not found in svn'));

            return false;
        }.bind(this))
        .catch(function(e) { return Promise.reject(e); });
};


/**
 * Создаем json-файлы для работы bower и npm
 */
Zlo.prototype.createConfigs = function() {
    var cwd = process.cwd(),
        config = this.config,
        bowerJSON = { dependencies: {}, name: 'zlo' },
        npmJSON = { dependencies: {} };

    config.json.dependencies.forEach(function(dep) {
        if (dep.type == 'git' || dep.type == 'svn') {
            bowerJSON.dependencies[dep.name] = dep.repo + '#' + dep.commit;
        } else {
            npmJSON.dependencies[dep.name] = dep.version;
        }

        if (dep.postinstall) {
            this._postinstall.push({ path: path.resolve(cwd, dep.type == 'git' || dep.type == 'svn' ? BOWER_STORAGE : NPM_STORAGE, dep.name), command: dep.postinstall });
        }
    }, this);

    bowerJSON.resolutions = config.json.resolutions && config.json.resolutions || [];

    this._configsData = [
        {
            path: path.resolve(cwd, '.bowerrc'),
            data: { directory: BOWER_STORAGE }
        },
        {
            path: path.resolve(cwd, NPM_CONFIG_NAME),
            data: npmJSON
        },
        {
            path: path.resolve(cwd, BOWER_CONFIG_NAME),
            data: bowerJSON
        }
    ];

    this._configsData.forEach(function (config) {
        console.log('create confing ' + config.path, json.plain(config.data));
        fs.writeJson(config.path, config.data)
    });
};

/**
 * Установка зависимостей через bower и npm
 * @returns {*}
 */
Zlo.prototype._loadFromNet = function () {
    console.log(clc.green.bold('Load dependencies via bower and npm'));
    console.log('npm install');

    return new Promise(function(resolve, reject) {
        exec('npm install', function(err, stdout) {
            if (err) {
                errorLog('npm install', err);
                reject();

                return;
            }
            console.log(stdout);
            console.log(clc.green('npm install finished'));
            var bowerPath = __dirname.split('/');

            bowerPath = path.resolve(bowerPath.slice(0, bowerPath.length - 1).join('/'), 'node_modules/bower/bin/bower');

            console.log(bowerPath + ' install');
            exec(bowerPath + ' install', function(err, stdout) {
                if (err) {
                    errorLog(bowerPath + ' install', err);
                    reject();

                    return;
                }
                console.log(stdout);
                console.log(clc.green(bowerPath + ' install finished'));

                resolve();
            });
        });
    });
};

/**
 * Удаляем кэши по md-сумме данного кофига
 */
Zlo.prototype.killMD5 = function (options) {
    var svn = this._svnData;

    options = options || {};

    fs.mkdirsSync(TMP_DIRS.killmd5);

    this._checkCashesInSVN()
        .then(function(isFilesExists) {
            if (!isFilesExists) {
                return false;
            }

            var cmd = 'svn rm ' + this._cacheFileNames.map(function (name) { return svn.url + '/' + name; }).join(' ') +
                ' -m "zlo: remove caches"';

            return this._doCmd(TMP_DIRS.killmd5, cmd);
        }.bind(this))
        .then(function(isFilesRemoved) {
            if (isFilesRemoved) {
                console.log(clc.green('Files ' + this._cacheFileNames + ' removed from svn'))
            } else {
                console.log(clc.green('Nothing to remove'));
            }
            //удаляем временные файлы
            this._doCleanup();
        }.bind(this))
        .catch(function(err) {
            //удаляем временные файлы
            this._doCleanup();
        }.bind(this));

    if (!options.svnOnly) {
        this._removeCacheFiles();
    }
};

/**
 * Удаляет из локального кэша все файлы
 * @private
 */
Zlo.prototype._removeAllCacheFiles = function() {
    console.log(clc.green.bold('Clear local cache ' + path));

    fs.readdir(this._localStoragePath, function(err, files) {

        if (err) {
            errorLog('Can not clear local cache', err);
        } else {
            files.length && files.forEach(function(file) {
                fs.remove(path.resolve(this._localStoragePath, file), function(err) {
                    if (err) {
                        console.log(err);

                        return;
                    }

                    console.log(clc.green('file ' + file + ' removed'));
                });
            }, this);
        }
    }.bind(this));
};

/**
 * Удаляет из локального кэша файлы с конкретной md-суммой
 * @private
 */
Zlo.prototype._removeCacheFiles = function() {
    console.log(clc.green.bold('Clear local cache ' + this._localStoragePath));

    this._cacheFileNames.forEach(function (name) {
        var filePath = path.resolve(this._localStoragePath, name);

        fs.removeSync(filePath);
        console.log(clc.green('remove ' + filePath));
    }, this);
};

/**
 * Чистим все возможные кэши
 */
Zlo.prototype.killAll = function (options) {
    var svn = this._svnData,
        currentDir = TMP_DIRS.killAll;

    options = options || {};

    if (!fs.existsSync(currentDir)) {
        console.log('create directory: ' + currentDir);
        fs.mkdirsSync(currentDir);
    }

    this._doCmd(currentDir, 'svn checkout --depth immediates ' + svn.url + ' .')
        .then(function(stout) {
            console.log(stout);

            return this._doCmd(currentDir, 'svn ls');
        }.bind(this))
        .then(function(stout) {
            if (!stout) {
                console.log(clc.green.bold('SVN cache is already empty'));

                this._doCleanup();

                return false;
            }

            console.log(stout);

            return this._doCmd(currentDir, 'svn rm *')
                .then(function(stout) {
                    console.log(stout);

                    return this._doCmd(currentDir, 'svn commit -m "zlo: remove all direct cache"')
                        .then(function(stout) {
                            console.log(stout);

                            //независимо от исхода - чистим временные файлы
                            this._doCleanup();

                            console.log('local changes has been committed!');
                            console.log(clc.green.bold('SVN cache is  empty'));
                        }.bind(this))
                }.bind(this))
        }.bind(this))
        .catch(function(err) {
            errorLog('do cmd', err);

            this._doCleanup();
        }.bind(this));

    if (!options.svnOnly) {
        this._removeAllCacheFiles();
    }
};


/**
 * Чекаут svn репозитории
 * @param {String} depth Параметр --deps с которым будет выполнен svn checkout
 * @param {Array} files список файлов, которые нужно забрать из репозитория
 * @retutn {Promise}
 * @private
 */
Zlo.prototype._checkoutSVN = function(depth, files) {
    files = files || [];

    return this._doCmd(this._svnData.path, 'svn checkout ' + this._svnData.url + ' . --depth ' + depth)
        .then(function() {
            return files.length && this._doCmd(this._svnData.path, 'svn up ' + files.join(' '));
        }.bind(this))
        .then(function(stdout) {
            if (!files.length) return true;

            if (stdout) {
                console.log(clc.green('Files successfully retrives'));
            } else {
                errorLog('Can not retrive files from SVN');
            }

            return true;
        })
        .catch(function(err) {
            return Promise.reject(err);
        });
};


/**
 * Архивирование зависимостей
 */
Zlo.prototype._archiveDependencies = function() {
    console.log(clc.green('archiveDependencies: start'));

    var cwd = process.cwd();

    return new Promise(function(resolve) {
        var promisesArray = this._dependenciesFolders.map(function(folderName, index) {
            var folderAbsPath = path.resolve(cwd, folderName),
                archiveAbsPath = path.resolve(this._localStoragePath || this._svnData.path, this._getCacheFileName(index));

            console.log('Try archive ' + folderAbsPath + ' -> ' + archiveAbsPath);

            return new Promise(function(resolve, reject) {
                tar.pack(folderAbsPath).pipe(fs.createWriteStream(archiveAbsPath))
                    .on('finish', function() {
                        console.log(clc.green('archiveDependencies: finish ' + archiveAbsPath));
                        resolve()
                    })
                    .on('error', function (err) {
                        errorLog('Can not archive folder ' + archiveAbsPath, err);
                        reject();
                    })
            });
        }, this);

        Promise.all(promisesArray).then(
            function() {
                console.log(clc.green.bold('archiveDependencies: finish all'));
                resolve();
            },
            function (err) {
                errorLog('Can not archive folders', err);
                reject();
            }
        );
    }.bind(this));
};


/**
 * Извлекаем зависимости из архива
 * @param {String} storagePath путь из которого извлекаем - это может быть локальный кэш или временная папка с SVN
 * @returns {*}
 */
Zlo.prototype._extractDependencies = function(storagePath) {
    var cwd = process.cwd();

    console.log(clc.green.bold('_extractDependencies - starts, path = ' + storagePath));

    var promisesArray = this._dependenciesFolders.map(function (name, index) {
        return new Promise(function(resolve, reject) {
            var cacheFilePath = path.resolve(storagePath, this._getCacheFileName(index)),
                destFolderPath = path.resolve(cwd, name);

            console.log('Extract ' + cacheFilePath + ' -> ' + destFolderPath);

            fs.createReadStream(cacheFilePath).pipe(tar.extract(destFolderPath))
                .on('finish', function() {
                    console.log(clc.green('extract dependencies: finish ' + destFolderPath));
                    resolve();
                })
                .on('error', function (err) {
                    errorLog('error extract dependencies ' + destFolderPath, err);
                    reject(err)
                })
        }.bind(this))
    }, this);

    return Promise.all(promisesArray)
        .then(function() {
            console.log(clc.green.bold('extract dependencies: finish all'));

            return true;
        })
        .catch(function(err) {
            errorLog('error extract dependencies', err);

            return Promise.reject(err);
        });

};

/**
 * Копирование объекта из одной директории в другую
 * @param fromPath
 * @param toPath
 */
Zlo.prototype._copyArchives = function (fromPath, toPath) {

    return Promise.all(this._cacheFileNames.map(function (cacheName) {
        var startParh = path.resolve(fromPath, cacheName),
            endParh = path.resolve(toPath, cacheName);

        console.log('copy ' + startParh + ' --> ' + endParh);

        return new Promise(function(resolve, reject) {
            fs.copy(startParh, endParh, function (err) {
                if (err) {
                    errorLog('error copy ' + startParh + ' --> ' + endParh, err);
                    reject();
                } else {
                    console.log(clc.green('success copy ' + startParh + ' --> ' + endParh));
                    resolve();
                }

            })
        });
    }))
};

/**
 * Записываем свежесозданный архив в svn
 */
Zlo.prototype._putToSvn = function() {
    console.log(clc.green('Put to svn'));

    if (!this._svnData) {
        console.log(clc.yellow('SVN url not defined'));

        return Promise.reject('SVN url not defined');
    }

    //проверяем есть ли уже файлы в репозитории

    return this._checkCashesInSVN()
        .then(function(isFilesExists) {
            if (isFilesExists) {
                console.log(clc.green('Files already in SVN'));

                return true;
            }

            return this._checkoutSVN('empty', [])
                .then(function(stdout) {
                    return this._copyArchives(this._localStoragePath, this._svnData.path);
                }.bind(this))
                .then(function(stdout) {
                    console.log(clc.green('Archives successfully copy to ' + this._svnData.path));

                    return this._doCmd(this._svnData.path, 'svn add ' + this._cacheFileNames.join(' '));
                }.bind(this))
                .then(function(stdout) {
                    return this._doCmd(this._svnData.path, 'svn commit -m "zlo: add direct cache"');
                }.bind(this))
                .then(function(stdout) {
                    console.log(clc.green('local changes has been committed!'));

                    return true;
                });
        }.bind(this))
        .catch(function(err) {
            errorLog('_checkCashesInSVN', err);

            Promise.reject(err);
        });
};

/**
 * Удаляем ненужные конфиги и временные файлы
 */
Zlo.prototype._doCleanup = function() {
    var cwd = process.cwd();

    console.log(clc.green('Remove tmp files and folders'));

    _.forEach(TMP_DIRS, function(name) {
        var absPath = path.resolve(cwd, name);

        fs.existsSync(absPath) && fs.remove(absPath, function(err) {
            if (err) {
                errorLog('Remove ' + name, err);

                return;
            }

            console.log(clc.green('Directory ' + name + ' removed'));
        });
    });

    ['.bowerrc', NPM_CONFIG_NAME, BOWER_CONFIG_NAME].forEach(function(name) {
        fs.remove(path.resolve(cwd, name), function(err) {
            if (err) {
                errorLog('Remove ' + name, err);

                return;
            }

            console.log(clc.green('File ' + name + ' removed'));
        });
    }, this);
};

/**
 * Действия, выполняемые после успешной загрузки зависимостей
 */
Zlo.prototype._onLoadSuccess = function() {
    if (this._postinstall && this._postinstall.length > 0) {
        console.log(clc.green('Doing postinstall'));
        Promise.all(this._postinstall.map(function(postinstall) {
            return new Promise(function(resolve, reject) {
                console.log('posintall: ' + postinstall.command);
                exec(postinstall.command, function(err, stdout) {
                    if (err) {
                        errorLog('postinstall', err);

                        reject();
                    } else {
                        console.log(stdout);
                        resolve();
                    }
                }.bind(this));
            }.bind(this));
        }, this)).then(
            function() {
                console.log(clc.green('postinstall done'));
                this._doCleanup();
            }.bind(this)
        ).catch(function() {

            this._doCleanup();
        }.bind(this))
    } else {
        this._doCleanup();
    }
};

Zlo.prototype._tryPutToSvn = function() {

    return this._putToSvn()
        .then(function (stdout) {
            console.log(clc.green.bold('Dependencies committed to SVN cache'));

            this._onLoadSuccess();
        }.bind(this))
        .catch(function(err) {
            errorLog('dependencies not committed to SVN cache', err);

            //не смогли положить в svn - но почистить за собой нужно
            this._onLoadSuccess();
        }.bind(this));
};

/**
 * Установка зависимостей согласно конфигу zlo.json
 */
Zlo.prototype.loadDependencies = function() {

    return this._loadFromLocalCache()
        .then(function() {
            return this._tryPutToSvn();
        }.bind(this))
        .catch(function(err) {
            errorLog('Load from local cache error', err);

            return this._loadFromSVNCache()
                .then(function(stdout) {
                    console.log(clc.blue('Load from local svn success: ') + stdout);
                    //если данные загрузились из svn - копируем их в локальный кэш
                    return this._copyArchives(this._svnData.path, this._localStoragePath)
                        .then(function () {
                            this._onLoadSuccess();
                        }.bind(this))
                        .catch(function(err) {
                            errorLog('Copy archives', err);

                            return Promise.reject(err);
                        })
                }.bind(this))
                .catch(function(err) {
                    errorLog('Load from local svn', err);

                    return this._loadFromNet()
                        .then(function() {
                            return this._archiveDependencies();
                        }.bind(this))
                        .then(function() {
                            return this._tryPutToSvn();
                        }.bind(this))
                        .catch(function(err) {
                            errorLog('Can not load dependencies!!!', err);
                            this._doCleanup();

                            return Promise.reject(err);
                        }.bind(this));
                }.bind(this))
        }.bind(this));

};

/**
 * Пытаемся загрузить зависимости из локального кэша
 * @returns {Promise}
 */

Zlo.prototype._loadFromLocalCache = function() {
    console.log(clc.green.bold('Load from local cache'));

    if (!this._localStoragePath) {
        return Promise.reject('Can not load from local cache. Cache path not defined');
    }

    if (this._isFilesExistsInDir(this._localStoragePath)) {
        console.log(clc.green('Files ' + this._cacheFileNames + ' found in local storage'));

        return this._extractDependencies(this._localStoragePath)
            .then(function() {
                console.log(clc.green.bold('Dependencies succesfully retrive from local strorafe'));

                return Promise.resolve();
            })
            .catch(function(err) {
                console.log(err);

                return Promise.reject('Can not load files from local storage');
            });
    } else {
        return Promise.reject('Files ' + this._cacheFileNames + ' not exists in local storage');
    }

};

/**
 * Пытаемся загрузить зависимости из svn
 * @returns {Promise}
 */
Zlo.prototype._loadFromSVNCache = function() {
    console.log(clc.green.bold('Load from svn cache'));
    //svn у нас уже счекаучен в режиме --depth empty

    if (!this._svnData) {
        return Promise.reject('SVN cache not defined');
    }

    return this._checkCashesInSVN()
        .then(function(isFilesExists) {
            if (!isFilesExists) {
                return Promise.reject('Can not load files from svn: no files in svn');
            }

            return this._checkoutSVN('empty', this._cacheFileNames)
                .then(function() {
                    return this._extractDependencies(this._svnData.path);
                }.bind(this))
                .then(function() {
                    console.log(clc.green.bold('Dependencies succesfully retrive from SVN'));

                    return true;
                })
        }.bind(this))
        .catch(function(err) {

            return Promise.reject(err);
        });
};
