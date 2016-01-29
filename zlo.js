'use strict';

var NPM_CONFIG_NAME = 'package.json',
    BOWER_CONFIG_NAME = 'bower.json',

    NPM_STORAGE = 'node_modules',
    BOWER_STORAGE = 'libs',
    STORAGES = [NPM_STORAGE, BOWER_STORAGE],

    md5 = require('md5'),
    Promise = require('promise'),
    tar = require('tar-fs'),
    fs = require('fs-extra'),
    exec = require('child_process').exec,
    path = require('path'),
    SvnClient = require('svn-spawn'),
    clc = require('cli-color');

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
    console.log('create zlo: ' + JSON.stringify(configJSON));

    var mdHash = md5(JSON.stringify(configJSON)),
        cacheFileName = mdHash + '.tar';

    //временная папка в которой производим все действия с кэшом
    this._tmpFolder = '_tmp-zlo_';

    this._createClearFolder(this._tmpFolder);

    this._postinstall = [];

    if (!configJSON.dependencies) {
        errorLog('Empty dependencies');
        process.exit(0);
    }

    if (!configJSON.storage) {
        errorLog('Empty srorage');
        process.exit(0);
    }

    this.cacheFileName = cacheFileName;


    if (!configJSON.storage.svn) {
        warnLog('Empty svn url');
    } else {
        this.svn = {
            client:new SvnClient({
                cwd: this._tmpFolder
            }),
            url: configJSON.storage.svn,
            isOutOfDate: true
        };

        successLog('init svn client on folder ' + this._tmpFolder);
    }

    if (!configJSON.storage || !configJSON.storage.local) {
        warnLog('Empty local storage path');
    } else {
        this.local = {
            path: configJSON.storage.local,
            isOutOfDate: true
        };
        successLog('Init local storage: ' + configJSON.storage.local);
    }

    if (!configJSON.storage || !configJSON.storage.remote) {
        warnLog('Empty remote storage path');
    } else {
        this.remote = {
            path: configJSON.storage.remote
        };
        successLog('Init local storage: ' + configJSON.storage.remote);
    }

    this.dependencies = configJSON.dependencies;

    this.createConfigs();
}

/**
 * Архивирование папок libs и node_modules
 * @returns {Promise}
 */
Zlo.prototype.archiveDependencies = function() {
    var archivePath = this._getTMPCacheFilePath();

    console.log('creatign archive ' + archivePath);

    return new Promise(function(resolve, reject) {
        var copyPromisesArray = STORAGES.map(function(name) {
            return new Promise(function(resolve, reject) {
                console.log('copy ' + name + ' -> ' + '_zlo_tmp_arc/' + name);
                tar.pack(name).pipe(tar.extract('_zlo_tmp_arc/' + name))
                    .on('finish', function() {
                        resolve();
                    })
                    .on('error', function(er) {
                        reject(err);
                    })
            })
        });
        Promise.all(copyPromisesArray).then(
            function() {
                tar.pack('_zlo_tmp_arc').pipe(fs.createWriteStream(archivePath))
                    .on('error', function(err) {
                        console.log(err);
                        errorLog('Archive error');
                    })
                    .on('finish', function() {
                        successLog('Archived: ' + archivePath);
                        fs.remove('_zlo_tmp_arc');
                        resolve()
                    })
            },
            function(err) {
                errorLog('Error copy folders');
                console.log(err);
                reject();
            }
        );
    })
};


function errorLog(msg) {
    console.log(clc.red(msg));
}

function successLog(msg) {
    console.log(clc.green(msg));
}

function createLog(msg) {
    console.log(clc.blue(msg));
}

function removeLog(msg) {
    console.log(clc.blue.bgWhite(msg));
}

function warnLog(msg) {
    console.log(clc.yellow(msg));
}

Zlo.prototype._createClearFolder = function(name) {
    var absPath = path.resolve(process.cwd(), name);

    if (fs.existsSync(absPath)) {
        removeLog('remove folder ' + absPath);
        fs.removeSync(absPath);
    }

    createLog('create folder ' + absPath);

    fs.mkdirsSync(absPath);
};

/**
 * Сreate bower config - .bowerrc
 */
Zlo.prototype.createBowerRC = function() {
    var cwd = process.cwd(),
        bowerRCPath = path.resolve(cwd, '.bowerrc'),
        bowerrc = {
            directory: BOWER_STORAGE
        };

    createLog('create ' + bowerRCPath + ': ' + JSON.stringify(bowerrc));
    fs.writeJson(bowerRCPath, bowerrc);
};

