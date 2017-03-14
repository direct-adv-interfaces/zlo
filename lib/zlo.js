'use strict';

var STORAGE_FOLDER = 'node_modules',
    TMP_DIRS = {
        killmd5: '_tmp-kill-md5-dir_',
        killAll: '_tmp-kill-all-dir_',
        killAllExceptCurrent: '_tmp-kill-all-expect-current-dir_',
        svn: '_tmp_svn_'
    },
    initPackageManager = require('./package-manager'),
    initLogger = require('./logger'),
    packageManager,
    parseXML = require('xml2js').parseString,
    json = require('format-json'),
    Promise = require('promise'),
    fs = require('fs-extra'),
    exec = require('child_process').exec,
    spawn = require('child_process').spawn,
    path = require('path'),

    _ = require('lodash'),
    tar = require('tar-fs'),
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
    packageManager = initPackageManager({
        useYarn: config.useYarn,
        verbose: options.verbose,
        TIMEOUT: TIMEOUT
    });

    var cwd = process.cwd(),
        mdHash = packageManager.getHashSum(),
        cacheFileName = STORAGE_FOLDER + (options.dev ? '.dev.' : '.') + mdHash + '.tar',
        //todo - не проверялось, скорее всего работать не будет
        dependencies = options.dev ? _.extend(packageData.dependencies, packageData.devDependencies) : packageData.dependencies;
    logger = initLogger({
        verbose: options.verbose
    });

    process.on('SIGINT', (function() {
        this._doCleanup().then(function() {
            process.exit(0);
        });
    }).bind(this));

    this.start = process.hrtime();

    if (!config || !config.localCachePath) {
        this._endFail('Empty local storage path', null, { skipCleanup: true });

        return;
    }

    if (!config || !config.svnCachePath) {
        this._endFail('Empty svn storage path', null, { skipCleanup: true });

        return;
    }

    if (_.isEmpty(dependencies)) {
        this._endFail('Empty dependencies', null, { skipCleanup: true });

        return;
    }

    this._localStoragePath = path.resolve(cwd, config.localCachePath);

    try  {
        if (!fs.existsSync(this._localStoragePath)) {
            logger.debug('create directory: ' + this._localStoragePath);
            fs.mkdirsSync(this._localStoragePath);
        }
    } catch (err) {
        this._endFail('Can not create direcory for local cache', err, { skipCleanup: true });

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
        this._endFail('Can not create temp directory ' + dirPath, err, { skipCleanup: true });

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
 * Сценарий завершился успешно
 * @param {Object} options
 * @param {Boolean} [options.skipCleanup] не очищать временные файлы
 * @param {Boolean} [options.continueProcess] не завершать процесс
 * @private
 */
Zlo.prototype._endSuccess = function(msg, options) {
    var options = options || {};

    return new Promise(function(resolve, reject) {
        if (options.skipCleanup) return resolve();

        return this._doCleanup()
            .then(resolve)
            .catch(reject)
    }.bind(this))
    .then(function() {
        logger.success(msg);

        if (!options.continueProcess) {
            this._printTime();
            process.exit(1);
        }
    }.bind(this))
    .catch(function(err) {
        logger.error(err);
    });
};

/**
 * Выводим время, затраченное на выполнение программы
 * @private
 */
Zlo.prototype._printTime = function() {
    logger.info('Execution time: ' + process.hrtime(this.start)[0] + ' sec');
};

/**
 * Сценарий закончился ошибкой
 * @param errMsg
 * @param err
 * @param {Object} options
 * @param {Boolean} [options.skipCleanup] не очищать временные файлы
 * @param {Boolean} [options.continueProcess] не завершать процесс
 * @returns {Promise.<TResult>}
 * @private
 */
Zlo.prototype._endFail = function(errMsg, err, options) {
    options = options || {};

    return new Promise(function(resolve, reject) {
        if (options.skipCleanup) return resolve();

        return this._doCleanup()
            .then(resolve)
            .catch(reject)
    }.bind(this))
    .then(function() {
        logger.error(errMsg);
        logger.debug(err);

        if (!options.continueProcess) {
            this._printTime();
            process.exit(1);
        }
    }.bind(this))
    .catch(function(err) {
        logger.error(err);
    });
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
    var svncmd = 'svn ls '+ this._svnData.url + ' --xml';

    logger.debug('Check files ' + this._cacheFileName + ' in svn');

    return this._doCmd(this._svnData.path, svncmd)
        .then(function(data) {
            if (data) {
                var cacheFileName = this._cacheFileName;

                return new Promise(function(resolve, reject) {
                    parseXML(data, function(err, result) {
                        if (err) {
                            reject(err);

                            return;
                        }

                        if (_.some(result.lists.list[0].entry, function(entry) {
                            return cacheFileName == entry.name[0];
                        })) {
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                    });
                });

            } else {
                logger.debug('Files ' + this._cacheFileName + ' not found in svn');

                return false;
            }

        }.bind(this))
        .catch(function(e) {
            logger.error(e);

            return Promise.reject(e);
        });
};

/**
 * Получаем список файлов в кэше
 * @return {Promise}
 */
Zlo.prototype._getSVNCachesList = function() {
    var svncmd = 'svn ls '+ this._svnData.url + ' --xml';

    logger.debug('Get svn cache files list');

    return this._doCmd(this._svnData.path, svncmd)
        .then(function(data) {
            if (data) {
                return new Promise(function(resolve, reject) {
                    parseXML(data, function(err, result) {
                        if (err) {
                            reject(err);

                            return;
                        }
                        resolve(result.lists.list[0].entry.map(function(entryData) {
                            return entryData.name[0];
                        }))
                    });
                });

            } else {
                logger.debug('Files ' + this._cacheFileName + ' not found in svn');

                return [];
            }

        }.bind(this))
        .catch(function(e) {
            logger.error(e);

            return Promise.reject(e);
        });
};


/**
 * Установка зависимостей через packageManager
 * @returns {Promise}
 */
Zlo.prototype._loadFromExternalStorage = function () {
    return packageManager.load(this._endFail);
};


/**
 * Очищает svn-кэш
 * @param {Boolean} removeOnlyCurrent удалять только кэш для текущего md-файла
 * @param {Boolean} skipCurrent не удалять кэш для текущего md-файла
 * @returns {Promise}
 * @private
 */
Zlo.prototype._removeSvnCache = function(options) {
    options = options || { removeOnlyCurrent: false, skipCurrent: false };

    var svn = this._svnData,
        cacheFileName = this._cacheFileName,
        tmpdirName = options.removeOnlyCurrent ? TMP_DIRS.killmd5 :
            options.skipCurrent ? TMP_DIRS.killAllExceptCurrent : TMP_DIRS.killAll;

    return new Promise(function(resolve, reject) {
        if (options.removeOnlyCurrent) {
            this._checkCashesInSVN()
                .then(function(isFilesExists) {
                    if (!isFilesExists) {
                        logger.debug('Dependencies files ' + cacheFileName + ' not in svn cache');

                        return reject('Empty');
                    } else {
                        resolve([cacheFileName])
                    }
                })
                .catch(function(err) {
                    reject(err);
                })
        } else {
            this._getSVNCachesList()
            .then(function(list) {
                if (!list || !list.length) {
                    logger.info('No dependencies files in svn cache');

                    return reject('Empty');
                } else {
                    if (options.skipCurrent) {
                        list = list.filter(function(name, i) {
                            return name !== cacheFileName
                        });
                    }

                    if (!list.length) {
                        logger.info('No dependencies files in svn cache');

                        return reject('Empty');
                    }

                    resolve(list);
                }
            });
        }
    }.bind(this))
        .then(function(list) {
            var filesToRemoveNames = list.map(function(name) {
                   return svn.url + '/' + name
                }),
                cmd = 'svn rm ' + filesToRemoveNames.join(' ') +
                    ' -m "' + this._getCommitMessage('Remove direct cache') + '"';
            logger.info('cmd: ', cmd);
            logger.info('TEST: ', cmd.length);
            return this._doCmd(tmpdirName, cmd);
        }.bind(this))
        .then(function() {
            logger.info('Dependencies removed from svn cache');
        }.bind(this))
        .catch(function(err) {
            logger.error('ERRROR', err)
            this._endFail('Can not remove dependencies from svn cache', err);
        }.bind(this));
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
 * Чистит все содержимое локального кэша
 * @private
 *  @returns {Promise}
 */
Zlo.prototype._removeAllCacheFiles = function(options) {
    options = options || { skipCurrent: false };

    return new Promise(function(resolve, reject) {
        fs.readdir(this._localStoragePath, function(err, files) {
            if (err) {
                reject(err);
            } else {
                if (!files || !files.length) {
                    logger.info('No dependencies files in local cache');
                    resolve();
                } else {
                    this._removeCacheFiles(options.skipCurrent ? files.filter(name => (name !== this._cacheFileName)) : files)
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
 *  @returns {Promise}
 */
Zlo.prototype._archiveDependencies = function() {
    logger.info('Archive dependencies ...');

    var cwd = process.cwd();

    return new Promise(function(resolve, reject) {
        var folderAbsPath = path.resolve(cwd, STORAGE_FOLDER),
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
 * @returns {Promise}
 */
Zlo.prototype._extractDependencies = function(storagePath) {
    var cwd = process.cwd();

    logger.info('Extract dependencies ' + storagePath + ' ...');

    return new Promise(function(resolve, reject) {
        var cacheFilePath = path.resolve(storagePath, this._cacheFileName),
            destFolderPath = path.resolve(cwd, STORAGE_FOLDER);
        
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
 * @param {String} fromPath
 * @param {String} toPath
 * @returns {Promise}
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
 * @returns {Promise}
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
                    logger.info('Local changes has been committed!');

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
 * @returns {Promise}
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
        logger.info('Cleanup has finished');
    });
};

/**
 * Проверяем наличие файла с зависимостями в svn и кладем его туда/завершаем операцию (если файл уже есть)
 * @returns {Promise}
 * @private
 */
Zlo.prototype._tryPutToSvn = function() {
    logger.debug('Trying to put dependencies to svn');
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
            this._endSuccess('Dependencies were successfully loaded');
        }.bind(this))
        .catch(function(err) {
            //не смогли закэшировать - но зависимости так или иначе успешно загрузились
            this._endSuccess('Dependencies were successfully loaded');
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
                logger.info('Dependencies were  successfully retrieved from local storage');

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

/**
 * Чистит все кэши
 * @param target
 * @param options
 * @returns {Promise.<TResult>}
 */
Zlo.prototype.killAll = function (target, options) {
    var currentDir = TMP_DIRS.killAll,
        promisesArray = [];

    options = options || {};

    if (!fs.existsSync(currentDir)) {
        logger.debug('create directory: ' + currentDir);
        fs.mkdirsSync(currentDir);
    }

    target.local && promisesArray.push(this._removeAllCacheFiles());
    target.svn && promisesArray.push(this._removeSvnCache());

    return Promise.all(promisesArray)
        .then(function() {
            return this._endSuccess('Cache cleaned successfully', options)
        }.bind(this))
        .catch(function(err) {
            return this._endFail('Can not clear cache', err, options);
        }.bind(this));

};

/**
 * Чистит все кэши, кроме кэша по текущему package.json
 * @param target
 * @param options
 * @returns {Promise.<TResult>}
 */
Zlo.prototype.killAllExceptCurrent = function(target, options) {
    var currentDir = TMP_DIRS.killAllExceptCurrent,
        promisesArray = [];

    options = options || {};

    if (!fs.existsSync(currentDir)) {
        logger.debug('create directory: ' + currentDir);
        fs.mkdirsSync(currentDir);
    }

    target.local && promisesArray.push(this._removeAllCacheFiles({ skipCurrent: true }));
    target.svn && promisesArray.push(this._removeSvnCache({ skipCurrent: true }));
    
    return Promise.all(promisesArray)
        .then(function() {
            return this._endSuccess('Cache cleaned successfully', options)
        }.bind(this))
        .catch(function(err) {
            return this._endFail('Can not clear cache', err, options);
        }.bind(this));
};

/**
 * Удаляем кэши по md-сумме данного кофига
 */
Zlo.prototype.killMD5 = function(target, options) {
    var promisesArray = [];

    options = options || {};

    fs.mkdirsSync(TMP_DIRS.killmd5);

    target.local && promisesArray.push(this._removeCacheFiles([this._cacheFileName]));
    target.svn && promisesArray.push(this._removeSvnCache({ removeOnlyCurrent: true }));

    return Promise.all(promisesArray)
        .then(function() {
            return this._endSuccess('Dependencies removed from cache', options);
        }.bind(this))
        .catch(function(err) {
            return this._endFail('Can not remove dependencies from cache', err, options);
        }.bind(this));
};

/**
 * Установка зависимостей согласно конфигу package.json
 * @returns {Promise}
 */
Zlo.prototype.loadDependencies = function(options) {
    try  {
        var destFolderPath = path.resolve(process.cwd(), STORAGE_FOLDER);
          
        if (fs.existsSync(destFolderPath)) {
            logger.debug('Remove old dependencies folder ' + destFolderPath);
            fs.removeSync(destFolderPath);
        }
    } catch (err) {
        this._endFail('Can not remove previous version of dependencies in ' + destFolderPath + '. Please, try doing it manually', err);

        return;
    }

    return this._loadFromLocalCache()
        .then(function() {
            logger.success('Dependencies were successfully loaded from local cache');

            return this._onLoadingFinished('local');
        }.bind(this))
        .catch(function(err) {
            logger.warn('Can not load files from local cache');

            return this._loadFromSVNCache()
                .then(function() {
                    logger.success('Dependencies were successfully loaded from svn cache');
                    //если данные загрузились из svn - копируем их в локальный кэш
                    return this._onLoadingFinished('svn');
                }.bind(this))
                .catch(function(err) {
                    logger.warn('Can not load dependencies from svn cache', err);

                    return this._loadFromExternalStorage()
                        .then(function() {
                            logger.success('Dependencies were successfully loaded from npm');

                            return this._onLoadingFinished('npm');
                        }.bind(this))
                        .catch(function(err) {
                            this._endFail('Dependencies loading error', err, options);
                        }.bind(this));
                }.bind(this))
        }.bind(this));

};

