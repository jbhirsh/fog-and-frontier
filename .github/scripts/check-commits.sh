#!/usr/bin/env bash
# Fails the PR when one of its commits breaks a commit-message rule from
# CLAUDE.md that a script can judge:
#   - the subject is at most 72 characters;
#   - a blank line and a body follow the subject (trailers alone don't
#     count as a body);
#   - no fixup!/squash!/amend! commits or "wip"/"oops" subjects, which
#     belong squashed into the commit they patch;
#   - no merge commits: history is linear (rebase, not merge).
# Whether the subject is imperative and the body explains why stays with
# Claude Review, as does a typo fix that should have been squashed.
# Dependabot's commits are exempt (their format is Dependabot's);
# claude-autofix's commits are checked like any other.
#
# Reads the commits from the API, so the checkout can stay shallow.
# Needs GH_TOKEN (pull-requests: read), PR_NUMBER and GITHUB_REPOSITORY.
set -euo pipefail
export LC_ALL=C.UTF-8

commits=$(gh api --paginate "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/commits" \
  --jq '.[] | {sha: .sha[0:7], login: (.author.login // ""), parents: (.parents | length), message: .commit.message} | @base64')

failed=0
for encoded in $commits; do
  commit=$(base64 -d <<<"$encoded")
  sha=$(jq -r .sha <<<"$commit")
  [ "$(jq -r .login <<<"$commit")" = "dependabot[bot]" ] && continue
  message=$(jq -r .message <<<"$commit")
  subject=$(head -n 1 <<<"$message")
  fail() {
    echo "::error title=Commit $sha::\"$subject\": $1"
    failed=1
  }

  if [ "$(jq -r .parents <<<"$commit")" -gt 1 ]; then
    fail "merge commit. Rebase onto main instead of merging it in."
    continue
  fi
  if [ "${#subject}" -gt 72 ]; then
    fail "subject is ${#subject} characters; the limit is 72."
  fi
  if grep -qiE '^((fixup|squash|amend)!|(wip|oops)([^a-z]|$))' <<<"$subject"; then
    fail "squash this into the commit it patches."
  fi
  if [ -n "$(sed -n 2p <<<"$message")" ]; then
    fail "the subject needs a blank line after it."
  fi
  # The body is everything after the blank line, minus a closing trailer
  # block (Co-Authored-By: and the like). A last paragraph counts as
  # trailers when every line is "Key: value" and either it follows a body
  # paragraph or it names a known trailer, so a body line that happens to
  # read "Why: ..." still counts as body.
  body=$(tail -n +3 <<<"$message" | awk '
    BEGIN { RS = "" }
    { para[++n] = $0 }
    END {
      if (n == 0) exit
      m = split(para[n], lines, "\n")
      all = 1; known = 0
      for (i = 1; i <= m; i++) {
        if (lines[i] !~ /^[A-Za-z][A-Za-z-]*: /) all = 0
        if (tolower(lines[i]) ~ /^(co-authored-by|signed-off-by|claude-session): /) known = 1
      }
      if (all && (n > 1 || known)) n--
      for (i = 1; i <= n; i++) print para[i]
    }')
  if [ -z "$body" ]; then
    fail "no body. Add one explaining why the change is needed."
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "Reword with \`git rebase -i origin/main\`, then force-push the branch."
  exit 1
fi
echo "All commit messages pass."
