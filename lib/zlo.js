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
    console.error(clc.red('zlo: ERROR: ' + code + (debugMsg ? ' ' + JSON.stringify(debugMsg) : '')));
}

function successLog(code) {
    console.log(clc.green('zlo: SUCCESS: ' + code));
}

function warningLog(code, debugMsg) {
    console.log(clc.yellow('zlo: WARNING: ' + code + (debugMsg ? ' ' + JSON.stringify(debugMsg) : '')))
}

function log(msg) {
    if (Zlo.prototype.verbose) {
        console.log('zlo: ' + clc.underline(JSON.stringify(msg)));
    } else {
        console.log('zlo: ' + JSON.stringify(msg));
    }
}

function verboseLog(msg) {
    Zlo.prototype.verbose && console.log(msg);
}

/**
 *
 * @param configJSON {JSON} config json
 * @param options.verbose {Boolean} verbose debug msg
 * @constructor
 */
function Zlo(configJSON, options) {
    configJSON = configJSON || {};
    options = options || {};

    var cwd = process.cwd(),
        mdHash = md5(JSON.stringify(configJSON)),
        cacheFileName = mdHash + '.tar';

    this.start = process.hrtime();

    this._postinstall = [];
    //пишем в  Zlo.prototype чтобы не нужно было прокидывать контекст
    Zlo.prototype.verbose = options.verbose ;

    if (!configJSON.storage || (!configJSON.storage.local || !configJSON.storage.svn)) {
        this._endFail('Empty local storage path', null, false);

        return;
    }

    if (!configJSON.dependencies || !configJSON.dependencies.length) {
        this._endFail('Empty dependencies', null, false);

        return;
    }

    this._localStoragePath = path.resolve(cwd, configJSON.storage.local);

    try  {
        if (!fs.existsSync(this._localStoragePath)) {
            verboseLog('create directory: ' + this._localStoragePath);
            fs.mkdirsSync(this._localStoragePath);
        }
    } catch (err) {
        this._endFail('Can not create direcory for local cache', err, false);

        return;
    }

    var svnDirPath = path.resolve(cwd, TMP_DIRS.svn);

    this._createEmptyDir(svnDirPath);

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

    this.createConfigs().catch(function(e) {
        this._endFail('Can not create config files', e, true);
    }.bind(this));
}

Zlo.prototype._createEmptyDir = function(dirPath) {
    try  {
        if (fs.existsSync(dirPath)) {
            fs.removeSync(dirPath);
        }

        verboseLog('create directory: ' + dirPath);
        fs.mkdirsSync(dirPath);
    } catch (err) {
        this._endFail('Can not create temp directory ' + dirPath, err, false);

        return;
    }
};

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
    verboseLog('svn: ' + svncmd);
    var cwd = process.cwd();

    process.chdir(path);

    return new Promise(function(resolve, reject) {
        exec(svncmd, function (err, stdout) {
            process.chdir(cwd);
            if (err) {
                verboseLog(stdout);
                errorLog(svncmd + ' error: ', err);
                reject(err);
            } else {

                verboseLog(stdout);
                verboseLog(svncmd + ' success');
                resolve(stdout);
            }
        });
    });
};

/**
 * Успешное завершение скрипта обработки зависимостей
 * @private
 */
Zlo.prototype._endSuccess = function(msg, doCleanup) {
    if (!doCleanup) {
        successLog(msg);

        this._printTime();
        process.exit(0);
    }

    this._doCleanup().then(function() {
        successLog(msg);

        this._printTime();
        process.exit(0);
    }.bind(this));
};

/**
 * Выводим время, затраченное на выполнение программы
 * @private
 */
Zlo.prototype._printTime = function() {
    log('Execution time: ' + process.hrtime(this.start)[0] + ' sec');
};

/**
 * Завершение скрипта обработки зависимостей с ошибкой
 * @private
 */
Zlo.prototype._endFail = function(errMsg, err, doCleanup) {
    if (!doCleanup) {
        errorLog(errMsg, err);

        this._printTime();
        process.exit(1);
    }

    this._doCleanup().then(function() {
        errorLog(errMsg, err);

        this._printTime();
        process.exit(1);
    }.bind(this));
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
            verboseLog('Found: '+ res && res[0]);

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

        verboseLog(filePath + ' exists: ' + fs.existsSync(filePath));

        return fs.existsSync(filePath);
    });
};


/**
 * Проверяем есть ли нужные кэши в svn
 * @return {Promise}
 */
