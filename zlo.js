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
        console.error(clc.red('Empty local storage path'));
        process.exit(0);

        return;
    }

    if (!configJSON.dependencies || !configJSON.dependencies.length) {
        console.error(clc.red('Empty dependencies'));

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


Zlo.prototype._getCacheFileName = function (index) {
    return this._cacheFileNames[index];
};

Zlo.prototype._doCmd = function (path, svncmd, callback) {
    console.log(clc.yellow.italic(svncmd));
    var cwd = process.cwd();

    process.chdir(path);

    exec(svncmd, function (err, data) {
        process.chdir(cwd);
        callback(err, data);
    });
};

/**
 * Проверяем есть ли нужные кэши в svn
 * @param callback
 */
Zlo.prototype.checkCashesInSVN = function(callback) {
    var self = this,
        svncmd = 'svn ls '+ this._svnData.url;



    this._doCmd(self._svnData.path, svncmd, function (err, data) {
        if (err) {
            console.log(clc.red('svn ls - error'));
            callback(err);

            return;
        }

        if (_.every(self._cacheFileNames, function (name) {
                var regexp = new RegExp('(^|\\s)(' + name + ')($|\\s)'),
                    res = data.match(regexp);

                res && res[0] & console.log(clc.yellow('Found: '+ res && res[0]));

                return res && res[0];
            })) {
            console.log(clc.green('Files ' + self._cacheFileNames + ' found in svn'));
            callback(null, true);
        } else {
            console.log(clc.yellow('Files ' + self._cacheFileNames + ' not found in svn'));
            callback(null, false);
        }
    });
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
Zlo.prototype.loadFromNet = function () {
    var self = this;

    console.log(clc.green('Load dependencies via bower and npm'));

    console.log('npm install');

    return new Promise(function(resolve, reject) {
        exec('npm install', function(err, stdout) {
            if (err) {
                console.error(err);
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
                    console.error(err);
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

    self.checkCashesInSVN(function (err, isFilesExists) {
        var cmd = 'svn rm ' + self._cacheFileNames.map(function (name) { return svn.url + '/' + name; }).join(' ') +
            ' -m "zlo: remove caches"';

        if (isFilesExists) {
            self._doCmd('_kill-md5-dir_', cmd, function(err, data) {
                if (err) {
                    console.log(err);
                } else {
                    console.log(data);
                    console.log(clc.green('Files ' + self._cacheFileNames + ' removed from svn'));
                    fs.removeSync('_kill-md5-dir_');
                }
            });
        } else {
            fs.removeSync('_kill-md5-dir_');
        }
    });



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

    self._doCmd(currentDir, 'svn checkout --depth immediates ' + svn.url + ' ' + currentDir, function(err, stout) {
        if (err) {
            console.log(err);

            process.exit(0);
        }

        self._doCmd(currentDir, 'svn ls', function (res, stout) {
            console.log(stout);

            if (!stout) {
                console.log(clc.green.bold('SVN cache is already empty'));
            } else {
                self._doCmd(currentDir, 'svn rm *', function(err, stout) {

                    if (err) {
                        console.error(err);
                    } else {
                        console.log(stout);
                        self._doCmd(currentDir, 'svn commit -m "zlo: remove all direct cache"', function(err, stout) {
                            if (err) {
                                console.error(err);
                                process.exit(0);
                            }
                            console.log('local changes has been committed!');
                            console.log(clc.green.bold('SVN cache is  empty'));
                            fs.removeSync(currentDir);
                        });
                    }
                });
            }

        });

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
 * @param callback
 * @private
 */
Zlo.prototype._checkoutSVN = function(depth, files, callback) {
    var self = this;

    files = files || [];

    this._doCmd(self._svnData.path, 'svn checkout ' + this._svnData.url + ' . --depth ' + depth, function(err, data) {
        if (err) {
            console.error(err);
            callback(err, data);
        } else {
            if (files.length) {
                console.log(clc.green('Retrive files from svn'));
                self._doCmd(self._svnData.path, 'svn up ' + files.join(' '), function(err, data) {
                    if (err) {
                        console.error(err);
                        console.log(clc.red('Can not retrive files from SVN'));
                        callback(err, data);
                    } else {
                        console.log(clc.green('Files successfully retrives'));
                        callback(null, data);
                    }

                });

            } else {
                console.log(data);
                callback(err, data);
            }
        }
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
                        console.log(err);
                        console.log(clc.red('Can not archive folder ' + archiveAbsPath));
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
                console.log(clc.red.bold('Can not archive folders'));
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
Zlo.prototype.extractDependencies = function(storagePath) {
    var self = this,
        cwd = process.cwd();


    console.log(clc.green.bold('extractDependencies - starts, path = ' + storagePath));

    return new Promise(function(resolve, reject) {
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
                        console.log(err);
                        console.log(clc.red('error extract dependencies ' + destFolderPath));
                        reject(err)
                    })
            })
        });

        Promise.all(promisesArray).then(
            function() {
                console.log(clc.green.bold('extract dependencies: finish all'));
                resolve();
            },
            function (err) {
                console.log(clc.red.bold('error extract dependencies'));
                console.log(err);
                reject(err);
            }
        );
    });

};

/**
 * Копирование объекта из одной директории в другую
 * @param fromPath
 * @param toPath
 */
Zlo.prototype.copyArchives = function (fromPath, toPath) {
    var self = this;

    return Promise.all(self._cacheFileNames.map(function (cacheName) {
        var startParh = path.resolve(fromPath, cacheName),
            endParh = path.resolve(toPath, cacheName);

        console.log('copy ' + startParh + ' --> ' + endParh);

        return new Promise(function(resolve, reject) {
            fs.copy(startParh, endParh, function (err) {
                if (err) {
                    console.log(clc.red('error copy ' + startParh + ' --> ' + endParh));
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
Zlo.prototype.putToSvn = function() {
    var self = this;

    console.log(clc.green('Put to svn'));

    return new Promise(function(resolve, reject) {
        if (!self._svnData) {
            console.log(clc.yellow('SVN url not defined'));

            reject();

            return;
        }

        //проверяем есть ли уже файлы в репозитории
        self.checkCashesInSVN(function (err, isFilesExists) {
            if (err) {
                reject();

                return;
            }

            if (isFilesExists) {
                console.log(clc.green('Files already in SVN'));

                resolve();

                return;
            }

            self._checkoutSVN('empty', [], function (err) {
                if (err) {
                    reject();

                    return;
                }


                self.copyArchives(self._localStoragePath, self._svnData.path).then(
                    function () {
                        console.log(clc.green('Archives successfully copy to ' + self._svnData.path));

                        self._doCmd(self._svnData.path, 'svn add ' + self._cacheFileNames.join(' '), function(err, data) {
                            if (err) {
                                console.error(err);
                                reject();
                                return;
                            }
                            console.log(clc.green('all local changes has been added for commit'));

                            self._doCmd(self._svnData.path, 'svn commit -m "zlo: add direct cache"', function(err, data) {
                                if (err) {
                                    console.error(err);
                                    reject();

                                    return;
                                }
                                resolve();
                                console.log(clc.green('local changes has been committed!'));
                            });
                        });
                    }
                );
            });

        });

    });
};

/**
 * Удаляем ненужные конфиги и временные файлы
 */
Zlo.prototype.doCleanup = function() {
    var cwd = process.cwd();

    console.log(clc.green('Remove tmp files and folders'));

    fs.remove(this._svnData.path);

    fs.remove(path.resolve(cwd, '.bowerrc'), function(err) {
        if (err) console.error(err);
    });
    fs.remove(path.resolve(cwd, NPM_CONFIG_NAME), function(err) {
        if (err) console.error(err);
    });
    fs.remove(path.resolve(cwd, BOWER_CONFIG_NAME), function(err) {
        if (err) console.error(err);
    });
};

/**
 * Действия, выполняемые после успешной загрузки зависимостей
 */
Zlo.prototype.onLoadSuccess = function() {
    var self = this;
    console.log('---------------------onLoadSuccess');
    if (this._postinstall && this._postinstall.length > 0) {
        console.log(clc.green('Doing postinstall'));
        Promise.all(this._postinstall.map(function(postinstall) {
            return new Promise(function(resolve, reject) {
                console.log('posintall: ' + postinstall.command);
                exec(postinstall.command, function(err, stdout) {
                    if (err) {
                        console.log(err);
                        reject();
                        self.doCleanup();
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
                console.log(clc.red('postinstall error'));
            }
        )
    } else {
        this.doCleanup();
    }
};

Zlo.prototype.tryPutToSvn = function() {
    var self = this;

    return this.putToSvn().then(
        function () {
            console.log(clc.green.bold('Dependencies committed to SVN cache'));
            self.onLoadSuccess();
        },
        function (err) {
            console.log(clc.err.bold('Error: dependencies not committed to SVN cache'));
            //не смогли положить в svn - но почистить за собой нужно
            self.onLoadSuccess();
        }
    );
};

/**
 * Установка зависимостей согласно конфигу zlo.json
 */
Zlo.prototype.loadDependencies = function() {
    var self = this;

    return self.loadFromLocalCache().then(
        function() {
            return self.tryPutToSvn();
        },
        function (err) {
            return self.loadFromSVNCache().then(
                function () {
                    console.log('loadFromSVNCache');
                    //если данные загрузились из svn - копируем их в локальный кэш
                    return self.copyArchives(self._svnData.path, self._localStoragePath)
                        .then(
                            function () {
                                self.onLoadSuccess();
                            },
                            function(err) {
                                console.log(err);
                            }
                        );
                },
                function (err) {
                    return self.loadFromNet().then(
                        function() {
                            return self.archiveDependencies().then(
                                function() { console.log(clc.green('Dependencies successfuly archived')); },
                                function(err) { console.log(clc.red('Can not archive dependencies')); }
                            );
                        },
                        function (err) {
                            console.log(clc.red('Can not load dependencies!!!'));

                            process.exit(0);
                        }
                    ).then(function() {
                        return self.tryPutToSvn();
                    }).catch(function() {
                        console.log(err);
                    });
                }
            );
        }
    );
};

/**
 * Пытаемся загрузить зависимости из локального кэша
 * @returns {Promise}
 */

Zlo.prototype.loadFromLocalCache = function() {
    var self = this;

    console.log(clc.green.bold('Load from local cache'));

    if (!self._localStoragePath) {
        console.log(clc.yellow('Can not load from local cache. Cache path not defined'));

        return Promise.reject('Can not load from local cache. Cache path not defined');
    }

    if (_.every(self._cacheFileNames, function (name) {
            var filePath = path.resolve(self._localStoragePath, name);

            console.log(filePath + ' exists: ' + fs.existsSync(filePath));

            return fs.existsSync(filePath);
        })) {
        console.log(clc.green('Files ' + self._cacheFileNames + ' found in local storage'));

        return self.extractDependencies(self._localStoragePath).then(
            function () {
                console.log(clc.green.bold('Dependencies succesfully retrive from local strorafe'));

                return Promise.resolve();
            },
            function (err) {
                console.log(clc.yellow('Can not load files from local strorafe'));

                return Promise.reject();
            }
        );
    } else {
        console.log(clc.yellow('Files ' + self._cacheFileNames + ' not exists in local storage'));

        return Promise.reject('Files ' + self._cacheFileNames + ' not exists in local storage');
    }

};

/**
 * Пытаемся загрузить зависимости из svn
 * @returns {Promise}
 */
Zlo.prototype.loadFromSVNCache = function() {
    var self = this;

    console.log(clc.green.bold('Load from svn cache'));
    //svn у нас уже счекаучен в режиме --depth empty

    if (!self._svnData) {
        console.log(clc.yellow('SVN cache not defined'));

        return Promise.reject('SVN cache not defined');
    }

    return new Promise(function (resolve, reject) {
        //проверяем есть ли уже файлы в репозитории
        self.checkCashesInSVN(function (err, isFilesExists) {
            if (err || !isFilesExists) {
                //если файлов нет - то и забирать нечего, будем пробовать другие варианты
                console.log(clc.yellow('Can not load files from SVN'));
                reject();

                return;
            }

            console.log('Retrive files from SVN');

            self._checkoutSVN('empty', self._cacheFileNames, function (err) {
                if (err) {
                    reject();

                    return;
                }

                //проверяем что файлы дейсвительно успешно загрузились c удаленного репозитория
                if (_.every(self._cacheFileNames, function (name) {
                        return fs.existsSync(path.resolve(self._svnData.path, name));
                    })) {
                    self.extractDependencies(self._svnData.path).then(
                        function() {
                            console.log(clc.green.bold('Dependencies succesfully retrive from SVN'));
                            resolve();
                        },
                        function (err) {
                            console.log(clc.yellow('Can not load files from SVN'));
                            reject(err);
                        }
                    );
                } else {
                    console.log(clc.yellow('Can not load files from SVN'));
                    reject();
                }

            });

        });
    });

};
