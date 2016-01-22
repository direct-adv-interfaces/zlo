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
}

/**
 * Сreate bower config - .bowerrc
 */
Zlo.prototype.createBowerRC = function() {
    var cwd = process.cwd(),
        config = this.config,
        bowerrc = {
            directory: BOWER_STORAGE,
            postinstall: config.json.postinstall
        };

    fs.writeJson(path.resolve(cwd, '.bowerrc'), bowerrc);
};

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
    client.del([config.svn + '/' + config.cacheFileName, '-m zlo: remove direct cache'], function(err, data) {
        if (err) {
            console.log(error);
        } else {
            console.log(data);
        }
    });

    fs.removeSync(config.cacheDirectory);

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

Zlo.prototype.createArchiveFolder = function(tmpPath) {
    var promises = [],
        cwd = process.cwd();

    console.log('--- create folder for archive --- ');

    //убеждаемся что искомая папка есть, если надо - чистим ее
    fs.emptydirSync(tmpPath);

    try {
        [NPM_STORAGE, BOWER_STORAGE].forEach(function(name) {
            promises.push(new Promise(function(resolve, reject) {
                var filePath = path.resolve(cwd, name),
                    toPath = path.resolve(tmpPath, name);

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
        console.error('archiveDependencies: file copy error ' + e);
    }

    return promises;

};

/**
 * Архивирование зависимостей
 */
Zlo.prototype.archiveDependencies = function() {
    var config = this.config,
        tmpPath = 'archive-' + config.mdHash,
        self = this,
        promises = this.createArchiveFolder(tmpPath);

    Promise.all(promises).then(function() {
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
    });
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

    this._checkoutSVN(
        'empty',
        function(err, data) {
            if (err) {
                if (err) {
                    console.error(err);
                }
                if (fs.existsSync(config.cachePath)) {
                    console.log('----EXTRACT FROM SVN CACHE----');
                    self.extractDependencies();
                } else {
                    //идем за данными  в сеть
                    self.loadFromNet();
                }
            } else {
                self.svnClient.update([config.cacheFileName], function(err, data) {
                    if (err) {
                        console.error(err);
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

        }
    );
};
