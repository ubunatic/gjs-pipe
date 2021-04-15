.PHONY: test all reuse

TESTS=$(wildcard test/*.js)
SRC=$(wildcard lib/*/*.js)

all: reuse test

help:
	# SRC:   $(SRC)
	# TESTS: $(TESTS)
	# targets:
	#   test  - run all tests if SRC was updated

reuse: ; reuse lint
test: $(TESTS)

$(TESTS): $(SRC)
	gjs -I $(CURDIR)/lib $@