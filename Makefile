NEWVERSION := 0.5.14
TMPDIR := /home/alkaline/zlotmp
SRC_DIR := $(TMPDIR)/zlo-package-building/source
deb: deps
	test -d $(TMPDIR) -a ! -e $(SRC_DIR)
	mkdir -p $(SRC_DIR)
	cp -r ./lib $(SRC_DIR)
	cp -r ./bin $(SRC_DIR)
	cp -r ./node_modules $(SRC_DIR)
	cp -r ./debian $(SRC_DIR)
	cd $(SRC_DIR) && \
        if [ -z "$(NEWVERSION)" ]; then echo -e '\n\nempty $$NEWVERSION, stop\n';  exit 1; fi && \
        dch --create -v $(NEWVERSION) --package yandex-du-zlo --force-distribution --distribution unstable "next auto build" && \
        dpkg-buildpackage -rfakeroot

deps:
	npm i