/**
 * Создаем json-файлы для работы bower и npm
 */
Zlo.prototype.createConfigs = function() {
    var self = this,
        cwd = process.cwd(),
        bowerJSON = { dependencies: {}, name: 'zlo' },
        npmJSON = { dependencies: {} };

    this.dependencies.forEach(function(dep) {
        if (dep.type == 'git' || dep.type == 'svn') {
            bowerJSON.dependencies[dep.name] = dep.repo + '#' + dep.commit;
            if (dep.postinstall) {
                self._postinstall.push({ path: path.join(BOWER_STORAGE, dep.name), command: dep.postinstall });
            }
        } else {
            npmJSON.dependencies[dep.name] = dep.version;
            if (dep.postinstall) {
                self._postinstall.push({ path: path.join(NPM_STORAGE, dep.name), command: dep.postinstall });
            }
        }
    });

    //bowerJSON.resolutions = config.json.resolutions;

    this.createBowerRC();
    var npmPath = path.resolve(cwd, NPM_CONFIG_NAME),
        bowerPath = path.resolve(cwd, BOWER_CONFIG_NAME);


    createLog('create package.json for npm: ' + npmPath + ', ' + JSON.stringify(npmJSON));
    fs.writeJson(npmPath, npmJSON);

    createLog('create bower.json for bower: ' + bowerPath + ', ' + JSON.stringify(bowerJSON));
    fs.writeJson(bowerPath, bowerJSON);
};


/**
 * Установка зависимостей через bower и npm
 * @returns {*}
 */
Zlo.prototype.loadFromNet = function () {
    var self = this;

    successLog('Start load external dependencies');

    console.log('npm install');

    exec('npm install', function(err, stdout) {
        if (err) {
            console.error(err);
            process.exit(0);
        }
        console.log(stdout);
        successLog('npm install finished');

        var bowerPath = path.resolve(__dirname, 'node_modules/bower/bin/bower');

        console.log(bowerPath + ' install');
        exec(bowerPath + ' install', function(err, stdout) {
            if (err) {
                console.error(err);
                process.exit(0);
            }
            console.log(stdout);
            successLog('bower install finished');
            self.onLoadSuccess('external');
        });
    });
};

Zlo.prototype.killMD5 = function() {
    var client = this.svn && this.svn.client,
        localCacheFilePath = this.local && path.resolve(process.cwd(), this.local.path, this.cacheFileName);

    if (this.svn) {
        console.log('Clear current cache from svn');

        client.del([this.svn.url + '/' + this.cacheFileName, '-m', '"zlo: remove direct cache"'], function(err, data) {
            if (err) {
                console.log(err);
            } else {
                console.log(data);
                successLog('Svn cache cleared');
            }
        });
    }

    if (this.local) {
        console.log('Clear local cache ' + localCacheFilePath);
        fs.remove(localCacheFilePath, function(err) {
            if (err) {
                console.log(err);
            } else {
                successLog('Success remove ' + localCacheFilePath);
            }
        });
    }
};

Zlo.prototype._checkoutSVN = function(depth, callback) {
    var client = this.svn && this.svn.client;

    console.log('svn checkout: ' + this.svn.url);
    client.checkout([this.svn.url, '.', '--depth', depth], function(err, data) {
        if (err) {
            console.error(err);
            callback(err, data);
        } else {
            callback(err, data);
        }
    });
};

Zlo.prototype.killAll = function () {
    var self = this,
        cwd = process.cwd(),
        localCachePath = this.local && path.resolve(cwd, this.local.path);

    if (this.svn) {
        console.log('Clear svn cache');
        this._checkoutSVN(
            'immediates',
            function(err) {
                if (err) {
                    console.log(err);
                } else {
                    process.chdir(path.resolve(cwd, self._tmpFolder));
                    //client.del не работает корректно с аргументом *
                    exec('svn rm *', function(err, stout) {
                        if (err) {
                            console.error(err);
                        } else {
                            exec('svn commit -m "zlo: remove all direct cache"', function(err, stout) {
                                if (err) {
                                    console.error(err);
                                } else {
                                    console.log(stout);
                                    console.log('local changes has been committed!');

                                }
                            });
                        }
                    });
                }
            }
        );
    }

    if (this.local) {
        console.log('remove local cache');
        fs.remove(localCachePath, function(err) {
            if (err) {
                console.log(err);
            } else {
                successLog(localCachePath + ' removed');
            }
        });
    }

};

