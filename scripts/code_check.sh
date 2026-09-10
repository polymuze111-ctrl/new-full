#!/usr/bin/env bash
# HK Bar POS — one-command code checker: lint + format + types + tests.
# Usage: scripts/code_check.sh         (check only, exit 1 on any failure)
#        scripts/code_check.sh --fix   (auto-fix imports/formatting first)
set -uo pipefail
cd "$(dirname "$0")/../backend"

if [ "${1:-}" = "--fix" ]; then
  echo "== autoflake --fix =="; autoflake --remove-all-unused-imports --in-place --recursive .
  echo "== isort --fix ==";    isort --profile black .
  echo "== black --fix ==";    black .
fi

FAILED=0
step() { echo; echo "== $1 =="; }
step "flake8";  flake8 . || FAILED=1
step "isort";   isort --check-only --profile black . || FAILED=1
step "black";   black --check . || FAILED=1
step "mypy";    mypy . || FAILED=1
step "pytest"
# The suite assumes fresh seeded state (keg levels, member wallets) — reset + reseed first.
python3 -c "import pymongo, os; c = pymongo.MongoClient(os.environ.get('MONGO_URL', 'mongodb://localhost:27017')); c.drop_database(os.environ.get('DB_NAME', 'test_database'))"
sudo supervisorctl restart backend >/dev/null 2>&1 || true
sleep 10
export REACT_APP_BACKEND_URL="${REACT_APP_BACKEND_URL:-$(grep REACT_APP_BACKEND_URL ../frontend/.env | cut -d= -f2)}"
python -m pytest tests/ -q -n 0 || FAILED=1

echo
if [ "$FAILED" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "CHECKS FAILED"; fi
exit $FAILED
