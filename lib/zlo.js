'use strict';

var NPM_STORAGE = 'node_modules',
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
    colors = require('colors'),
    _ = require('lodash'),
    tar = require('tar-fs'),
    verbose,
    logger,
    TIMEOUT = 300 * 1e6;

module.exports = Zlo;

/**
 *
 * @param config {JSON} zlo config json
 * @param packageData {JSON} data from package.json
 * @param options.verbose {Boolean} verbose debug msg
 * @param options.dev {Boolean} load dev dependencies
 * @constructor
 */
function Zlo(config, packageData, options) {
    config = config || {};
    packageData = packageData || {};
    options = options || {};

    TIMEOUT = options.loadTimeout || TIMEOUT;

    var cwd = process.cwd(),
        mdHash = md5(JSON.stringify(packageData)),
        cacheFileName = NPM_STORAGE + (options.dev ? '.dev.' : '.') + mdHash + '.tar',
        dependencies = options.dev ? packageData.devDependencies : packageData.dependencies;

    logger = require('tracer').colorConsole({
        methods: [ 'debug', 'info', 'warn', 'success', 'error'],
        level: options.verbose ? 'debug' : 'info',
        filters: {
            debug: colors.blue,
            warn: colors.yellow,
            success: [colors.green, colors.bold],
            error: [colors.red, colors.bold]
        }
    });

    process.on('SIGINT', this._doCleanup.bind(this));

    this.start = process.hrtime();

    verbose = options.verbose;

    if (!config || !config.localCachePath || !config.svnCachePath) {
        this._endFail('Empty local storage path', null, false);

        return;
    }

    if (_.isEmpty(dependencies)) {
        this._endFail('Empty dependencies', null, false);

        return;
    }

    this._localStoragePath = path.resolve(cwd, config.localCachePath);

    try  {
        if (!fs.existsSync(this._localStoragePath)) {
            logger.debug('create directory: ' + this._localStoragePath);
            fs.mkdirsSync(this._localStoragePath);
        }
    } catch (err) {
        this._endFail('Can not create direcory for local cache', err, false);

        return;
    }

    var svnDirPath = path.resolve(cwd, TMP_DIRS.svn);

    this._createEmptyDir(svnDirPath);

    this._svnData = {
        url: config.svnCachePath,
        path: svnDirPath
    };

    this._cacheFileName = cacheFileName;

}

Zlo.prototype._createEmptyDir = function(dirPath) {
    try  {
        if (fs.existsSync(dirPath)) {
            fs.removeSync(dirPath);
        }

        logger.debug('create directory: ' + dirPath);
        fs.mkdirsSync(dirPath);
    } catch (err) {
        this._endFail('Can not create temp directory ' + dirPath, err, false);

        return;
    }
};

/**
 * Возвращает текст для коммит-мессаджа - добавляет к основному тексту автора коммита и данные о коммите
 * @param {String} text основной текст коммит-мессаджа
 * @returns {String}
 * @private
 */
Zlo.prototype._getCommitMessage = function(text) {
    return (new Date()).toDateString() + ';Author:'+ process.env.USER + '; message:' + text;
};

/**
 * Выполняет запрос в svn
 * @param {String} path путь по которому лежит папка с svn-репозиторием
 * @param {String} svncmd команда, например 'svn ls' или 'svn up'
 * @return {Promise}
 * @private
 */
Zlo.prototype._doCmd = function (path, svncmd) {
    logger.debug('svn: ' + svncmd);
    var cwd = process.cwd();

    process.chdir(path);

    return new Promise(function(resolve, reject) {
        exec(svncmd, function (err, stdout) {
            process.chdir(cwd);
            if (err) {
                logger.debug(err);
                logger.error(svncmd + ' error: ');
                reject(err);
            } else {
                logger.debug(svncmd + ' success');
                resolve(stdout);
            }
        }).stdout.on('data', function(data) {
            logger.debug(data);
        });
    });
};

/**
 * Успешное завершение скрипта обработки зависимостей
 * @private
 */