/**
 * Записываем свежесозданный архив в svn
 */
Zlo.prototype.putToSvn = function() {
    var self = this,
        client = this.svn.client;

    return new Promise(function(resolve, reject) {
        if (fs.existsSync(self._getTMPCacheFilePath())) {

            client.add(self.cacheFileName, function(err, data) {
                if (err) {
                    console.log(err);
                    //если файл уже в svn - то это штатное поведение и продолжаем работать
                    resolve();
                } else {
                    client.commit(['zlo: add cache file ', self.cacheFileName], function(err, data) {
                        if (err) {
                            console.error(err);
                            reject(err);
                        } else {
                            console.log(data);
                            console.log(self.cacheFileName + ' has been committed!');
                            resolve();
                        }
                    });
                }
            });
        } else {
            reject('error: nothing to commit')
        }
    });
};

/**
 * Чистим за собой
 */
Zlo.prototype.cleanUp = function() {
    var cwd = process.cwd();

    console.log('Start cleanup');

    var bowerRCPath = path.resolve(cwd, '.bowerrc'),
        npmConfigPath = path.resolve(cwd, NPM_CONFIG_NAME),
        bowerConfigPath = path.resolve(cwd, BOWER_CONFIG_NAME);


    [bowerRCPath, npmConfigPath, bowerConfigPath].map(function(filePath) {
        removeLog('remove ' + filePath);
        fs.remove(filePath, function(err) {
            if (!err) {
                successLog(filePath + ' removed');
            } else {
                console.log(err);
            }
        });
    });
};

/**
 * Выполняем postinstall если необходимо
 */
Zlo.prototype.donePostinstall = function() {
    var self = this;

    if (this._postinstall && this._postinstall.length > 0) {
        Promise.all(this._postinstall.map(function(postinstall) {
            return new Promise(function(resolve, reject) {
                process.chdir(postinstall.path);
                console.log('posintall: path = ' +postinstall.path + ', cmd ='  + postinstall.command);
                exec(postinstall.command, function(err, stdout) {
                    if (err) {
                        reject(err);
                    } else {
                        console.log(stdout);
                        resolve(stdout);
                    }
                });
            });
        })).then(
            function() {
                successLog('postinstall done');
                self.cleanUp();
            },
            function(err) {
                console.log(err);
                errorLog('can not done postinstall');
                self.cleanUp();
            }
        );
    } else {
        this.cleanUp();
    }
};

Zlo.prototype.updateCacheFiles = function() {
    var promisesArray = [],
        self = this,
        cwd = process.cwd();

    successLog('update cache files');

    if (this.svn && this.svn.isOutOfDate) {
        successLog('update cache files in svn');
        promisesArray.push(this.putToSvn());
    }

    if (this.local && this.local.isOutOfDate) {
        successLog('update cache files in local storage');
        promisesArray.push(function() {
            return new Promise(function(resolve, reject) {
                var cacheFilePath = self._getTMPCacheFilePath(),
                    localCacheFilePath = path.resolve(cwd, self.local.path, self.cacheFileName);

                console.log('Сopy ' + cacheFilePath +  ' --> ' + localCacheFilePath);
                fs.copy(cacheFilePath, localCacheFilePath, function(err) {
                    if (err) {
                        console.log(err);
                        errorLog('Can not copy ' + cacheFilePath +  ' --> ' + localCacheFilePath);
                        reject();
                    } else {
                        successLog('Success copy ' + cacheFilePath +  ' --> ' + localCacheFilePath);
                        resolve();
                    }
                })
            });
        }());
    }

    return Promise.all(promisesArray);
};

Zlo.prototype.onLoadSuccess = function(source) {
    successLog('Load from ' + source + ' success');

    var cwd = process.cwd(),
        self = this;

    var cacheFilePath = this._getTMPCacheFilePath();

    if (this.svn && this.svn.isOutOfDate || this.local && this.local.isOutOfDate) {

        if (fs.existsSync(cacheFilePath)) {
            successLog('Archive file ' + cacheFilePath + ' exists');
            self.updateCacheFiles().then(
                function() {
                    self.donePostinstall();
                },
                function(err) {
                    console.log(err);
                    errorLog('Can not update cache files');
                }
            );
        } else {
            warnLog('Archive file ' + cacheFilePath + ' not found');
            this.archiveDependencies().then(
                function() {
                    self.updateCacheFiles().then(
                        function() {
                            self.donePostinstall();
                        },
                        function(err) {
                            console.log(err);
                            errorLog('Can not update cache files')
                        }
                    );
                },
                function(err) {
                    console.log(err);
                    errorLog('Can not create archive file');
                }
            );
        }
    }
};

