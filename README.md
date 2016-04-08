#zlo#

##Описание##
Утилита для кэширования зависимостей
Выкачивает из npm зависимости для модуля, запаковывает результат в архив и кладет архив в svn

`node utils/zlo --kill`  - очистка md-файла для данного zlo.json

`node utils/zlo --kill-all`  - очистка всего кэша

`node utils/zlo --verbose` - запуск zlo с выводом подробных логов

`node utils/zlo --dev` - сборка в dev-режиме


###Автор###
[heliarian ]<heliarian@yandex-team.ru>

##Как пользоваться и расширять##
В корне директории из которой будет запускаться утилита необходимо создать файлы:
 zlo-config.json - библиотеки/пакеты, которые необходимо скачать

```javascript

    {
         "localCachePath": "local-dependencies",
         "svnCachePath": "svn+ssh://svn.my-svn.ru/dependencies"
         "loadingTimeout": 10000
     }

```
localCachePath - папка для хранения локального кэша
svnCachePath - путь к svn-репозиторию в котором хранится кэш
loadingTimeout - максимально-допустимое время установки зависимостей по истечению которого установка прекращается

package.json - файл, по которому npm будет устанавливать зависимости
