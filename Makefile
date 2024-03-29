TESTS=$(wildcard test/*.js)
SRC=$(wildcard lib/*/*.js)

.PHONY: $(TESTS) test all reuse

all: reuse test

help:
	# SRC:   $(SRC)
	# TESTS: $(TESTS)
	# targets:
	#   test  - run all tests if SRC was updated

reuse: ; reuse lint
test: $(TESTS)

TEST_ARGS=
$(TESTS): $(SRC)
	gjs -I $(CURDIR)/lib $@ $(TEST_ARGS)