Zlo.prototype.extractDependencies = function(archiveFilePath) {
    return new Promise(function(resolve, reject) {
        fs.createReadStream(archiveFilePath).pipe(tar.extract(process.cwd()))
            .on('finish', function() {
                successLog('finish extracting ' + archiveFilePath);
                resolve();
            })
            .on('error', function(err) {
                errorLog(err);
                reject(err);
            });
    });
};

/**
 * Загрузка из удаленного кэша
 */
Zlo.prototype.loadFromRemoteCache = function() {
    var self = this;

    successLog('Start loading dependencies from remote cache');

    if (this.remote && this.remote.path) {
        var cacheFilePath = path.resolve(this.remote.path, this.cacheFileName);

        if (fs.existsSync(cacheFilePath)) {
            successLog('file ' + cacheFilePath + ' found in remote cache');
            this.extractDependencies(cacheFilePath).then(
                function() {
                    successLog('loadFromRemoteCache - success!');
                    self.onLoadSuccess('remote');
                },
                function(err) {
                    errorLog('Can not extract dependencies from remote cache');
                    console.error(err);
                    self.loadFromSVN();
                }
            )
        } else {
            self.loadFromSVN();
            warnLog('Cache file ' + cacheFilePath + ' in remote cache not exists');
        }
    } else {
        warnLog('Path to remote cache not defined');
        this.loadFromSVN();
    }
};

Zlo.prototype._getTMPCacheFilePath = function() {
    return path.resolve(process.cwd(), this._tmpFolder, this.cacheFileName);
};


Zlo.prototype._checkoutCacheFile = function(callback) {
    var self = this;

    this._checkoutSVN(
        'empty',
        function(err, data) {
            if (err) {
                console.log(err);
                callback('Can not checkout svn');
            } else {
                console.log(data);
                self.svn.client.update([self.cacheFileName], function(err, data) {
                    if (err) {
                        console.error(err);
                    } else {
                        callback(null, data);

                    }
                });
            }

        }
    );
};

Zlo.prototype.loadFromSVN = function() {
    var self = this,
        cwd = process.cwd(),
        svnCacheFilePath = this._getTMPCacheFilePath();

    successLog('Start loading dependencies from svn');

    if (!this.svn) {
        warnLog('Path to svn not defined');
        this.loadFromNet();
    } else {
        if (fs.existsSync(svnCacheFilePath)) {
            self.extractDependencies(svnCacheFilePath).then(
                function() {
                    self.svn.isOutOfDate = false;

                    successLog('Load dependencies from svn - success!');
                    self.onLoadSuccess('svn');
                },
                function(err) {
                    errorLog('Can not extract archive from ' + self.cacheFileName);
                    console.error(err);
                    self.loadFromNet();
                }
            );
        } else {
            warnLog('File ' + self.cacheFileName + ' not exist in svn');
            //идем за данными  в сеть
            self.loadFromNet();
        }
    }
};

/**
 * Загрузка из локального кэша
 */
Zlo.prototype.loadFromLocalCache = function() {
    var self = this;

    successLog('Start loading dependencies from local cache');

    if (this.local && this.local.path) {
        var cacheFilePath = path.resolve(this.local.path, this.cacheFileName);

        if (fs.existsSync(cacheFilePath)) {
            successLog('file ' + cacheFilePath + ' found in local cache');
            this.extractDependencies(cacheFilePath).then(
                function() {
                    self.local.isOutOfDate = false;

                    successLog('loadFromLocalCache - success!');
                    self.onLoadSuccess('local');
                },
                function(err) {
                    errorLog('Can not extract dependencies from local cache');
                    console.error(err);
                    self.loadFromRemoteCache();
                }
            )
        } else {
            this.loadFromRemoteCache();
            warnLog('Cache file ' + cacheFilePath + ' not exists');
        }
    } else {
        warnLog('Path to local cache not defined');
        this.loadFromRemoteCache();
    }
};

/**
 * Заргрузка зависимостей всеми доступными способами
 */
Zlo.prototype.loadDependencies = function() {
    var self = this;

    this._checkoutCacheFile(function(err) {
        if (err) { console.log(err); }
        self.loadFromLocalCache();
    });

};