Zlo.prototype._endSuccess = function(msg, doCleanup) {
    if (!doCleanup) {
        logger.success(msg);

        this._printTime();
        process.exit(0);
    }

    this._doCleanup().then(function() {
        logger.success(msg);

        this._printTime();
        process.exit(0);
    }.bind(this));
};

/**
 * Выводим время, затраченное на выполнение программы
 * @private
 */
Zlo.prototype._printTime = function() {
    logger.info('Execution time: ' + process.hrtime(this.start)[0] + ' sec');
};

/**
 * Завершение скрипта обработки зависимостей с ошибкой
 * @private
 */
Zlo.prototype._endFail = function(errMsg, err, doCleanup) {
    if (!doCleanup) {
        logger.debug(err);
        logger.error(errMsg);

        this._printTime();
        process.exit(1);
    }

    this._doCleanup().then(function() {
        logger.error(errMsg);

        this._printTime();
        process.exit(1);
    }.bind(this));
};


/**
 * Проверяем есть ли файл _cacheFileName в потоке вывода stdout
 * @param {String} stdout
 * @returns {Boolean}
 * @private
 */
Zlo.prototype._isFileNameInStdout = function(stdout) {
    var regexp = new RegExp('(^|\\s)(' + this._cacheFileName + ')($|\\s)'),
        res = stdout.match(regexp);

    if (res && res[0]) {
        logger.debug('Found: '+ res && res[0]);

        return true;
    }
};

/**
 * Проверяет есть ли имена из списка файлов в директории
 * @param {String} dirPath
 * @returns {Boolean}
 * @private
 */
Zlo.prototype._isFileExistsInDir = function(dirPath) {
    var filePath = path.resolve(dirPath, this._cacheFileName);

    logger.debug(filePath + ' exists: ' + fs.existsSync(filePath));

    return fs.existsSync(filePath);
};


/**
 * Проверяем есть ли нужные кэши в svn
 * @return {Promise}
 */
Zlo.prototype._checkCashesInSVN = function() {
    var svncmd = 'svn ls '+ this._svnData.url;

    logger.debug('Check files ' + this._cacheFileName + ' in svn');

    return this._doCmd(this._svnData.path, svncmd)
        .then(function(data) {
            if (data && this._isFileNameInStdout(data)) {
                logger.debug('Files ' + this._cacheFileName + ' found in svn');

                return true;
            }

            logger.debug('Files ' + this._cacheFileName + ' not found in svn');

            return false;
        }.bind(this))
        .catch(function(e) {
            logger.error(e);

            return Promise.reject();
        });
};


/**
 * Запускает exec, который прерывается по таймауту
 * @private
 */
Zlo.prototype._execLimited = function(cmd, callback) {
    var timer = setTimeout(function() {
            this._endFail('Time is up', null, true);
        }.bind(this), TIMEOUT);

    exec(cmd, function(err, stdout) {
        clearTimeout(timer);
        callback(err, stdout);
    }).stdout.on('data', function(data) {
        logger.debug(data);
    })
};

/**
 * Установка зависимостей через bower и npm
 * @returns {Promise}
 */
Zlo.prototype._loadFromNPM = function () {
    logger.info('npm install');

    return new Promise(function(resolve, reject) {
        this._execLimited('npm install', function(err, stdout) {
            if (err) {
                logger.debug(err);
                logger.error('npm install error');
                reject();

                return;
            }
            logger.info('npm install finished');
            resolve();
        }.bind(this));
    }.bind(this));
};

/**
 * Удаляем кэши по md-сумме данного кофига
 */
Zlo.prototype.killMD5 = function(options) {
    var promisesArray = [];

    fs.mkdirsSync(TMP_DIRS.killmd5);

    options.local && promisesArray.push(this._removeCacheFiles([this._cacheFileName]));
    options.svn && promisesArray.push(this._removeSvnCache(true));

    Promise.all(promisesArray)
        .then(function() {
            this._endSuccess('Dependencies removed from cache', true);
        }.bind(this))
        .catch(function(err) {
            this._endFail('Can not remove dependencies from cache', err, true);
        }.bind(this));
};

/**
 * Очищает svn-кэш
 * @param {Boolean} removeCurrent удалять только кэш для текущего md-файла
 * @returns {Promise}
 * @private
 */