Zlo.prototype._checkCashesInSVN = function() {
    var svncmd = 'svn ls '+ this._svnData.url;

    verboseLog('Check files ' + this._cacheFileNames.join(', ') + ' in svn');

    return this._doCmd(this._svnData.path, svncmd)
        .then(function(data) {
            if (data && this._isFilesNamesInStdout(data)) {
                verboseLog('Files ' + this._cacheFileNames + ' found in svn');

                return true;
            }

            verboseLog('Files ' + this._cacheFileNames + ' not found in svn');

            return false;
        }.bind(this))
        .catch(function(e) {
            errorLog(e);

            return Promise.reject();
        });
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

    return Promise.all(this._configsData.map(function (config) {
        verboseLog('create confing ' + config.path, json.plain(config.data));

        return new Promise(function(resolve, reject) {
            fs.writeJson(config.path, config.data, function(err) {
                if (err) {
                    errorLog('Can not write ' + config.path, err);

                    reject(err);
                } else {
                    resolve();
                }
            })
        })
    }));
};

/**
 * Установка зависимостей через bower и npm
 * @returns {*}
 */
Zlo.prototype._loadFromNet = function () {
    log('Load dependencies via bower and npm');
    log('npm install');

    return new Promise(function(resolve, reject) {
        exec('npm install', function(err, stdout) {
            if (err) {
                errorLog('npm install', err);
                reject();

                return;
            }
            verboseLog(stdout);
            log('npm install finished');
            var bowerPath = __dirname.split('/');

            bowerPath = path.resolve(bowerPath.slice(0, bowerPath.length - 1).join('/'), 'node_modules/bower/bin/bower');

            log(bowerPath + ' install');
            exec(bowerPath + ' install', function(err, stdout) {
                if (err) {
                    errorLog(bowerPath + ' install', err);
                    reject();

                    return;
                }
                verboseLog(stdout);
                log(bowerPath + ' install finished');

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
                verboseLog('Dependencies files ' + this._cacheFileNames.join(', ') + ' not in svn cache');
                return true;
            }

            var cmd = 'svn rm ' + this._cacheFileNames.map(function (name) { return svn.url + '/' + name; }).join(' ') +
                ' -m "zlo: remove caches"';

            return this._doCmd(TMP_DIRS.killmd5, cmd);
        }.bind(this))
        .then(function() {
            log('Dependencies removed from svn cache');

            return !options.svnOnly ? this._removeCacheFiles(this._cacheFileNames) : true;
        }.bind(this))

        .then(function() {
            this._endSuccess('Dependencies removed from cache', true);
        }.bind(this))
        .catch(function(err) {
            this._endFail('Can not remove dependencies from cache', err, true);
        }.bind(this));
};

/**
 * Удаляет из локального кэша файлы
 * @param {Array} filesNames массив с именами файлов, которые надо удалить
 * @private
 */
Zlo.prototype._removeCacheFiles = function(filesNames) {
    verboseLog('Remove files ' + filesNames.join(', ') + ' from local cache...');

    return new Promise(function(resolve, reject) {
        Promise.all(filesNames.map(function (name) {
            return new Promise(function(resolve, reject) {
                var filePath = path.resolve(this._localStoragePath, name);

                if (!fs.existsSync(filePath)) {
                    verboseLog('Dependecies file ' + name + ' not contain in local cache');

                    return resolve();
                }

                verboseLog('Remove file ' + name + ' from local cache...');

                fs.remove(filePath, function(err) {
                    if (err) {
                        reject(err);

                        return;
                    }

                    verboseLog(name + ' removed from local cache');
                    resolve();
                });
            }.bind(this));
        }, this))
            .then(function() {
                log('Dependencies removed from local cache');
                resolve();
            })
            .catch(reject)
    }.bind(this));
};

/**
 * Чистим все возможные кэши
 */
Zlo.prototype.killAll = function (options) {
    var svn = this._svnData,
        currentDir = TMP_DIRS.killAll;

    options = options || {};

    if (!fs.existsSync(currentDir)) {
        verboseLog('create directory: ' + currentDir);
        fs.mkdirsSync(currentDir);
    }

    this._doCmd(currentDir, 'svn checkout --depth immediates ' + svn.url + ' .')
        .then(function() {
            return this._doCmd(currentDir, 'svn ls').then(function(stdout) {
                if (!stdout) {
                    log('No dependencies files in svn cache');

                    return true;
                }

                return this._doCmd(currentDir, 'svn rm *')
                    .then(function() {
                        return this._doCmd(currentDir, 'svn commit -m "zlo: remove all direct cache"')
                    }.bind(this))
            }.bind(this));
        }.bind(this))
        .then(function() {
            if (!options.svnOnly) {

                return new Promise(function(resolve, reject) {
                    fs.readdir(this._localStoragePath, function(err, files) {
                        if (err) {
                            reject(err);
                        } else {
                            if (!files || !files.length) {
                                log('No dependencies files in local cache');
                                resolve();
                            } else {
                                this._removeCacheFiles(files)
                                    .then(resolve)
                                    .catch(reject);
                            }
                        }
                    }.bind(this));
                }.bind(this));
            }
        }.bind(this))
        .then(function() {
            this._endSuccess('Cache cleaned successfully', true)
        }.bind(this))
        .catch(function(err) {
            this._endFail('Can not clear cache', err, true);
        }.bind(this));

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
                log('Files successfully retrives');
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
    log('Archive dependencies ...');

    var cwd = process.cwd();

    return new Promise(function(resolve) {
        var promisesArray = this._dependenciesFolders.map(function(folderName, index) {
            var folderAbsPath = path.resolve(cwd, folderName),
                archiveAbsPath = path.resolve(this._localStoragePath || this._svnData.path, this._getCacheFileName(index));

            verboseLog('Try archive ' + folderAbsPath + ' -> ' + archiveAbsPath);

            return new Promise(function(resolve, reject) {
                tar.pack(folderAbsPath).pipe(fs.createWriteStream(archiveAbsPath))
                    .on('finish', function() {
                        verboseLog('Archive dependencies finished for ' + archiveAbsPath);
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
                log('Archive dependencies finished');
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
    var cwd = process.cwd(),
        promisesArray = this._dependenciesFolders.map(function(name, index) {
            return new Promise(function(resolve, reject) {
                var cacheFilePath = path.resolve(storagePath,
                    this._getCacheFileName(index)), destFolderPath = path.resolve(cwd, name);

                verboseLog('extract ' + cacheFilePath + ' -> ' + destFolderPath);

                fs.createReadStream(cacheFilePath).pipe(tar.extract(destFolderPath))
                    .on('finish', function(stdout) {

                        verboseLog('Extract dependencies: finish ' + destFolderPath);
                        resolve();
                    })
                    .on('error', function(err) {
                        errorLog('Error extract dependencies ' + destFolderPath, err);
                        reject(err)
                    })
            }.bind(this));
        }.bind(this));

    log('Extract dependencies ' + storagePath + ' ...');

    return Promise.all(promisesArray)
        .catch(function() {
            return Promise.reject('Can not extract dependencies');
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

        verboseLog('copy ' + startParh + ' --> ' + endParh);

        return new Promise(function(resolve, reject) {
            fs.copy(startParh, endParh, function (err) {
                if (err) {
                    errorLog('error copy ' + startParh + ' --> ' + endParh, err);
                    reject();
                } else {
                    verboseLog('success copy ' + startParh + ' --> ' + endParh);
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
    log('Put to svn');

    if (!this._svnData) {
        errorLog('SVN url not defined');

        return Promise.reject('SVN url not defined');
    }

    //проверяем есть ли уже файлы в репозитории

    return this._checkCashesInSVN()
        .then(function(isFilesExists) {
            if (isFilesExists) {
                log('Files already in SVN');

                return true;
            }

            return this._checkoutSVN('empty', [])
                .then(function() {
                    return this._copyArchives(this._localStoragePath, this._svnData.path);
                }.bind(this))
                .then(function() {
                    log('Archives successfully copy to ' + this._svnData.path);

                    return this._doCmd(this._svnData.path, 'svn add ' + this._cacheFileNames.join(' '));
                }.bind(this))
                .then(function() {
                    return this._doCmd(this._svnData.path, 'svn commit -m "zlo: add direct cache"');
                }.bind(this))
                .then(function() {
                    log('local changes has been committed!');

                    return true;
                })
                .catch(function(err) {
                    return Promise.reject(err);
                });
        }.bind(this))
        .catch(function(err) {
            errorLog('Can not put files to svn', err);

            return Promise.reject(err);
        });
};

/**
 * Удаляем ненужные конфиги и временные файлы
 */
Zlo.prototype._doCleanup = function() {
    var cwd = process.cwd(),
        promises = [];

    log('Start cleaning up...');

    promises = promises.concat(_.map(TMP_DIRS, function(name) {
        var absPath = path.resolve(cwd, name);

        verboseLog('Remove directory ' + absPath);

        return new Promise(function(resolve) {
            if (fs.existsSync(absPath)) {
                fs.remove(absPath, function(err) {
                    if (err) {
                        errorLog('Remove ' + name, err);
                    } else {
                        verboseLog('Directory ' + name + ' removed');
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        })

    }));

    promises = promises.concat(['.bowerrc', NPM_CONFIG_NAME, BOWER_CONFIG_NAME].map(function(name) {
        var absPath = path.resolve(cwd, name);

        return new Promise(function(resolve) {
            if (fs.existsSync(absPath)) {
                fs.remove(absPath, function(err) {
                    if (err) {
                        errorLog('Remove ' + name, err);
                    } else {
                        verboseLog('File ' + name + ' removed');
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }, this));

    return Promise.all(promises).then(function() {
        log('Cleanup finished successfully');
    });
};


Zlo.prototype._tryPutToSvn = function() {
    verboseLog('Try put dependencies to svn');
    return this._putToSvn()
        .then(function (stdout) {
            verboseLog(stdout);

            log('Dependencies committed to SVN cache');

            return true;
        }.bind(this))
        .catch(function(err) {
            errorLog('dependencies not committed to SVN cache', err);

            return Promise.reject();
        }.bind(this));
};

/**
 * Функция, отрабатывающая после успешной загрузки зависимостей
 * @param source источник, из которого были загружены зависимости
 * @private
 */
Zlo.prototype._onLoadingFinished = function(source) {
    log('Start caching dependencies...');

    var postProcessFunction;

    if (source == 'local') {
        postProcessFunction = function() {
            return this._tryPutToSvn();
        }.bind(this);
    } else if (source == 'svn') {
        postProcessFunction = function() {
            return this._copyArchives(this._svnData.path, this._localStoragePath);
        }.bind(this);
    } else {
        postProcessFunction = function() {
            return this._archiveDependencies()
                .then(function() {
                    return this._tryPutToSvn();
                }.bind(this))
        }.bind(this);
    }

    postProcessFunction()
        .then(function() {
            return (source == 'net') && this._doPostinstall();
        }.bind(this))
        .then(function() {
            this._endSuccess('Dependencies successfully loaded', true);
        }.bind(this))
        .catch(function(err) {
            if (err == 'postinstall') {
                this._endFail('Can not perform postinstall action', null, true);
            } else {
                //не смогли закэшировать - но зависимости так или иначе успешно загрузились
                this._endSuccess('Dependencies successfully loaded', true);
            }
        }.bind(this));
};

Zlo.prototype._doPostinstall = function() {
    if (this._postinstall && this._postinstall.length > 0) {
        log('Doing postinstall...');

        return Promise.all(this._postinstall.map(function(postinstall) {
            return new Promise(function(resolve, reject) {
                verboseLog('posintall: ' + postinstall.command);
                exec(postinstall.command, function(err, stdout) {
                    if (err) {
                        errorLog('postinstall', err);

                        reject('postinstall');
                    } else {
                        verboseLog(stdout);
                        resolve();
                    }
                }.bind(this));
            }.bind(this));
        }, this))
            .then(function() {
                successLog('Doing postinstall: success');
            })
            .catch(function() {
                errorLog('Doing postinstall: failed');

                return Promise.reject('postinstall');
            })
    } else {
        return Promise.resolve();
    }
};

/**
 * Установка зависимостей согласно конфигу zlo.json
 */
Zlo.prototype.loadDependencies = function() {

    return this._loadFromLocalCache()
        .then(function() {
            successLog('Dependencies successfully loaded from local cache');

            return this._onLoadingFinished('local');
        }.bind(this))
        .catch(function(err) {
            warningLog('Can not load files from local cache', err);

            return this._loadFromSVNCache()
                .then(function() {
                    successLog('Dependencies successfully loaded from svn cache');
                    //если данные загрузились из svn - копируем их в локальный кэш
                    return this._onLoadingFinished('svn');
                }.bind(this))
                .catch(function(err) {
                    warningLog('Can not load dependencies from svn cache', err);

                    return this._loadFromNet()
                        .then(function() {
                            successLog('Dependencies successfully loaded from Internet');

                            return this._onLoadingFinished('net');
                        }.bind(this))
                        .catch(function(err) {
                            this._endFail('Dependencies loading error', err);
                        }.bind(this));
                }.bind(this))
        }.bind(this));

};

/**
 * Пытаемся загрузить зависимости из локального кэша
 * @returns {Promise}
 */

Zlo.prototype._loadFromLocalCache = function() {
    log('Load from local cache: start');

    if (!this._localStoragePath) {
        return Promise.reject('Can not load from local cache. Cache path not defined');
    }

    if (this._isFilesExistsInDir(this._localStoragePath)) {
        log('Files ' + this._cacheFileNames + ' found in local storage');

        return this._extractDependencies(this._localStoragePath)
            .then(function() {
                log('Dependencies succesfully retrive from local storage');

                return Promise.resolve();
            })
            .catch(function(err) {
                errorLog(err);

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
    log('Load from svn cache');
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
                .then(function(stdout) {
                    verboseLog(stdout);

                    return this._extractDependencies(this._svnData.path);
                }.bind(this))
                .then(function() {
                    log('Dependencies succesfully retrive from SVN');

                    return true;
                })
        }.bind(this))
        .catch(function(err) {

            return Promise.reject(err);
        });
};
