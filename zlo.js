'use strict';

var CONFIG_NAME = 'zlo.json',
    NPM_CONFIG_NAME = 'package.json',
    BOWER_CONFIG_NAME = 'bower.json',

    NPM_STORAGE = 'node_modules',
    BOWER_STORAGE = 'libs',

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

    var svnDirPath = path.resolve(cwd, '_tmp_svn_');

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
                errorLog(clc.red('svn cmd error'), err);
                reject(err);
            } else {
                console.log(clc.green('svn cmd success: ') + stdout);
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
    return (_.every(this._cacheFileNames, function (name) {
        var regexp = new RegExp('(^|\\s)(' + name + ')($|\\s)'),
            res = stdout.match(regexp);

        res && res[0] & console.log(clc.yellow('Found: '+ res && res[0]));

        return res && res[0];
    }));
};

/**
 * Проверяет есть ли имена из списка файлов в директории
 * @param {String} dirPath
 * @returns {Boolean}
 * @private
 */
Zlo.prototype._isFilesExistsInDir = function(dirPath) {
    var self = this;

    return _.every(self._cacheFileNames, function (name) {
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
    var self = this,
        svncmd = 'svn ls '+ this._svnData.url;

    return this._doCmd(self._svnData.path, svncmd)
        .then(function(data) {
            if (self._isFilesNamesInStdout(data)) {
                console.log(clc.green('Files ' + self._cacheFileNames + ' found in svn'));

                return true;
            } else {
                console.log(clc.yellow('Files ' + self._cacheFileNames + ' not found in svn'));

                return false;
            }
        })
        .catch(function(e) { return Promise.reject(e); });
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
    var self = this;

    console.log(clc.green('Load dependencies via bower and npm'));

    console.log('npm install');

    return new Promise(function(resolve, reject) {
        exec('npm install', function(err, stdout) {
            if (err) {
                errorLog('npm install', err);
                reject();
                process.exit(0);
                return;
            }
            console.log(stdout);
            console.log(clc.green('npm install finished'));

            var bowerPath = path.resolve(__dirname, 'node_modules/bower/bin/bower');

            console.log(bowerPath + ' install');
            exec(bowerPath + ' install', function(err, stdout) {
                if (err) {
                    errorLog(bowerPath + ' install', err);
                    reject();
                    process.exit(0);

                    return;
                }
                console.log(stdout);
                console.log(clc.green('bower install finished'));

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

    fs.mkdirsSync('_kill-md5-dir_');

    var self = this;

    self._checkCashesInSVN()
        .then(function(isFilesExists) {
            if (!isFilesExists) {
                return false;
            }

            var cmd = 'svn rm ' + self._cacheFileNames.map(function (name) { return svn.url + '/' + name; }).join(' ') +
                ' -m "zlo: remove caches"';

            return self._doCmd('_kill-md5-dir_', cmd);
        })
        .then(function(isFilesRemoved) {
            if (isFilesRemoved) {
                console.log(clc.green('Files ' + self._cacheFileNames + ' removed from svn'))
            } else {
                console.log(clc.green('Nothing to remove'));
            }
            fs.removeSync('_kill-md5-dir_');
        })
        .catch(function(err) { return Promise.reject(err); });

    if (!options.svnOnly) {
        this._removeCacheFiles(this._localStoragePath);
    }
};

Zlo.prototype._removeCacheFiles = function (storagePath) {
    var self = this;

    self._cacheFileNames.map(function (name) {
        var filePath = path.resolve(storagePath, name);

        fs.removeSync(filePath);
        console.log(clc.green('remove ' + filePath));
    });
};


/**
 * Чистим все возможные кэши
 */
Zlo.prototype.killAll = function (options) {
    var svn = this._svnData,
        self = this;

    options = options || {};


    var currentDir = '_kill-all-dir_';

    if (!fs.existsSync(currentDir)) {
        console.log('create directory: ' + currentDir);
        fs.mkdirsSync(currentDir);
    }

    return self._doCmd(currentDir, 'svn checkout --depth immediates ' + svn.url + ' .')
        .then(function(stout) {
            console.log(stout);

            return self._doCmd(currentDir, 'svn ls');
        })
        .then(function(stout) {
            if (!stout) {
                console.log(clc.green.bold('SVN cache is already empty'));

                return false;
            }

            console.log(stout);

            return self._doCmd(currentDir, 'svn rm *')
                .then(function(stout) {
                    console.log(stout);

                    return self._doCmd(currentDir, 'svn commit -m "zlo: remove all direct cache"', function(err, stout) {
                        if (err) {
                            errorLog('svn commit -m "zlo: remove all direct cache"', err);
                            process.exit(0);
                        }
                        console.log('local changes has been committed!');
                        console.log(clc.green.bold('SVN cache is  empty'));
                        fs.removeSync(currentDir);
                    });
                })
        })
        .catch(function(err) {
            errorLog('do cmd', err);
            process.exit(0);
        });


    if (!options.svnOnly) {
        fs.removeSync(this._localStoragePath);
        console.log(clc.green('remove ' + this._localStoragePath));
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
    var self = this;

    files = files || [];

    return self._doCmd(self._svnData.path, 'svn checkout ' + self._svnData.url + ' . --depth ' + depth)
        .then(function(stdout) {
            return files.length && self._doCmd(self._svnData.path, 'svn up ' + files.join(' '));
        })
        .then(function(stdout) {
            if (!files) return true;

            if (stdout) {
                console.log(clc.green('Files successfully retrives'));
            } else {
                errorLog('Can not retrive files from SVN');
            }

            return true;
        })
        .catch(function(err) {
            return Promise.reject('Can not retrive files from SVN');
        });
};


/**
 * Архивирование зависимостей
 */
Zlo.prototype.archiveDependencies = function() {
    console.log(clc.green('archiveDependencies: start'));

    var cwd = process.cwd(),
        self = this;

    return new Promise(function(resolve) {
        var promisesArray = self._dependenciesFolders.map(function(folderName, index) {
            var folderAbsPath = path.resolve(cwd, folderName),
                archiveAbsPath = path.resolve(self._localStoragePath || self._svnData.path, self._getCacheFileName(index));

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
        });

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
    });
};


/**
 * Извлекаем зависимости из архива
 * @param {String} storagePath путь из которого извлекаем - это может быть локальный кэш или временная папка с SVN
 * @returns {*}
 */
Zlo.prototype._extractDependencies = function(storagePath) {
    var self = this,
        cwd = process.cwd();

    console.log(clc.green.bold('_extractDependencies - starts, path = ' + storagePath));

    var promisesArray = self._dependenciesFolders.map(function (name, index) {
        return new Promise(function(resolve, reject) {
            var cacheFilePath = path.resolve(storagePath, self._getCacheFileName(index)),
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
        })
    });

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
    var self = this;

    return Promise.all(self._cacheFileNames.map(function (cacheName) {
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
    var self = this;

    console.log(clc.green('Put to svn'));

    if (!self._svnData) {
        console.log(clc.yellow('SVN url not defined'));

        return Promise.reject('SVN url not defined');
    }

    //проверяем есть ли уже файлы в репозитории

    return self._checkCashesInSVN()
        .then(function(isFilesExists) {
            if (isFilesExists) {
                console.log(clc.green('Files already in SVN'));
                return true;
            } else {
                return self._checkoutSVN('empty', [])
                    .then(function() {
                        return self._copyArchives(self._localStoragePath, self._svnData.path);
                    })
                    .then(function() {
                        console.log(clc.green('Archives successfully copy to ' + self._svnData.path));

                        return self._doCmd(self._svnData.path, 'svn add ' + self._cacheFileNames.join(' '));
                    })
                    .then(function() {
                        return self._doCmd(self._svnData.path, 'svn commit -m "zlo: add direct cache"');
                    })
                    .then(function() {
                        console.log(clc.green('local changes has been committed!'));

                        return true;
                    });
            }
        })
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

    fs.remove(this._svnData.path);

    fs.remove(path.resolve(cwd, '.bowerrc'), function(err) {
        if (err) errorLog('Remove .bowerrc', err);
    });
    fs.remove(path.resolve(cwd, NPM_CONFIG_NAME), function(err) {
        if (err) errorLog('Remove ' + NPM_CONFIG_NAME, err);
    });
    fs.remove(path.resolve(cwd, BOWER_CONFIG_NAME), function(err) {
        if (err) errorLog('Remove ' + BOWER_CONFIG_NAME, err);
    });
};

/**
 * Действия, выполняемые после успешной загрузки зависимостей
 */
Zlo.prototype._onLoadSuccess = function() {
    var self = this;

    if (this._postinstall && this._postinstall.length > 0) {
        console.log(clc.green('Doing postinstall'));
        Promise.all(this._postinstall.map(function(postinstall) {
            return new Promise(function(resolve, reject) {
                console.log('posintall: ' + postinstall.command);
                exec(postinstall.command, function(err, stdout) {
                    if (err) {
                        errorLog('postinstall', err);
                        reject();
                        self._doCleanup();
                    } else {
                        console.log(stdout);
                        resolve();
                    }
                });
            });
        })).then(
            function() {
                console.log(clc.green('postinstall done'));

            },
            function (err) {
                errorLog('postinstall error');
            }
        )
    } else {
        this._doCleanup();
    }
};

Zlo.prototype._tryPutToSvn = function() {
    var self = this;

    return this._putToSvn()
        .then(function (stdout) {
            console.log(clc.green.bold('Dependencies committed to SVN cache'));

            self._onLoadSuccess();
        })
        .catch(function(err) {
            errorLog('dependencies not committed to SVN cache', err);

            //не смогли положить в svn - но почистить за собой нужно
            self._onLoadSuccess();
        });
};

/**
 * Установка зависимостей согласно конфигу zlo.json
 */
Zlo.prototype.loadDependencies = function() {
    var self = this;

    return self._loadFromLocalCache()
        .then(function() {
            return self._tryPutToSvn();
        })
        .catch(function(err) {
            errorLog('Load from local cache error', err);

            return self._loadFromSVNCache()
                .then(function(stdout) {
                    console.log(clc.blue('Load from local svn success: ') + stdout);
                    //если данные загрузились из svn - копируем их в локальный кэш
                    return self._copyArchives(self._svnData.path, self._localStoragePath)
                        .then(function () {
                            self._onLoadSuccess();
                        })
                        .catch(function(err) {
                            errorLog('Copy archives', err);

                            return Promise.reject(err);
                        })
                })
                .catch(function(err) {
                    errorLog('Load from local svn', err);

                    return self._loadFromNet()
                        .then(function() {
                            return self.archiveDependencies();
                        })
                        .then(function() {
                            return self._tryPutToSvn();
                        })
                        .catch(function(err) {
                            errorLog('Can not load dependencies!!!', err);

                            return Promise.reject(err);
                        });
                })
        });

};

/**
 * Пытаемся загрузить зависимости из локального кэша
 * @returns {Promise}
 */

Zlo.prototype._loadFromLocalCache = function() {
    var self = this;

    console.log(clc.green.bold('Load from local cache'));

    if (!self._localStoragePath) {
        return Promise.reject('Can not load from local cache. Cache path not defined');
    }

    if (self._isFilesExistsInDir(self._localStoragePath)) {
        console.log(clc.green('Files ' + self._cacheFileNames + ' found in local storage'));

        return self._extractDependencies(self._localStoragePath)
            .then(function() {
                console.log(clc.green.bold('Dependencies succesfully retrive from local strorafe'));

                return Promise.resolve();
            })
            .catch(function(err) {
                console.log(err);

                return Promise.reject('Can not load files from local storage');
            });
    } else {
        return Promise.reject('Files ' + self._cacheFileNames + ' not exists in local storage');
    }

};

/**
 * Пытаемся загрузить зависимости из svn
 * @returns {Promise}
 */
Zlo.prototype._loadFromSVNCache = function() {
    var self = this;

    console.log(clc.green.bold('Load from svn cache'));
    //svn у нас уже счекаучен в режиме --depth empty

    if (!self._svnData) {
        return Promise.reject('SVN cache not defined');
    }

    return self._checkCashesInSVN()
        .then(function(isFilesExists) {
            if (!isFilesExists) {
                return Promise.reject('Can not load files from svn: no files in svn');
            }

            return self._checkoutSVN('empty', self._cacheFileNames)
                .then(function() {
                    return self._extractDependencies(self._svnData.path);
                })
                .then(function() {
                    console.log(clc.green.bold('Dependencies succesfully retrive from SVN'));

                    return true;
                })
        })
        .catch(function(err) {

            return Promise.reject(err);
        });
};
