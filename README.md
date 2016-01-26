#zlo#

##Описание##
Утилита для кэширования зависимостей
Скачивает зависимости для модуля, запаковывает результат в архив и кладет архив в svn

`node utils/zlo --kill`  - очистка md-файла для данного zlo.json
`node utils/zlo --kill-all`  - очистка всего кэша
`node utils/zlo --create-config`  - создание конфигурационных файлов bower.json и package.json


###Автор###
[heliarian ](https://staff.yandex-team.ru/heliarian )

##Как пользоваться и расширять##
В корне директории из которой будет запускаться утилита необходимо создать файлы:
 zlo.json - библиотеки/пакеты, которые необходимо скачать

```javascript

    {
         "storage": {
             "local": "./bem-local-libs/",
             "svn": "svn+ssh://svn.yandex.ru/direct-bem-local-libs"
         },
         "resolutions": {
             "bem-bl": "2.5.1",
             "romochka": "~2.10.27"
         },
         "dependencies": [
             {
                 "name": "yaspeller",
                 "version": "2.4.0"
             },
             {
                 "type": "git",
                 "dest": "libs",
                 "name": "bem-history",
                 "repo": "git://github.com/bem/bem-history.git",
                 "commit": "0660e7db23a4719b7e43dc6fccce43d9b267031c"
             }
         ]
     }

```
storage.local - папка для хранения локального кэша
storage.svn - папка с svn-репозиторием в котором хранится кэш
dependencies - зависимости
Зависимости с type: git/svn подкачиваются bower'ом
resolutions - рекомендации для bower'а по разрешению зависимостей


##Roadmap & known issues##
Если скрипт молча падает и при этом не отрабатывает bower (не подкачиваются bower_components)
попробуйте запустить `node utils/zlo --create-config; bower install` - возможно в вашем конфиге есть зависимости, которые
bower не может разрешить автоматически. Такие зависимости нужно занести в resolutions в  zlo.json



##Пример##
Вызов из командной строки
`node utils/zlo`
