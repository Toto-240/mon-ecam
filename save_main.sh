#!/usr/bin/env bash
# Enregistre sur la branche main les fichiers produits par un workflow, même si l'appli
# (ou un autre workflow) a modifié le dépôt entre-temps : on repart de la version en ligne
# et on y remet nos fichiers, au lieu d'un « rebase » qui peut se bloquer sur un conflit.
# Usage : bash save_main.sh "message" chemin [chemin…]
set -u
msg="$1"; shift
paths=(); for p in "$@"; do [ -e "$p" ] || git ls-files --error-unmatch "$p" >/dev/null 2>&1 && paths+=("$p"); done
[ ${#paths[@]} -eq 0 ] && { echo "Rien à enregistrer"; exit 0; }
tmp=$(mktemp -d)
git add -A -- "${paths[@]}"
git diff --cached --no-renames --name-status > "$tmp/list"
[ -s "$tmp/list" ] || { echo "Rien de nouveau"; exit 0; }
while IFS=$'\t' read -r st path; do
  if [ "$st" = "D" ]; then echo "$path" >> "$tmp/del"
  else mkdir -p "$tmp/f/$(dirname "$path")"; cp -p "$path" "$tmp/f/$path"; fi
done < "$tmp/list"
echo "$(wc -l < "$tmp/list") fichier(s) à enregistrer"
for i in 1 2 3 4 5; do
  git fetch -q origin main && git reset -q --hard origin/main || { sleep 5; continue; }
  [ -d "$tmp/f" ] && cp -pR "$tmp/f/." .
  [ -f "$tmp/del" ] && while read -r d; do git rm -q --ignore-unmatch -- "$d"; done < "$tmp/del"
  git add -A -- "${paths[@]}" 2>/dev/null
  git diff --cached --quiet && { echo "Déjà à jour"; exit 0; }
  git commit -q -m "$msg" && git push -q origin HEAD:main && { echo "Enregistré"; exit 0; }
  sleep 5
done
echo "::error::Enregistrement sur GitHub impossible, nouvel essai au prochain passage"
exit 1