Zlo.prototype._removeSvnCache = function(removeCurrent) {
    var svn = this._svnData;

    if (removeCurrent) {
        return this._checkCashesInSVN()
            .then(function(isFilesExists) {
                if (!isFilesExists) {
                    logger.debug('Dependencies files ' + this._cacheFileName + ' not in svn cache');

                    return true;
                }

                var cmd = 'svn rm ' + svn.url + '/' + this._cacheFileName +
                    ' -m "' + this._getCommitMessage('Remove direct cache') + '"';

                return this._doCmd(TMP_DIRS.killmd5, cmd);
            }.bind(this))
            .then(function() {
                logger.info('Dependencies removed from svn cache');
            }.bind(this))
            .catch(function(err) {
                this._endFail('Can not remove dependencies from svn cache', err, true);
            }.bind(this));
    } else {
        var currentDir = TMP_DIRS.killAll;

        return this._doCmd(currentDir, 'svn checkout --depth immediates ' + svn.url + ' .')
            .then(function() {
                return this._doCmd(currentDir, 'svn ls').then(function(stdout) {
                    if (!stdout) {
                        logger.info('No dependencies files in svn cache');

                        return true;
                    }

                    return this._doCmd(currentDir, 'svn rm *')
                        .then(function() {
                            return this._doCmd(currentDir, 'svn commit -m "' + this._getCommitMessage('Remove all direct cache') + '"');
                        }.bind(this))
                }.bind(this));
            }.bind(this))
            .catch(function(err) {
                this._endFail('Can not remove dependencies from svn cache', err, true);
            }.bind(this));
    }
};

/**
 * Удаляет из локального кэша файлы
 * @param {Array} filesNames массив с именами файлов который надо удалить
 * @returns {Promise}
 * @private
 */
Zlo.prototype._removeCacheFiles = function(filesNames) {
    logger.debug('Remove files ' + filesNames.join(', ') + ' from local cache...');

    return new Promise(function(resolve, reject) {
        Promise.all(filesNames.map(function (name) {
            return new Promise(function(resolve, reject) {
                var filePath = path.resolve(this._localStoragePath, name);

                if (!fs.existsSync(filePath)) {
                    logger.debug('Dependecies file ' + name + ' not contain in local cache');

                    return resolve();
                }

                logger.debug('Remove file ' + name + ' from local cache...');

                fs.remove(filePath, function(err) {
                    if (err) {
                        reject(err);

                        return;
                    }

                    logger.debug(name + ' removed from local cache');
                    resolve();
                });
            }.bind(this));
        }, this))
            .then(function() {
                logger.info('Dependencies removed from local cache');
                resolve();
            })
            .catch(reject)
    }.bind(this));
};

/**
 * Чистим все возможные кэши
 */
Zlo.prototype.killAll = function (options) {
    var currentDir = TMP_DIRS.killAll,
        promisesArray = [];

    if (!fs.existsSync(currentDir)) {
        logger.debug('create directory: ' + currentDir);
        fs.mkdirsSync(currentDir);
    }

    options.local && promisesArray.push(this._removeAllCacheFiles());
    options.svn && promisesArray.push(this._removeSvnCache());

    Promise.all(promisesArray)
        .then(function() {
            this._endSuccess('Cache cleaned successfully', true)
        }.bind(this))
        .catch(function(err) {
            this._endFail('Can not clear cache', err, true);
        }.bind(this));

};

/**
 * Чистит все содержимое локального кэша
 * @private
 */
Zlo.prototype._removeAllCacheFiles = function() {
    return new Promise(function(resolve, reject) {
        fs.readdir(this._localStoragePath, function(err, files) {
            if (err) {
                reject(err);
            } else {
                if (!files || !files.length) {
                    logger.info('No dependencies files in local cache');
                    resolve();
                } else {
                    this._removeCacheFiles(files)
                        .then(resolve)
                        .catch(reject);
                }
            }
        }.bind(this));
    }.bind(this));
};

/**
 * Чекаут svn репозитории
 * @param {String} depth Параметр --deps с которым будет выполнен svn checkout
 * @param {String} file список файл, который нужно забрать из репозитория
 * @returns {Promise}
 * @private
 */
