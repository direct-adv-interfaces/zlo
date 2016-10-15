#zlo#

##Описание##
Утилита для кэширования зависимостей
Выкачивает из npm зависимости для модуля, запаковывает результат в архив и кладет архив в svn

`node utils/zlo5 --kill`  - очистка md-файла для данного zlo.json

`node utils/zlo5 --kill-all`  - очистка всего кэша

`node utils/zlo5 --verbose` - запуск zlo с выводом подробных логов

`node utils/zlo5 --dev` - сборка в dev-режиме

`npm test`  - запуск тестов


###Автор###
[heliarian ]<heliarian@yandex-team.ru>

##Как пользоваться и расширять##
В корне директории из которой будет запускаться утилита необходимо создать файлы:
 zlo-config.json - библиотеки/пакеты, которые необходимо скачать

```javascript

    {
         "localCachePath": "local-dependencies",
         "svnCachePath": "svn+ssh://svn.my-svn.ru/dependencies",
         "nodePath": "/opt/nodejs/bin/node",
         "useYarn": false,
         "loadTimeout": 10000
     }

```
localCachePath - папка для хранения локального кэша
svnCachePath - путь к svn-репозиторию в котором хранится кэш
loadTimeout - максимально-допустимое время установки зависимостей по истечению которого установка прекращается
useYarn - использовать Yarn для сборки пакетов (по умолчанию используется npm)
nodePath - путь к node (если используется кастомный)

package.json - файл, по которому npm будет устанавливать зависимости
