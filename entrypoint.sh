#!/bin/sh
chown -R appuser:appuser /usr/local/data /usr/local/logs
exec gosu appuser "$@"