Zlo.prototype._checkoutSVN = function(depth, file) {
    return this._doCmd(this._svnData.path, 'svn checkout ' + this._svnData.url + ' . --depth ' + depth)
        .then(function() {
            return file && this._doCmd(this._svnData.path, 'svn up ' + file);
        }.bind(this))
        .then(function(stdout) {
            if (!file) return true;

            if (stdout) {
                logger.info('Files successfully retrives');
            } else {
                logger.error('Can not retrive files from SVN');
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
    logger.info('Archive dependencies ...');

    var cwd = process.cwd();

    return new Promise(function(resolve, reject) {
        var folderAbsPath = path.resolve(cwd, NPM_STORAGE),
            archiveAbsPath = path.resolve(this._localStoragePath || this._svnData.path, this._cacheFileName);

        logger.debug('Try archive ' + folderAbsPath + ' -> ' + archiveAbsPath);

        tar.pack(folderAbsPath).pipe(fs.createWriteStream(archiveAbsPath))
            .on('finish', function() {
                logger.info('Archive dependencies finished');
                resolve()
            })
            .on('error', function (err) {
                logger.debug(err);
                logger.error('Can not archive folders');
                reject();
            });
    }.bind(this));
};


/**
 * Извлекаем зависимости из архива
 * @param {String} storagePath путь из которого извлекаем - это может быть локальный кэш или временная папка с SVN
 * @returns {*}
 */
Zlo.prototype._extractDependencies = function(storagePath) {
    var cwd = process.cwd();

    logger.info('Extract dependencies ' + storagePath + ' ...');

    return new Promise(function(resolve, reject) {
        var cacheFilePath = path.resolve(storagePath, this._cacheFileName),
            destFolderPath = path.resolve(cwd, NPM_STORAGE);

        logger.debug('extract ' + cacheFilePath + ' -> ' + destFolderPath);

        fs.createReadStream(cacheFilePath).pipe(tar.extract(destFolderPath))
            .on('finish', function(stdout) {

                logger.debug('Extract dependencies: finish ' + destFolderPath);
                resolve();
            })
            .on('error', function(err) {
                logger.error('Error extract dependencies ' + destFolderPath, err);
                reject(err)
            })
    }.bind(this))
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
    var startParh = path.resolve(fromPath, this._cacheFileName),
        endParh = path.resolve(toPath, this._cacheFileName);

    logger.debug('copy ' + startParh + ' --> ' + endParh);

    return new Promise(function(resolve, reject) {
        fs.copy(startParh, endParh, function (err) {
            if (err) {
                logger.debug(err);
                logger.error('error copy ' + startParh + ' --> ' + endParh);
                reject();
            } else {
                logger.debug('success copy ' + startParh + ' --> ' + endParh);
                resolve();
            }

        })
    });
};

/**
 * Записываем свежесозданный архив в svn
 */
Zlo.prototype._putToSvn = function() {
    logger.info('Put to svn');

    if (!this._svnData) {
        logger.error('SVN url not defined');

        return Promise.reject('SVN url not defined');
    }

    //проверяем есть ли уже файлы в репозитории

    return this._checkCashesInSVN()
        .then(function(isFilesExists) {
            if (isFilesExists) {
                logger.info('Files already in SVN');

                return true;
            }

            return this._checkoutSVN('empty')
                .then(function() {
                    return this._copyArchives(this._localStoragePath, this._svnData.path);
                }.bind(this))
                .then(function() {
                    logger.info('Archives successfully copy to ' + this._svnData.path);

                    return this._doCmd(this._svnData.path, 'svn add ' + this._cacheFileName);
                }.bind(this))
                .then(function() {
                    return this._doCmd(this._svnData.path, 'svn commit -m "' + this._getCommitMessage('Add direct cache') + '"');
                }.bind(this))
                .then(function() {
                    logger.info('local changes has been committed!');

                    return true;
                })
                .catch(function(err) {
                    return Promise.reject(err);
                });
        }.bind(this))
        .catch(function(err) {
            logger.debug(err);
            logger.error('Can not put files to svn');

            return Promise.reject(err);
        });
};

/**
 * Удаляем ненужные конфиги и временные файлы
 */
Zlo.prototype._doCleanup = function() {
    var cwd = process.cwd(),
        promises = [];

    logger.info('Start cleaning up...');

    promises = promises.concat(_.map(TMP_DIRS, function(name) {
        var absPath = path.resolve(cwd, name);

        logger.debug('Remove directory ' + absPath);

        return new Promise(function(resolve) {
            if (fs.existsSync(absPath)) {
                fs.remove(absPath, function(err) {
                    if (err) {
                        logger.debug(err);
                        logger.error('Remove ' + name);
                    } else {
                        logger.debug('Directory ' + name + ' removed');
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        })

    }));

    return Promise.all(promises).then(function() {
        logger.info('Cleanup finished successfully');
    });
};


Zlo.prototype._tryPutToSvn = function() {
    logger.debug('Try put dependencies to svn');
    return this._putToSvn()
        .then(function (stdout) {
            logger.debug(stdout);

            logger.info('Dependencies committed to SVN cache');

            return true;
        }.bind(this))
        .catch(function(err) {
            logger.debug(err);
            logger.error('dependencies not committed to SVN cache');

            return Promise.reject();
        }.bind(this));
};

/**
 * Функция, отрабатывающая после успешной загрузки зависимостей
 * @param source источник, из которого были загружены зависимости
 * @private
 */
Zlo.prototype._onLoadingFinished = function(source) {
    logger.info('Start caching dependencies...');

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
            this._endSuccess('Dependencies successfully loaded', true);
        }.bind(this))
        .catch(function(err) {
            //не смогли закэшировать - но зависимости так или иначе успешно загрузились
            this._endSuccess('Dependencies successfully loaded', true);
        }.bind(this));
};

/**
 * Установка зависимостей согласно конфигу zlo.json
 */
Zlo.prototype.loadDependencies = function() {

    return this._loadFromLocalCache()
        .then(function() {
            logger.success('Dependencies successfully loaded from local cache');

            return this._onLoadingFinished('local');
        }.bind(this))
        .catch(function(err) {
            logger.warn('Can not load files from local cache', err);

            return this._loadFromSVNCache()
                .then(function() {
                    logger.success('Dependencies successfully loaded from svn cache');
                    //если данные загрузились из svn - копируем их в локальный кэш
                    return this._onLoadingFinished('svn');
                }.bind(this))
                .catch(function(err) {
                    logger.warn('Can not load dependencies from svn cache', err);

                    return this._loadFromNPM()
                        .then(function() {
                            logger.success('Dependencies successfully loaded from npm');

                            return this._onLoadingFinished('npm');
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
    logger.info('Load from local cache: start');

    if (!this._localStoragePath) {
        return Promise.reject('Can not load from local cache. Cache path not defined');
    }

    if (this._isFileExistsInDir(this._localStoragePath)) {
        logger.info('Files ' + this._cacheFileName + ' found in local storage');

        return this._extractDependencies(this._localStoragePath)
            .then(function() {
                logger.info('Dependencies succesfully retrive from local storage');

                return Promise.resolve();
            })
            .catch(function(err) {
                logger.error(err);

                return Promise.reject('Can not load files from local storage');
            });
    } else {
        return Promise.reject('Files ' + this._cacheFileName + ' not exists in local storage');
    }

};

/**
 * Пытаемся загрузить зависимости из svn
 * @returns {Promise}
 */
Zlo.prototype._loadFromSVNCache = function() {
    logger.info('Load from svn cache');
    //svn у нас уже счекаучен в режиме --depth empty

    if (!this._svnData) {
        return Promise.reject('SVN cache not defined');
    }

    return this._checkCashesInSVN()
        .then(function(isFilesExists) {
            if (!isFilesExists) {
                return Promise.reject('Can not load files from svn: no files in svn');
            }

            return this._checkoutSVN('empty', this._cacheFileName)
                .then(function(stdout) {
                    return this._extractDependencies(this._svnData.path);
                }.bind(this))
                .then(function() {
                    logger.info('Dependencies succesfully retrive from SVN');

                    return true;
                })
        }.bind(this))
        .catch(function(err) {

            return Promise.reject(err);
        });
};
