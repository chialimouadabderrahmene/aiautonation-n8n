#!/usr/bin/env bash
# Full staging verification from a FRESH stack: import -> all suites -> staged env variants -> trigger-mode stage -> report.
# ~30 minutes. Exit code 1 if any check failed.
set -u
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
FAIL=0
rm -rf staging/out && mkdir -p staging/out

bash staging/scripts/up.sh || exit 2
node staging/run-tests.js t0 t1 t2 t3 t4 || FAIL=1                                             # default env: posting OFF, stop OFF
bash staging/scripts/stage.sh posting-on && { node staging/run-tests.js t5 || FAIL=1; }        # AUTOPILOT_SOCIAL_POSTING=true (mock providers)
bash staging/scripts/stage.sh stop-on    && { node staging/run-tests.js t6 || FAIL=1; }        # AUTOPILOT_STOP=true
bash staging/scripts/stage.sh default    && { node staging/run-tests.js t9 || FAIL=1; }        # real schedule triggers + activation of all 22
node tools/make-report.js
exit $FAIL
