# zlo

## Описание
Утилита для кэширования зависимостей
Выкачивает из npm зависимости для модуля, запаковывает результат в архив и кладет архив в svn

`node zlo --kill --target=['svn'|'local']`  - очистка md-файла для данного zlo.json

`node zlo --kill-all --target=['svn'|'local']`  - очистка всего кэша

`node zlo --kill-all-except-current --target=['svn'|'local']`  - очистка всего кэша кроме текущего

`node zlo --verbose` - запуск zlo с выводом подробных логов

`node zlo --dev` - сборка в dev-режиме

`node zlo --disable-svn` - сборка без кэширования в svn

`npm test`  - запуск тестов


### Автор
[heliarian ]<heliarian@gmail.com>

## Как пользоваться и расширять
В корне директории из которой будет запускаться утилита необходимо создать файлы:
 zlo-config.json - библиотеки/пакеты, которые необходимо скачать

```javascript

    {
         "localCachePath": "local-dependencies",
         "svnCachePath": "svn+ssh://svn.my-svn.ru/dependencies",
         "useYarn": false,
         "loadTimeout": 10000,
         "beforeLoad": {
             "killAllExceptCurrent": {
                "target": {
                   "local": true
                }
             }
         }
     }

```

### Параметры

#### `localCachePath `
папка для хранения локального кэша
#### `svnCachePath`
путь к svn-репозиторию в котором хранится кэш
#### `loadTimeout`
максимально-допустимое время установки зависимостей по истечению которого установка прекращается
#### `useYarn`
использовать Yarn для сборки пакетов (по умолчанию используется npm)
#### `beforeLoad`
действие, которое нужно выполнить перед загрузкой зависимостей
принимает параметры:

Удалить все зависимости кроме текущей во всех кэшах

```javascript
    "killAllExceptCurrent": true
```

Удалить все зависимости кроме текущей в локальном кэше

```javascript
    "killAllExceptCurrent": {
        "target": {
           "local": true
        }
    }
```

Удалить все зависимости кроме текущей в svn

```javascript
    "killAllExceptCurrent": {
        "target": {
           "svn": true
        }
    }
```

Аналогично: удалить все зависимости во всех кэшах (включая текущую, если она существует)

```javascript
    "killAll": true
```
`killAll`  может принимать значения аналогично `killAllExceptCurrent`

package.json - файл, по которому npm будет устанавливать зависимости

## Сборка и обновление
Чтобы собрать deb-пакет с новой версией, нужно:
1. Обновить версию пакета (`npm version minor`)
2. Дописать в файл changes новую версию (полученную на предыдущем шаге) с описанием по подобию предыдущих
3. Закомитить
4. Выполнить `npm run build`
5. Зайти в каталог `debian` и выполнить `dupload`
